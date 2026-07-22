import type { EventCategory, WorldEvent } from "../../core/events/types";
import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import { processEventQueue } from "../../core/simulation/eventQueue";
import { advanceGameTime } from "../../core/time/gameTime";
import { getFoodProduct } from "../../data/products/foodCatalog";
import { adjustPersonProblem, advanceHumanNetwork, getPerson, recordPlayerAction, toKnownNpc } from "../../people/network/humanNetwork";
import { canPrepare, consumeFood, discardSpoiledFood, purchaseFood } from "../food/foodSystem";
import { calculateSleepRecovery, getHousingDaysLeft } from "../housing/housingSystem";
import { getTravelOptions, isLocationOpen } from "../travel/travelSystem";
import {
  acceptCourierOrder as acceptCourierOrderState,
  applyCourierTravelRisk,
  collectCourierCargo,
  adjustCourierRating,
  completeCourierOrder,
  expireCourierOrders,
  failActiveCourierOrder,
  getActiveCourierOrder,
  refreshCourierBoard
} from "../jobs/courier/courierSystem";
import { advanceDistrictPulse } from "../../world/city/districtPulse";
import {
  acceptNpcRequest as acceptNpcRequestState,
  advancePressureState,
  closePressureDay,
  completeNpcRequest as completeNpcRequestState,
  declineNpcRequest as declineNpcRequestState,
  extendRentObligation,
  payObligation as payObligationState,
  trackPressureMetrics
} from "../pressure/pressureSystem";
import type { GameSession } from "../../world/state/types";
import {
  closeSituation,
  createCourierInspectionSituation,
  createDeliveryDisputeSituation,
  maybeOpenAmbientSituation
} from "../situations/situationSystem";
import {
  advanceLocalEconomy,
  applyBusinessIntervention,
  applyCourierSupplyDelivery,
  applyEconomyPressureToPeople,
  applyRequestToEconomy,
  businessCanServe,
  getBusinessAtLocation,
  localPrice,
  registerBusinessSale
} from "../economy/localEconomy";

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function createEvent(session: GameSession, timestamp: number, category: EventCategory, title: string, detail: string | undefined, importance: 1 | 2 | 3): WorldEvent {
  return {
    id: createStableEntityId("event", `${session.world.meta.seed}:${timestamp}:${category}:${title}:${session.events.length}`),
    timestamp,
    category,
    title,
    detail,
    importance
  };
}

function locationNameForSession(session: GameSession, locationId: string): string {
  return session.world.locations.find((location) => location.id === locationId)?.name ?? "UNKNOWN NODE";
}

interface ProgressOptions {
  category?: EventCategory;
  title?: string;
  detail?: string;
  importance?: 1 | 2 | 3;
  balanceDelta?: number;
  fatigueDelta?: number;
  stressDelta?: number;
  hungerDelta?: number;
  healthDelta?: number;
  activity?: string;
  targetLocationId?: string;
  suppressTimeEvent?: boolean;
  deliveryCompleted?: boolean;
  requestsCompleted?: number;
  relationChanges?: number;
  worldEvents?: number;
  trackBalance?: boolean;
  suppressSituationGeneration?: boolean;
  ignorePendingSituation?: boolean;
}

