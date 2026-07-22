import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { CourierOrder } from "../jobs/courier/courierSystem";
import type { GameSession } from "../../world/state/types";
import type { BusinessState } from "../economy/types";
import type { PersonState } from "../../people/network/types";
import type {
  CitySituation,
  SituationChoice,
  SituationHistoryEntry,
  SituationState
} from "./types";

const HOUR = 60 * 60_000;
const COOLDOWN = 4 * HOUR;

function choice(
  id: string,
  label: string,
  detail: string,
  consequence: string,
  timeMinutes: number,
  extras: Partial<SituationChoice> = {}
): SituationChoice {
  return { id, label, detail, consequence, timeMinutes, ...extras };
}

function situationId(session: GameSession, type: CitySituation["type"], scope: string): string {
  return createStableEntityId(
    "situation",
    `${session.world.meta.seed}:${type}:${session.situations.generation}:${session.timestamp}:${scope}`
  );
}

export function createSituationState(timestamp: number): SituationState {
  return {
    pending: null,
    history: [],
    generation: 0,
    cooldownUntil: timestamp,
    lastTriggeredAt: timestamp
  };
}

function openSituation(state: SituationState, situation: CitySituation): SituationState {
  return {
    ...state,
    pending: situation,
    generation: state.generation + 1,
    lastTriggeredAt: situation.createdAt
  };
}

export function createCourierInspectionSituation(session: GameSession, order: CourierOrder): SituationState {
  const person = session.people.people.find((item) => item.id === order.clientId);
  const location = session.world.locations.find((item) => item.id === session.life.currentLocationId);
  const restricted = order.legality !== "legal";
  const situation: CitySituation = {
    id: situationId(session, "courier-inspection", order.id),
    type: "courier-inspection",
    createdAt: session.timestamp,
    locationId: session.life.currentLocationId,
    personId: order.clientId,
    courierOrderId: order.id,
    title: "ПРОВЕРКА ГРУЗА",
    prompt: `Патруль остановил рейс ${order.code}. Пломба цела, но данные отправителя требуют ручной проверки.`,
    context: [
      location?.name ?? "CITY TRANSIT",
      `${order.cargoName} · ${order.weightKg} KG`,
      `LEGALITY ${order.legality.toUpperCase()}`,
      `CLIENT ${person?.name ?? order.client}`
    ],
    choices: [
      choice(
        "cooperate",
        "Показать запись рейса",
        "Передать терминал и дождаться проверки.",
        restricted ? "Возможен штраф. Груз останется у тебя." : "Низкий риск. Потеря времени.",
        12
      ),
      choice(
        "call-client",
        "Связаться с клиентом",
        "Потребовать подтверждение происхождения груза.",
        "Результат зависит от доверия клиента и документов.",
        18
      ),
      choice(
        "abandon",
        "Отказаться от груза",
        "Передать посылку патрулю и закрыть рейс.",
        "Заказ провален. Рейтинг и отношения ухудшатся.",
        3
      )
    ],
    payload: {
      legality: order.legality,
      orderCode: order.code,
      clientName: person?.name ?? order.client
    }
  };
  return openSituation(session.situations, situation);
}

export function createDeliveryDisputeSituation(
  session: GameSession,
  order: CourierOrder,
  lateMinutes: number,
  condition: number,
  payout: number
): SituationState {
  const person = session.people.people.find((item) => item.id === order.clientId);
  const compensation = Math.min(60, Math.max(20, Math.round((order.payout - payout) * 0.65) + (condition < 70 ? 18 : 0)));
  const situation: CitySituation = {
    id: situationId(session, "delivery-dispute", order.id),
    type: "delivery-dispute",
    createdAt: session.timestamp,
    locationId: session.life.currentLocationId,
    personId: order.clientId,
    courierOrderId: order.id,
    title: "СПОР ПРИ ПЕРЕДАЧЕ",
    prompt: `${person?.name ?? order.client} не принимает результат молча. ${lateMinutes ? `Опоздание: ${lateMinutes} мин.` : ""} Состояние груза: ${condition}%.`,
    context: [
      order.code,
      `${order.cargoName}`,
      `PAID ₵ ${payout}`,
      `CLIENT IRRITATION ${person?.irritationToPlayer ?? 0}%`
    ],
    choices: [
      choice(
        "compensate",
        `Вернуть ₵ ${compensation}`,
        "Признать ущерб и закрыть спор деньгами.",
        "Меньше денег, но клиент запомнит ответственность.",
        4,
        { cost: compensation, requiredBalance: compensation }
      ),
      choice(
        "explain",
        "Объяснить, что произошло",
        "Разобрать маршрут, задержку и состояние пломбы.",
        "Денег не стоит. Реакция будет сдержанной.",
        8
      ),
      choice(
        "blame-dispatch",
        "Сослаться на диспетчера",
        "Переложить ответственность на сеть MESHLINE.",
        "Рейтинг биржи снизится. Клиент останется недоволен.",
        5
      )
    ],
    payload: {
      orderCode: order.code,
      compensation,
      lateMinutes,
      condition,
      payout
    }
  };
  return openSituation(session.situations, situation);
}

function workerForBusiness(session: GameSession, business: BusinessState): PersonState | undefined {
  return session.people.people
    .filter((person) =>
      person.currentLocationId === session.life.currentLocationId
      && person.workLocationId === business.locationId
    )
    .sort((left, right) => right.stress + right.fatigue - left.stress - left.fatigue)[0];
}