export function progressLife(session: GameSession, minutes: number, options: ProgressOptions = {}): GameSession {
  if (session.situations.pending && !options.ignorePendingSituation) return session;
  const nextTimestamp = advanceGameTime(session.timestamp, minutes);
  const pulse = advanceDistrictPulse(session.district, nextTimestamp);
  const queued = processEventQueue(session, nextTimestamp);
  const network = advanceHumanNetwork(session.people, nextTimestamp, session.world.meta.seed, session.world.locations);
  const economyAdvance = advanceLocalEconomy(
    session.economy,
    nextTimestamp,
    session.world.meta.seed,
    session.world.locations,
    network.state.people,
    session.life.food,
    pulse.state
  );
  let peopleState = applyEconomyPressureToPeople(network.state, economyAdvance.state, economyAdvance.notices);
  const pressureAdvance = advancePressureState(session.pressure, nextTimestamp, session.world.meta.seed, peopleState.people);
  for (const notice of pressureAdvance.notices) {
    if (!notice.personId || !notice.memorySummary) continue;
    peopleState = recordPlayerAction(
      peopleState,
      session.world.meta.seed,
      notice.personId,
      nextTimestamp,
      notice.memorySummary,
      {
        trust: notice.trustDelta,
        respect: notice.respectDelta,
        irritation: notice.irritationDelta,
        importance: notice.importance * 28,
        emotionalValue: notice.importance === 3 ? -42 : -18
      }
    );
  }

  const requestedTarget = options.targetLocationId
    ? session.world.locations.find((location) => location.id === options.targetLocationId)
    : undefined;
  const evictionTarget = pressureAdvance.evicted
    ? session.world.locations.find((location) => location.type === "transport")
    : undefined;
  const targetLocation = evictionTarget ?? requestedTarget;
  const targetDistrict = targetLocation
    ? session.world.districts.find((district) => district.id === targetLocation.districtId)
    : undefined;

  const generated: WorldEvent[] = [];
  if (options.title && options.category) {
    generated.push(createEvent(
      session,
      nextTimestamp,
      options.category,
      options.title,
      options.detail,
      options.importance ?? 1
    ));
  }
  if (minutes >= 60 && !options.suppressTimeEvent) {
    generated.push(createEvent(session, nextTimestamp, "system", `Прошло ${minutes} минут.`, options.activity, 1));
  }
  for (const notice of network.notices) {
    generated.push(createEvent(session, nextTimestamp, "contact", notice.title, notice.detail, notice.importance));
  }
  for (const notice of economyAdvance.notices) {
    generated.push(createEvent(session, nextTimestamp, "local", notice.title, notice.detail, notice.importance));
  }
  for (const notice of pressureAdvance.notices) {
    generated.push(createEvent(session, nextTimestamp, notice.category, notice.title, notice.detail, notice.importance));
  }

  const baselineFatigue = Math.max(0, Math.round(minutes / 120));
  const baselineHunger = Math.max(0, Math.round(minutes / 150));
  const housingDaysLeft = getHousingDaysLeft(session.life.housing, nextTimestamp);
  const courierState = refreshCourierBoard(
    expireCourierOrders(session.jobs.courier, nextTimestamp),
    session.world.meta.seed,
    nextTimestamp,
    session.world.locations,
    peopleState.people,
    economyAdvance.state.businesses
  );
  const selectedPerson = getPerson(peopleState, session.world.primaryContactId)
    ?? getPerson(peopleState, peopleState.selectedPersonId);
  const worldEventCount = options.worldEvents ?? (queued.events.length + pulse.events.length + network.notices.length + economyAdvance.notices.length + pressureAdvance.notices.length);
  const pressure = trackPressureMetrics(pressureAdvance.state, {
    balanceDelta: options.trackBalance === false ? 0 : options.balanceDelta,
    deliveries: options.deliveryCompleted ? 1 : 0,
    requestsCompleted: options.requestsCompleted,
    relationChanges: options.relationChanges,
    worldEvents: worldEventCount
  });

  const nextSession: GameSession = {
    ...session,
    timestamp: nextTimestamp,
    world: {
      ...session.world,
      meta: { ...session.world.meta, currentTimestamp: nextTimestamp },
      activeDistrictId: targetDistrict?.id ?? session.world.activeDistrictId,
      primaryContactId: selectedPerson?.id ?? session.world.primaryContactId
    },
    primaryContact: selectedPerson
      ? toKnownNpc(selectedPerson, session.world.locations, nextTimestamp)
      : session.primaryContact,
    people: peopleState,
    pressure,
    economy: economyAdvance.state,
    district: pulse.state,
    eventQueue: queued.queue,
    currentActivity: pressureAdvance.evicted
      ? `Без постоянного жилья · ${targetLocation?.name ?? "TRANSIT NODE"}`
      : options.activity ?? session.currentActivity,
    life: {
      ...session.life,
      food: economyAdvance.food,
      currentLocationId: targetLocation?.id ?? session.life.currentLocationId
    },
    jobs: {
      ...session.jobs,
      courier: courierState
    },
    player: {
      ...session.player,
      balance: Math.max(0, session.player.balance + (options.balanceDelta ?? 0)),
      housingDaysLeft,
      district: targetDistrict?.name ?? session.player.district,
      sector: targetDistrict?.code ?? session.player.sector,
      condition: {
        health: clamp(session.player.condition.health + (options.healthDelta ?? 0)),
        fatigue: clamp(session.player.condition.fatigue + baselineFatigue + (options.fatigueDelta ?? 0)),
        stress: clamp(session.player.condition.stress + (options.stressDelta ?? 0)),
        hunger: clamp(session.player.condition.hunger + baselineHunger + (options.hungerDelta ?? 0))
      }
    },
    events: [...generated, ...queued.events.reverse(), ...pulse.events.reverse(), ...session.events].slice(0, 100)
  };
  return options.suppressSituationGeneration ? nextSession : maybeOpenAmbientSituation(nextSession);
}

export function travelToLocation(session: GameSession, locationId: string): GameSession {
  if (session.situations.pending) return session;
  const option = getTravelOptions(session).find((item) => item.location.id === locationId);
  if (!option || session.player.balance < option.cost) return session;
  const open = isLocationOpen(option.location, session.timestamp + option.durationMinutes * 60_000);
  const progressed = progressLife(session, option.durationMinutes, {
    category: "personal",
    title: `Прибытие: ${option.location.name}.`,
    detail: `${option.districtName} · транспорт ₵ ${option.cost}${open ? "" : " · объект закрыт"}`,
    importance: open ? 1 : 2,
    balanceDelta: -option.cost,
    fatigueDelta: 2,
    stressDelta: option.sameDistrict ? 0 : 1,
    activity: `На месте: ${option.location.name}`,
    targetLocationId: option.location.id,
    suppressSituationGeneration: true
  });
  const risk = applyCourierTravelRisk(
    progressed.jobs.courier,
    progressed.world.meta.seed,
    progressed.timestamp,
    progressed.district.gangPressure + progressed.district.policePresence
  );
  if (risk.incident === "none") return maybeOpenAmbientSituation(progressed);

  const active = getActiveCourierOrder(risk.state);
  const withRisk: GameSession = {
    ...progressed,
    jobs: { ...progressed.jobs, courier: risk.state }
  };

  if (risk.incident === "inspection" && active) {
    return {
      ...withRisk,
      currentActivity: "Решение требуется: проверка груза",
      situations: createCourierInspectionSituation(withRisk, active),
      events: [
        createEvent(
          withRisk,
          withRisk.timestamp,
          "work",
          "Патруль остановил курьерский рейс.",
          `${active.code} · требуется решение по проверке груза.`,
          3
        ),
        ...withRisk.events
      ].slice(0, 100)
    };
  }

  const incident = createEvent(
    withRisk,
    withRisk.timestamp,
    "work",
    "Груз получил повреждение в пути.",
    `${active?.code ?? "DELIVERY"} · состояние −${risk.conditionLoss}%.`,
    2
  );
  return maybeOpenAmbientSituation({
    ...withRisk,
    events: [incident, ...withRisk.events].slice(0, 100)
  });
}

export function acceptCourierOrder(session: GameSession, orderId: string): GameSession {
  if (session.situations.pending) return session;
  const nextState = acceptCourierOrderState(session.jobs.courier, orderId, session.timestamp);
  if (nextState === session.jobs.courier) return session;
  const order = nextState.orders.find((item) => item.id === orderId);
  if (!order) return session;
  const pickup = session.world.locations.find((location) => location.id === order.pickupLocationId);
  const dropoff = session.world.locations.find((location) => location.id === order.dropoffLocationId);
  const people = recordPlayerAction(
    session.people,
    session.world.meta.seed,
    order.clientId,
    session.timestamp,
    `Игрок принял доставку ${order.code}.`,
    { trust: 1, respect: 1, importance: 35, emotionalValue: 4 }
  );
  const client = getPerson(people, order.clientId);
  return {
    ...session,
    jobs: { ...session.jobs, courier: nextState },
    people,
    world: { ...session.world, primaryContactId: order.clientId },
    primaryContact: client ? toKnownNpc(client, session.world.locations, session.timestamp) : session.primaryContact,
    player: { ...session.player, occupation: "FREELANCE COURIER" },
    currentActivity: `Заказ принят: ${order.code}`,
    events: [
      createEvent(session, session.timestamp, "work", `Принят заказ ${order.code}.`, `${order.client} · ${pickup?.name} → ${dropoff?.name} · оплата ₵ ${order.payout}`, 2),
      createEvent(session, session.timestamp, "contact", `${order.client} ждёт доставку.`, order.requestNote, order.risk === "high" ? 3 : 2),
      ...session.events
    ].slice(0, 100)
  };
}

export function pickupCourierOrder(session: GameSession): GameSession {
  if (session.situations.pending) return session;
  const active = getActiveCourierOrder(session.jobs.courier);
  const nextState = collectCourierCargo(session.jobs.courier, session.life.currentLocationId, session.timestamp + 6 * 60_000);
  if (!active || nextState === session.jobs.courier) return session;
  const progressed = progressLife(session, 6, {
    category: "work",
    title: `Груз получен: ${active.code}.`,
    detail: `${active.cargoName} · ${active.weightKg} кг · пломба ${active.condition}%`,
    fatigueDelta: 1,
    activity: `Доставка ${active.code}: груз на руках`
  });
  const people = recordPlayerAction(
    progressed.people,
    progressed.world.meta.seed,
    active.clientId,
    progressed.timestamp,
    `Груз по заказу ${active.code} забран со склада.`,
    { respect: 1, importance: 28, emotionalValue: 2 }
  );
  const client = getPerson(people, active.clientId);
  return {
    ...progressed,
    people,
    primaryContact: client ? toKnownNpc(client, progressed.world.locations, progressed.timestamp) : progressed.primaryContact,
    jobs: { ...progressed.jobs, courier: nextState }
  };
}

export function deliverCourierOrder(session: GameSession): GameSession {
  if (session.situations.pending) return session;
  const active = getActiveCourierOrder(session.jobs.courier);
  if (!active) return session;
  const clientAtDelivery = getPerson(session.people, active.clientId);
  if (clientAtDelivery && clientAtDelivery.currentLocationId !== active.dropoffLocationId) {
    const redirected = {
      ...session.jobs.courier,
      orders: session.jobs.courier.orders.map((order) => order.id === active.id
        ? { ...order, dropoffLocationId: clientAtDelivery.currentLocationId }
        : order)
    };
    const location = session.world.locations.find((item) => item.id === clientAtDelivery.currentLocationId);
    return {
      ...session,
      jobs: { ...session.jobs, courier: redirected },
      world: { ...session.world, primaryContactId: clientAtDelivery.id },
      primaryContact: toKnownNpc(clientAtDelivery, session.world.locations, session.timestamp),
      currentActivity: `Клиент сменил точку: ${location?.name ?? "UNKNOWN NODE"}`,
      events: [
        createEvent(
          session,
          session.timestamp,
          "contact",
          `${clientAtDelivery.name} ушёл с точки передачи.`,
          `Новая точка: ${location?.name ?? "неизвестный узел"}. Заказ ${active.code} остаётся активным.`,
          2
        ),
        ...session.events
      ].slice(0, 100)
    };
  }
  const completionTimestamp = session.timestamp + 5 * 60_000;
  const completion = completeCourierOrder(session.jobs.courier, session.life.currentLocationId, completionTimestamp);
  if (!completion) return session;
  const progressed = progressLife(session, 5, {
    category: "work",
    title: `Заказ ${active.code} закрыт.`,
    detail: `${completion.lateMinutes ? `Опоздание ${completion.lateMinutes} мин. · ` : "В срок · "}состояние ${completion.condition}% · начислено ₵ ${completion.payout}`,
    importance: completion.lateMinutes > 15 || completion.condition < 70 ? 3 : 1,
    balanceDelta: completion.payout,
    stressDelta: -2,
    activity: "Свободен для нового заказа",
    deliveryCompleted: true,
    relationChanges: 1,
    suppressSituationGeneration: true
  });
  const cleanDelivery = completion.lateMinutes === 0 && completion.condition >= 90;
  const badDelivery = completion.lateMinutes > 15 || completion.condition < 70;
  const summary = cleanDelivery
    ? `Игрок доставил заказ ${active.code} вовремя и без повреждений.`
    : badDelivery
      ? `Игрок доставил заказ ${active.code} с серьёзной проблемой.`
      : `Игрок завершил заказ ${active.code} с небольшими отклонениями.`;
  const people = recordPlayerAction(
    progressed.people,
    progressed.world.meta.seed,
    active.clientId,
    progressed.timestamp,
    summary,
    cleanDelivery
      ? { trust: 6, respect: 5, irritation: -2, debtToPlayer: 1, importance: 75, emotionalValue: 32 }
      : badDelivery
        ? { trust: -7, respect: -4, irritation: 12, importance: 82, emotionalValue: -44 }
        : { trust: 2, respect: 1, irritation: 2, importance: 50, emotionalValue: 8 }
  );
  const client = getPerson(people, active.clientId);
  const reaction = cleanDelivery
    ? `${active.client} подтвердил получение и сохранил твой контакт.`
    : badDelivery
      ? `${active.client} принял груз, но оставил претензию в MESHLINE.`
      : `${active.client} подтвердил получение с замечаниями.`;
  const supply = applyCourierSupplyDelivery(
    progressed.economy,
    progressed.life.food,
    active,
    completion.payout,
    completion.condition,
    completion.lateMinutes
  );
  const economicEvent = active.economicPurpose === "restock"
    ? createEvent(
      progressed,
      progressed.timestamp,
      "local",
      cleanDelivery ? "Поставка восстановила рабочий запас." : "Поставка принята с потерями.",
      `${locationNameForSession(progressed, active.dropoffLocationId)} · запас зависит от состояния груза и срока.`,
      cleanDelivery ? 2 : badDelivery ? 3 : 1
    )
    : null;

  const result: GameSession = {
    ...progressed,
    people,
    economy: supply.state,
    life: { ...progressed.life, food: supply.food },
    world: { ...progressed.world, primaryContactId: active.clientId },
    primaryContact: client ? toKnownNpc(client, progressed.world.locations, progressed.timestamp) : progressed.primaryContact,
    jobs: { ...progressed.jobs, courier: completion.state },
    events: [
      ...(economicEvent ? [economicEvent] : []),
      createEvent(progressed, progressed.timestamp, "contact", reaction, client?.problem.detail, badDelivery ? 3 : cleanDelivery ? 2 : 1),
      ...progressed.events
    ].slice(0, 100)
  };

  if (completion.lateMinutes > 5 || completion.condition < 88) {
    return {
      ...result,
      currentActivity: "Решение требуется: спор с клиентом",
      situations: createDeliveryDisputeSituation(
        result,
        active,
        completion.lateMinutes,
        completion.condition,
        completion.payout
      )
    };
  }

  return maybeOpenAmbientSituation(result);
}