function staffShortageSituation(session: GameSession, business: BusinessState, person: PersonState): CitySituation {
  const location = session.world.locations.find((item) => item.id === business.locationId);
  return {
    id: situationId(session, "staff-shortage", business.id),
    type: "staff-shortage",
    createdAt: session.timestamp,
    locationId: business.locationId,
    personId: person.id,
    businessId: business.id,
    title: "СМЕНА РАЗВАЛИВАЕТСЯ",
    prompt: `${person.name} держит точку почти один. ${location?.name ?? "Рабочий узел"} теряет обслуживание прямо сейчас.`,
    context: [
      `STAFF ${business.staffing}%`,
      `STOCK ${business.stock}%`,
      `DEMAND ${business.demand}%`,
      `${person.name}: FAT ${person.fatigue}% / STR ${person.stress}%`
    ],
    choices: [
      choice(
        "help",
        "Встать в смену",
        "Разгрузить очередь и закрыть тяжёлую часть работы.",
        "45 минут. Оплата ₵ 36. Персонал восстановится.",
        45,
        { payout: 36 }
      ),
      choice(
        "negotiate",
        "Потребовать срочный тариф",
        "Согласиться только за повышенную оплату.",
        "30 минут. Оплата ₵ 58. Помощь будет ограниченной.",
        30,
        { payout: 58 }
      ),
      choice(
        "refuse",
        "Отказаться",
        "Не вмешиваться в чужую смену.",
        "Почти не тратит время. Человек это запомнит.",
        2
      )
    ],
    payload: {
      locationName: location?.name ?? "WORK NODE",
      staffing: business.staffing
    }
  };
}

function personalPressureSituation(session: GameSession, person: PersonState): CitySituation {
  const moneyProblem = ["rent", "medical-debt", "family-care", "unsafe-housing"].includes(person.problem.type);
  const helpCost = moneyProblem ? 60 : 0;
  const helpMinutes = moneyProblem ? 6 : 35;
  return {
    id: situationId(session, "personal-pressure", person.id),
    type: "personal-pressure",
    createdAt: session.timestamp,
    locationId: session.life.currentLocationId,
    personId: person.id,
    title: `${person.name.toUpperCase()} ПРОСИТ МИНУТУ`,
    prompt: person.problem.detail,
    context: [
      person.roleLabel,
      `PRESSURE ${person.problem.severity}%`,
      `TRUST ${person.trustToPlayer}%`,
      `IRRITATION ${person.irritationToPlayer}%`
    ],
    choices: [
      choice(
        "listen",
        "Выслушать",
        "Дать человеку спокойно объяснить ситуацию.",
        "15 минут. Небольшое изменение доверия.",
        15
      ),
      choice(
        "help",
        moneyProblem ? "Дать ₵ 60" : "Помочь на месте",
        moneyProblem ? "Закрыть часть срочного расхода." : "Потратить время на конкретную бытовую помощь.",
        moneyProblem ? "Возникнет личный долг перед тобой." : "Проблема ослабнет, но ты устанешь.",
        helpMinutes,
        helpCost ? { cost: helpCost, requiredBalance: helpCost } : {}
      ),
      choice(
        "leave",
        "Закончить разговор",
        "Сказать, что сейчас нет времени.",
        "Быстро. Может вызвать раздражение.",
        2
      )
    ],
    payload: {
      moneyProblem,
      helpCost,
      helpMinutes,
      problemType: person.problem.type
    }
  };
}

export function maybeOpenAmbientSituation(session: GameSession): GameSession {
  if (session.situations.pending || session.timestamp < session.situations.cooldownUntil) return session;
  if (session.timestamp - session.situations.lastTriggeredAt < HOUR) return session;

  const business = session.economy.businesses.find((item) => item.locationId === session.life.currentLocationId);
  const peopleHere = session.people.people.filter((person) => person.currentLocationId === session.life.currentLocationId);
  const bucket = Math.floor(session.timestamp / HOUR);
  const rng = new SeededRandom(`${session.world.meta.seed}:ambient-situation:${session.situations.generation}:${bucket}:${session.life.currentLocationId}`);

  let pending: CitySituation | null = null;
  if (business && business.staffing < 48) {
    const worker = workerForBusiness(session, business);
    const critical = business.staffing < 20;
    if (worker && (critical || rng.chance(0.72))) pending = staffShortageSituation(session, business, worker);
  }

  if (!pending) {
    const candidate = [...peopleHere]
      .filter((person) => person.problem.severity >= 64)
      .sort((left, right) => right.problem.severity - left.problem.severity)[0];
    if (candidate && rng.chance(0.58)) pending = personalPressureSituation(session, candidate);
  }

  if (!pending) return session;
  return {
    ...session,
    currentActivity: "Решение требуется",
    situations: openSituation(session.situations, pending)
  };
}

export function closeSituation(
  state: SituationState,
  choiceId: string,
  resolvedAt: number,
  outcome: string
): SituationState {
  const pending = state.pending;
  if (!pending) return state;
  const selected = pending.choices.find((item) => item.id === choiceId);
  if (!selected) return state;
  const history: SituationHistoryEntry = {
    id: createStableEntityId("situation-history", `${pending.id}:${choiceId}:${resolvedAt}`),
    situationId: pending.id,
    type: pending.type,
    title: pending.title,
    resolvedAt,
    personId: pending.personId,
    locationId: pending.locationId,
    choiceId,
    choiceLabel: selected.label,
    outcome
  };
  return {
    ...state,
    pending: null,
    history: [history, ...state.history].slice(0, 40),
    cooldownUntil: resolvedAt + COOLDOWN
  };
}