export function resolveCitySituation(session: GameSession, choiceId: string): GameSession {
  const pending = session.situations.pending;
  if (!pending) return session;
  const selected = pending.choices.find((choice) => choice.id === choiceId);
  if (!selected || (selected.requiredBalance ?? 0) > session.player.balance) return session;

  let working: GameSession = {
    ...session,
    situations: { ...session.situations, pending: null }
  };
  let outcome = "";
  let balanceDelta = 0;
  let fatigueDelta = 0;
  let stressDelta = 0;
  let relationChanges = 0;
  const category: EventCategory = pending.type === "courier-inspection" || pending.type === "delivery-dispute"
    ? "work"
    : "contact";

  if (pending.type === "courier-inspection") {
    const active = getActiveCourierOrder(working.jobs.courier);
    const personId = pending.personId;
    if (choiceId === "cooperate") {
      const legality = String(pending.payload.legality ?? "legal");
      const fine = legality === "restricted" ? 36 : legality === "unknown" ? 18 : 0;
      balanceDelta = -fine;
      stressDelta = fine ? 5 : 2;
      outcome = fine
        ? `Патруль оставил груз у курьера и списал штраф ₵ ${fine}.`
        : "Запись рейса подтверждена. Груз возвращён курьеру.";
    } else if (choiceId === "call-client") {
      const person = getPerson(working.people, personId);
      const rng = new SeededRandom(`${working.world.meta.seed}:inspection-call:${pending.id}`);
      const score = (person?.trustToPlayer ?? 0) + Math.round((person?.respectToPlayer ?? 0) * 0.6)
        - (person?.irritationToPlayer ?? 0) + rng.integer(-14, 18);
      const confirmed = score >= 24;
      balanceDelta = confirmed ? 0 : -20;
      stressDelta = confirmed ? 1 : 5;
      outcome = confirmed
        ? `${person?.name ?? "Клиент"} прислал подтверждение. Патруль отпустил рейс.`
        : `Подтверждение не принято. Патруль списал ₵ 20 и отметил рейс.`;
      if (personId) {
        working = {
          ...working,
          people: recordPlayerAction(
            working.people,
            working.world.meta.seed,
            personId,
            working.timestamp,
            confirmed
              ? "Игрок запросил подтверждение во время проверки и сохранил груз."
              : "Игрок позвонил во время проверки, но документы клиента не прошли.",
            confirmed
              ? { trust: 2, respect: 2, importance: 62, emotionalValue: 12 }
              : { trust: -1, irritation: 3, importance: 65, emotionalValue: -14 }
          )
        };
        relationChanges = 1;
      }
    } else if (choiceId === "abandon") {
      working = {
        ...working,
        jobs: {
          ...working.jobs,
          courier: failActiveCourierOrder(working.jobs.courier, working.timestamp + selected.timeMinutes * 60_000, 8)
        }
      };
      outcome = `Груз ${active?.code ?? String(pending.payload.orderCode ?? "")} передан патрулю. Заказ закрыт как проваленный.`;
      if (personId) {
        working = {
          ...working,
          people: recordPlayerAction(
            working.people,
            working.world.meta.seed,
            personId,
            working.timestamp,
            "Игрок отказался от груза во время проверки и сорвал доставку.",
            { trust: -7, respect: -5, irritation: 10, importance: 88, emotionalValue: -46 }
          )
        };
        relationChanges = 1;
      }
    }
  }

  if (pending.type === "delivery-dispute") {
    const personId = pending.personId;
    if (choiceId === "compensate") {
      const compensation = Number(pending.payload.compensation ?? selected.cost ?? 0);
      balanceDelta = -compensation;
      outcome = `Игрок вернул клиенту ₵ ${compensation}. Претензия закрыта без эскалации.`;
      if (personId) {
        working = {
          ...working,
          people: recordPlayerAction(
            working.people,
            working.world.meta.seed,
            personId,
            working.timestamp,
            `Игрок компенсировал проблему по заказу ${String(pending.payload.orderCode ?? "")}: ₵ ${compensation}.`,
            { trust: 4, respect: 4, irritation: -6, importance: 76, emotionalValue: 24 }
          )
        };
        relationChanges = 1;
      }
    } else if (choiceId === "explain") {
      outcome = "Маршрут и состояние пломбы разобраны. Клиент сохранил претензию, но не стал усиливать конфликт.";
      if (personId) {
        working = {
          ...working,
          people: recordPlayerAction(
            working.people,
            working.world.meta.seed,
            personId,
            working.timestamp,
            `Игрок объяснил отклонения по заказу ${String(pending.payload.orderCode ?? "")}.`,
            { trust: -1, respect: 1, irritation: 2, importance: 52, emotionalValue: -4 }
          )
        };
        relationChanges = 1;
      }
    } else if (choiceId === "blame-dispatch") {
      working = {
        ...working,
        jobs: {
          ...working.jobs,
          courier: adjustCourierRating(working.jobs.courier, -4)
        }
      };
      outcome = "Ответственность переложена на MESHLINE. В профиле курьера появилась служебная отметка.";
      if (personId) {
        working = {
          ...working,
          people: recordPlayerAction(
            working.people,
            working.world.meta.seed,
            personId,
            working.timestamp,
            "Игрок отказался признавать свою часть проблемы и сослался на диспетчера.",
            { trust: -3, respect: -2, irritation: 6, importance: 70, emotionalValue: -24 }
          )
        };
        relationChanges = 1;
      }
    }
  }

  if (pending.type === "staff-shortage") {
    const personId = pending.personId;
    const businessId = pending.businessId;
    if (choiceId === "help") {
      balanceDelta = selected.payout ?? 36;
      fatigueDelta = 5;
      outcome = "Очередь разгружена. Рабочая точка получила короткое окно стабильной работы.";
      if (businessId) {
        working = {
          ...working,
          economy: applyBusinessIntervention(
            working.economy,
            businessId,
            { staffing: 16, cash: -(selected.payout ?? 36), demand: -4 },
            working.district.transitDelayMinutes
          )
        };
      }
      if (personId) {
        working = {
          ...working,
          people: adjustPersonProblem(
            recordPlayerAction(
              working.people,
              working.world.meta.seed,
              personId,
              working.timestamp,
              "Игрок без спора встал в перегруженную смену и помог удержать обслуживание.",
              { trust: 4, respect: 5, irritation: -2, importance: 72, emotionalValue: 28 }
            ),
            personId,
            -5,
            4
          )
        };
        relationChanges = 1;
      }
    } else if (choiceId === "negotiate") {
      balanceDelta = selected.payout ?? 58;
      fatigueDelta = 3;
      outcome = "Срочный тариф принят. Игрок закрыл только критическую часть смены.";
      if (businessId) {
        working = {
          ...working,
          economy: applyBusinessIntervention(
            working.economy,
            businessId,
            { staffing: 10, cash: -(selected.payout ?? 58), demand: -2 },
            working.district.transitDelayMinutes
          )
        };
      }
      if (personId) {
        working = {
          ...working,
          people: adjustPersonProblem(
            recordPlayerAction(
              working.people,
              working.world.meta.seed,
              personId,
              working.timestamp,
              "Игрок помог перегруженной смене только после согласования повышенной оплаты.",
              { trust: 1, respect: 2, irritation: 2, importance: 58, emotionalValue: 5 }
            ),
            personId,
            -3,
            2
          )
        };
        relationChanges = 1;
      }
    } else if (choiceId === "refuse") {
      outcome = "Игрок не вмешался. Рабочая точка продолжила смену без дополнительной помощи.";
      if (personId) {
        working = {
          ...working,
          people: recordPlayerAction(
            working.people,
            working.world.meta.seed,
            personId,
            working.timestamp,
            "Игрок отказался помогать во время тяжёлой смены.",
            { irritation: 3, respect: -1, importance: 40, emotionalValue: -10 }
          )
        };
        relationChanges = 1;
      }
    }
  }

  if (pending.type === "personal-pressure") {
    const personId = pending.personId;
    if (choiceId === "listen") {
      stressDelta = 1;
      outcome = "Человек выговорился и точнее объяснил, что с ним происходит.";
      if (personId) {
        working = {
          ...working,
          people: adjustPersonProblem(
            recordPlayerAction(
              working.people,
              working.world.meta.seed,
              personId,
              working.timestamp,
              "Игрок остановился и выслушал личную проблему.",
              { trust: 3, respect: 1, irritation: -1, importance: 46, emotionalValue: 14 }
            ),
            personId,
            -2,
            2
          )
        };
        relationChanges = 1;
      }
    } else if (choiceId === "help") {
      const helpCost = Number(pending.payload.helpCost ?? selected.cost ?? 0);
      balanceDelta = -helpCost;
      fatigueDelta = helpCost ? 0 : 4;
      outcome = helpCost
        ? `Игрок передал ₵ ${helpCost}. Срочное давление на человека снизилось.`
        : "Игрок потратил время на конкретную помощь. Проблема временно ослабла.";
      if (personId) {
        working = {
          ...working,
          people: adjustPersonProblem(
            recordPlayerAction(
              working.people,
              working.world.meta.seed,
              personId,
              working.timestamp,
              helpCost
                ? `Игрок передал ₵ ${helpCost} на срочный расход.`
                : "Игрок лично помог с текущей бытовой проблемой.",
              helpCost
                ? { trust: 6, respect: 5, irritation: -3, debtToPlayer: helpCost, importance: 82, emotionalValue: 38 }
                : { trust: 5, respect: 6, irritation: -2, importance: 76, emotionalValue: 32 }
            ),
            personId,
            -10,
            8,
            helpCost
          )
        };
        relationChanges = 1;
      }
    } else if (choiceId === "leave") {
      outcome = "Разговор закончен. Проблема осталась на человеке.";
      if (personId) {
        working = {
          ...working,
          people: recordPlayerAction(
            working.people,
            working.world.meta.seed,
            personId,
            working.timestamp,
            "Игрок прервал разговор и ушёл по своим делам.",
            { trust: -1, irritation: 3, importance: 38, emotionalValue: -10 }
          )
        };
        relationChanges = 1;
      }
    }
  }

  const progressed = progressLife(working, selected.timeMinutes, {
    category,
    title: `${pending.title}: решение принято.`,
    detail: `${selected.label} · ${outcome}`,
    importance: pending.type === "courier-inspection" ? 3 : 2,
    balanceDelta,
    fatigueDelta,
    stressDelta,
    relationChanges,
    activity: `На месте: ${locationNameForSession(working, pending.locationId)}`,
    suppressSituationGeneration: true,
    ignorePendingSituation: true
  });
  const situations = closeSituation(session.situations, choiceId, progressed.timestamp, outcome);
  const person = getPerson(progressed.people, pending.personId);
  return {
    ...progressed,
    situations,
    currentActivity: `На месте: ${locationNameForSession(progressed, pending.locationId)}`,
    world: person
      ? { ...progressed.world, primaryContactId: person.id }
      : progressed.world,
    primaryContact: person
      ? toKnownNpc(person, progressed.world.locations, progressed.timestamp)
      : progressed.primaryContact
  };
}

export function acceptPersonalRequest(session: GameSession, requestId: string): GameSession {
  if (session.situations.pending) return session;
  const request = session.pressure.requests.find((item) => item.id === requestId);
  if (!request || request.status !== "open" || request.dueAt <= session.timestamp) return session;
  const person = getPerson(session.people, request.personId);
  const targetLocationId = person?.currentLocationId ?? request.targetLocationId;
  const acceptedPressure = acceptNpcRequestState({
    ...session.pressure,
    requests: session.pressure.requests.map((item) => item.id === requestId ? { ...item, targetLocationId } : item)
  }, requestId, session.timestamp);
  const people = recordPlayerAction(
    session.people,
    session.world.meta.seed,
    request.personId,
    session.timestamp,
    `Игрок согласился выполнить просьбу ${request.code}: ${request.title}.`,
    { trust: 1, respect: 1, importance: 42, emotionalValue: 6 }
  );
  const contact = getPerson(people, request.personId);
  return {
    ...session,
    pressure: acceptedPressure,
    people,
    world: { ...session.world, primaryContactId: request.personId },
    primaryContact: contact ? toKnownNpc(contact, session.world.locations, session.timestamp) : session.primaryContact,
    currentActivity: `Принята просьба ${request.code}`,
    events: [
      createEvent(session, session.timestamp, "contact", `${contact?.name ?? "Контакт"}: договорились.`, `${request.title} · срок ${new Date(request.dueAt).toISOString().slice(11, 16)}.`, 2),
      ...session.events
    ].slice(0, 100)
  };
}

export function declinePersonalRequest(session: GameSession, requestId: string): GameSession {
  if (session.situations.pending) return session;
  const request = session.pressure.requests.find((item) => item.id === requestId);
  if (!request || (request.status !== "open" && request.status !== "accepted")) return session;
  const pressure = declineNpcRequestState(session.pressure, requestId);
  const people = recordPlayerAction(
    session.people,
    session.world.meta.seed,
    request.personId,
    session.timestamp,
    `Игрок отказался от просьбы ${request.code}: ${request.title}.`,
    { trust: -2, respect: -1, irritation: 3, importance: 48, emotionalValue: -14 }
  );
  const contact = getPerson(people, request.personId);
  return {
    ...session,
    pressure: trackPressureMetrics(pressure, { relationChanges: 1 }),
    people,
    primaryContact: contact ? toKnownNpc(contact, session.world.locations, session.timestamp) : session.primaryContact,
    events: [
      createEvent(session, session.timestamp, "contact", `${contact?.name ?? "Контакт"}: просьба отклонена.`, request.title, 1),
      ...session.events
    ].slice(0, 100)
  };
}

export function completePersonalRequest(session: GameSession, requestId: string): GameSession {
  if (session.situations.pending) return session;
  const request = session.pressure.requests.find((item) => item.id === requestId);
  if (!request || request.status !== "accepted") return session;
  const person = getPerson(session.people, request.personId);
  if (person && person.currentLocationId !== request.targetLocationId) {
    const location = session.world.locations.find((item) => item.id === person.currentLocationId);
    return {
      ...session,
      pressure: {
        ...session.pressure,
        requests: session.pressure.requests.map((item) => item.id === request.id ? { ...item, targetLocationId: person.currentLocationId } : item)
      },
      events: [
        createEvent(session, session.timestamp, "contact", `${person.name} сменил место.`, `${request.code} · новая точка: ${location?.name ?? "UNKNOWN NODE"}.`, 2),
        ...session.events
      ].slice(0, 100)
    };
  }
  const completionAt = session.timestamp + request.durationMinutes * 60_000;
  const completion = completeNpcRequestState(
    session.pressure,
    requestId,
    completionAt,
    session.life.currentLocationId,
    session.player.balance
  );
  if (!completion) return session;
  const base = { ...session, pressure: completion.state };
  const progressed = progressLife(base, request.durationMinutes, {
    category: "contact",
    title: `Просьба ${request.code} выполнена.`,
    detail: `${request.title} · ${completion.balanceDelta >= 0 ? `получено ₵ ${completion.balanceDelta}` : `потрачено ₵ ${Math.abs(completion.balanceDelta)}`}`,
    importance: 2,
    balanceDelta: completion.balanceDelta,
    fatigueDelta: request.durationMinutes >= 40 ? 4 : 2,
    stressDelta: -1,
    requestsCompleted: 1,
    relationChanges: 1,
    activity: `Помощь: ${person?.name ?? request.code}`
  });
  const isLoan = request.type === "loan";
  const peopleBeforeMemory = isLoan
    ? {
      ...progressed.people,
      people: progressed.people.people.map((item) => item.id === request.personId ? { ...item, money: item.money + request.upfrontCost } : item)
    }
    : progressed.people;
  const people = recordPlayerAction(
    peopleBeforeMemory,
    progressed.world.meta.seed,
    request.personId,
    progressed.timestamp,
    `Игрок выполнил просьбу ${request.code}: ${request.title}.`,
    isLoan
      ? { trust: 8, respect: 3, debtToPlayer: request.upfrontCost, importance: 78, emotionalValue: 35 }
      : { trust: 5, respect: 5, irritation: -2, debtToPlayer: 1, importance: 70, emotionalValue: 28 }
  );
  const contact = getPerson(people, request.personId);
  const economyOutcome = applyRequestToEconomy(progressed.economy, progressed.life.food, request.targetLocationId, request.type);
  return {
    ...progressed,
    people,
    economy: economyOutcome.state,
    life: { ...progressed.life, food: economyOutcome.food },
    world: { ...progressed.world, primaryContactId: request.personId },
    primaryContact: contact ? toKnownNpc(contact, progressed.world.locations, progressed.timestamp) : progressed.primaryContact
  };
}

export function payPlayerObligation(session: GameSession, obligationId: string): GameSession {
  if (session.situations.pending) return session;
  const originalObligation = session.pressure.obligations.find((item) => item.id === obligationId);
  const payment = payObligationState(session.pressure, obligationId, session.timestamp + 2 * 60_000, session.player.balance);
  if (!payment) return session;
  const obligation = payment.obligation;
  const base = { ...session, pressure: payment.state };
  const progressed = progressLife(base, 2, {
    category: "finance",
    title: `${obligation.code}: платёж проведён.`,
    detail: `${obligation.creditorName} · −₵ ${obligation.amount}`,
    importance: originalObligation?.status === "overdue" || originalObligation?.status === "defaulted" ? 2 : 1,
    balanceDelta: -obligation.amount,
    relationChanges: obligation.creditorPersonId ? 1 : 0,
    activity: "Финансовый терминал"
  });
  let next = progressed;
  if (obligation.type === "rent") {
    const paidUntil = Math.max(session.life.housing.paidUntil, progressed.timestamp) + 7 * 24 * 60 * 60_000;
    next = {
      ...progressed,
      life: { ...progressed.life, housing: { ...progressed.life.housing, paidUntil } },
      player: { ...progressed.player, housingDaysLeft: getHousingDaysLeft({ ...progressed.life.housing, paidUntil }, progressed.timestamp) }
    };
  }
  if (!obligation.creditorPersonId) return next;
  const people = recordPlayerAction(
    next.people,
    next.world.meta.seed,
    obligation.creditorPersonId,
    next.timestamp,
    `Игрок оплатил обязательство ${obligation.code}.`,
    { trust: 2, respect: 3, irritation: -3, importance: 62, emotionalValue: 18 }
  );
  const contact = getPerson(people, obligation.creditorPersonId);
  return {
    ...next,
    people,
    primaryContact: contact ? toKnownNpc(contact, next.world.locations, next.timestamp) : next.primaryContact
  };
}

export function requestRentExtension(session: GameSession): GameSession {
  if (session.situations.pending) return session;
  const rent = session.pressure.obligations.find((item) => item.type === "rent" && item.status !== "paid");
  const manager = rent?.creditorPersonId ? getPerson(session.people, rent.creditorPersonId) : null;
  if (!rent || !manager) return session;
  const accepted = manager.trustToPlayer >= 12 && manager.irritationToPlayer < 65;
  if (!accepted) {
    return {
      ...session,
      events: [
        createEvent(session, session.timestamp, "contact", `${manager.name} отказал в отсрочке.`, "Управляющий требует оплатить аренду по текущему сроку.", 2),
        ...session.events
      ].slice(0, 100)
    };
  }
  const pressure = extendRentObligation(session.pressure, session.timestamp);
  if (!pressure) return session;
  const paidUntil = session.life.housing.paidUntil + 24 * 60 * 60_000;
  const people = recordPlayerAction(
    session.people,
    session.world.meta.seed,
    manager.id,
    session.timestamp,
    "Игрок попросил и получил однодневную отсрочку аренды.",
    { trust: -1, irritation: 4, playerDebt: 1, importance: 68, emotionalValue: -3 }
  );
  return {
    ...session,
    pressure,
    people,
    life: { ...session.life, housing: { ...session.life.housing, paidUntil } },
    player: { ...session.player, housingDaysLeft: getHousingDaysLeft({ ...session.life.housing, paidUntil }, session.timestamp) },
    world: { ...session.world, primaryContactId: manager.id },
    primaryContact: toKnownNpc(getPerson(people, manager.id) ?? manager, session.world.locations, session.timestamp),
    events: [
      createEvent(session, session.timestamp, "contact", `${manager.name} дал отсрочку на 24 часа.`, `Новый срок аренды: ${new Date(rent.dueAt + 24 * 60 * 60_000).toISOString().slice(5, 16).replace("T", " · ")}.`, 2),
      ...session.events
    ].slice(0, 100)
  };
}

export function requestEmergencyLoan(session: GameSession, personId: string): GameSession {
  if (session.situations.pending) return session;
  const person = getPerson(session.people, personId);
  if (!person) return session;
  const existing = session.pressure.obligations.some((item) => item.type === "personal" && item.creditorPersonId === personId && item.status !== "paid");
  if (existing) return session;
  if (person.trustToPlayer < 25 || person.money < 180) {
    return {
      ...session,
      events: [
        createEvent(session, session.timestamp, "contact", `${person.name} не дал денег.`, "Свободных средств или доверия недостаточно.", 1),
        ...session.events
      ].slice(0, 100)
    };
  }
  const amount = Math.min(160, Math.max(100, Math.floor(person.money * 0.22)));
  const obligation = {
    id: createStableEntityId("obligation", `${session.world.meta.seed}:personal:${person.id}:${session.timestamp}`),
    code: `OBL-P${session.pressure.obligations.length + 1}`,
    type: "personal" as const,
    creditorName: person.name,
    creditorPersonId: person.id,
    amount,
    dueAt: session.timestamp + 3 * 24 * 60 * 60_000,
    status: "active" as const,
    consequence: "Личный долг изменит отношения и доступ к будущей помощи.",
    extensionCount: 0,
    lastNoticeStage: 0,
    paidAt: null
  };
  const base = {
    ...session,
    pressure: { ...session.pressure, obligations: [...session.pressure.obligations, obligation] },
    people: {
      ...session.people,
      people: session.people.people.map((item) => item.id === person.id ? { ...item, money: item.money - amount } : item)
    }
  };
  const progressed = progressLife(base, 6, {
    category: "finance",
    title: `${person.name} передал ₵ ${amount}.`,
    detail: `Личный долг ${obligation.code} · вернуть в течение трёх дней.`,
    balanceDelta: amount,
    trackBalance: false,
    relationChanges: 1,
    activity: "Личный финансовый перевод"
  });
  const people = recordPlayerAction(
    progressed.people,
    progressed.world.meta.seed,
    person.id,
    progressed.timestamp,
    `Игрок занял ₵ ${amount} до срока ${obligation.code}.`,
    { trust: 1, playerDebt: amount, importance: 76, emotionalValue: 8 }
  );
  return {
    ...progressed,
    people,
    world: { ...progressed.world, primaryContactId: person.id },
    primaryContact: toKnownNpc(getPerson(people, person.id) ?? person, progressed.world.locations, progressed.timestamp)
  };
}

export function buyFoodAtCurrentLocation(session: GameSession, productId: string): GameSession {
  if (session.situations.pending) return session;
  const location = session.world.locations.find((item) => item.id === session.life.currentLocationId);
  if (!location || !isLocationOpen(location, session.timestamp)) return session;
  const product = getFoodProduct(productId);
  const business = getBusinessAtLocation(session.economy, location.id);
  const price = localPrice(product.price, business);
  if (!businessCanServe(business) || session.player.balance < price) return session;
  const purchase = purchaseFood(session.life.food, session.world.meta.seed, location.id, productId, 1, session.timestamp);
  if (!purchase) return session;
  const progressed = progressLife(session, 4, {
    category: "finance",
    title: `Куплено: ${product.name}.`,
    detail: `${location.name} · −₵ ${price} · индекс цены ${business?.priceIndex ?? 100}% · срок хранения ${product.shelfLifeHours} ч.`,
    balanceDelta: -price,
    activity: `Покупки: ${location.name}`
  });
  return {
    ...progressed,
    life: {
      ...progressed.life,
      food: purchase.state
    },
    economy: registerBusinessSale(progressed.economy, location.id, price)
  };
}

export function orderFoodToHome(session: GameSession, productId: string): GameSession {
  if (session.situations.pending) return session;
  if (session.pressure.housingStatus !== "active") return session;
  const market = session.world.locations.find((location) => location.type === "market");
  if (!market) return session;
  const product = getFoodProduct(productId);
  const business = getBusinessAtLocation(session.economy, market.id);
  const deliveryFee = 14 + Math.max(0, Math.round((business?.priceIndex ?? 100) / 25) - 4);
  const productPrice = localPrice(product.price, business);
  const totalCost = productPrice + deliveryFee;
  if (!businessCanServe(business) || session.player.balance < totalCost) return session;
  const deliveryTimestamp = session.timestamp + 25 * 60_000;
  const purchase = purchaseFood(session.life.food, session.world.meta.seed, market.id, productId, 1, deliveryTimestamp);
  if (!purchase) return session;
  const progressed = progressLife(session, 25, {
    category: "finance",
    title: `Доставка получена: ${product.name}.`,
    detail: `${market.name} → ${session.world.locations.find((location) => location.id === session.life.housing.locationId)?.name ?? "HOME"} · товар ₵ ${productPrice} · доставка ₵ ${deliveryFee}`,
    balanceDelta: -totalCost,
    stressDelta: -1,
    activity: "Заказ продуктов через городскую сеть"
  });
  return {
    ...progressed,
    life: {
      ...progressed.life,
      food: purchase.state
    },
    economy: registerBusinessSale(progressed.economy, market.id, productPrice)
  };
}

export function eatFoodFromStorage(session: GameSession, productId: string): GameSession {
  if (session.situations.pending) return session;
  const product = getFoodProduct(productId);
  const atHome = session.life.currentLocationId === session.life.housing.locationId;
  if (!canPrepare(product.requirement, session.life.food.appliances, atHome)) return session;
  const consumed = consumeFood(session.life.food, productId, session.timestamp);
  if (!consumed) return session;
  const progressed = progressLife(session, Math.max(1, product.preparationMinutes), {
    category: "health",
    title: `Съедено: ${product.name}.`,
    detail: `${product.code} · голод −${product.hungerRelief}${product.requirement !== "none" ? ` · подготовка ${product.preparationMinutes} мин.` : ""}`,
    healthDelta: product.healthDelta,
    fatigueDelta: product.fatigueDelta,
    stressDelta: product.stressDelta,
    hungerDelta: -product.hungerRelief,
    activity: atHome ? "Приём пищи дома" : "Приём пищи"
  });
  return {
    ...progressed,
    life: {
      ...progressed.life,
      food: {
        ...consumed.state,
        lastMealAt: progressed.timestamp
      }
    }
  };
}

export function discardSpoiled(session: GameSession): GameSession {
  if (session.situations.pending) return session;
  const result = discardSpoiledFood(session.life.food, session.timestamp);
  if (!result.discarded) return session;
  return {
    ...session,
    life: { ...session.life, food: result.state },
    events: [
      createEvent(session, session.timestamp, "health", `Утилизировано испорченных порций: ${result.discarded}.`, "Домашний пищевой запас очищен.", 2),
      ...session.events
    ].slice(0, 100)
  };
}

export function sleepAtHome(session: GameSession, hours: number): GameSession {
  if (session.situations.pending) return session;
  if (session.life.currentLocationId !== session.life.housing.locationId || session.pressure.housingStatus === "evicted") return session;
  const recovery = calculateSleepRecovery(session.life.housing, hours);
  const progressed = progressLife(session, hours * 60, {
    category: "personal",
    title: `Сон завершён: ${hours} ч.`,
    detail: `Качество жилья ${session.life.housing.sleepQuality}% · шум ${session.life.housing.noise}%`,
    importance: hours >= 7 ? 1 : 2,
    fatigueDelta: recovery.fatigueDelta,
    stressDelta: recovery.stressDelta,
    healthDelta: recovery.healthDelta,
    hungerDelta: 9,
    activity: "В жилом блоке",
    suppressTimeEvent: true
  });
  const pressure = closePressureDay(
    progressed.pressure,
    progressed.timestamp,
    hours * 60,
    progressed.player.balance,
    progressed.world.meta.seed
  );
  const summary = pressure.summaries[0];
  return {
    ...progressed,
    pressure,
    life: { ...progressed.life, lastSleepAt: progressed.timestamp },
    events: summary ? [
      createEvent(
        progressed,
        progressed.timestamp,
        "system",
        `DAY ${summary.dayIndex} CLOSED.`,
        `Заработано ₵ ${summary.earned} · потрачено ₵ ${summary.spent} · доставки ${summary.deliveries} · просьбы ${summary.requestsCompleted}/${summary.requestsMissed}.`,
        summary.requestsMissed > 0 ? 2 : 1
      ),
      ...progressed.events
    ].slice(0, 100) : progressed.events
  };
}
