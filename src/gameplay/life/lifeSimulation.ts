import type { EventCategory, WorldEvent } from "../../core/events/types";
import { createStableEntityId } from "../../core/ids/entityId";
import { processEventQueue } from "../../core/simulation/eventQueue";
import { advanceGameTime } from "../../core/time/gameTime";
import { getFoodProduct } from "../../data/products/foodCatalog";
import { canPrepare, consumeFood, discardSpoiledFood, purchaseFood } from "../food/foodSystem";
import { calculateSleepRecovery, getHousingDaysLeft } from "../housing/housingSystem";
import { getTravelOptions, isLocationOpen } from "../travel/travelSystem";
import { advanceDistrictPulse } from "../../world/city/districtPulse";
import type { GameSession } from "../../world/state/types";

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
}

export function progressLife(session: GameSession, minutes: number, options: ProgressOptions = {}): GameSession {
  const nextTimestamp = advanceGameTime(session.timestamp, minutes);
  const pulse = advanceDistrictPulse(session.district, nextTimestamp);
  const queued = processEventQueue(session, nextTimestamp);
  const targetLocation = options.targetLocationId
    ? session.world.locations.find((location) => location.id === options.targetLocationId)
    : undefined;
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

  const baselineFatigue = Math.max(0, Math.round(minutes / 120));
  const baselineHunger = Math.max(0, Math.round(minutes / 150));
  const housingDaysLeft = getHousingDaysLeft(session.life.housing, nextTimestamp);

  return {
    ...session,
    timestamp: nextTimestamp,
    world: {
      ...session.world,
      meta: { ...session.world.meta, currentTimestamp: nextTimestamp },
      activeDistrictId: targetDistrict?.id ?? session.world.activeDistrictId
    },
    district: pulse.state,
    eventQueue: queued.queue,
    currentActivity: options.activity ?? session.currentActivity,
    life: {
      ...session.life,
      currentLocationId: targetLocation?.id ?? session.life.currentLocationId
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
}

export function travelToLocation(session: GameSession, locationId: string): GameSession {
  const option = getTravelOptions(session).find((item) => item.location.id === locationId);
  if (!option || session.player.balance < option.cost) return session;
  const open = isLocationOpen(option.location, session.timestamp + option.durationMinutes * 60_000);
  return progressLife(session, option.durationMinutes, {
    category: "personal",
    title: `Прибытие: ${option.location.name}.`,
    detail: `${option.districtName} · транспорт ₵ ${option.cost}${open ? "" : " · объект закрыт"}`,
    importance: open ? 1 : 2,
    balanceDelta: -option.cost,
    fatigueDelta: 2,
    stressDelta: option.sameDistrict ? 0 : 1,
    activity: `На месте: ${option.location.name}`,
    targetLocationId: option.location.id
  });
}

export function buyFoodAtCurrentLocation(session: GameSession, productId: string): GameSession {
  const location = session.world.locations.find((item) => item.id === session.life.currentLocationId);
  if (!location || !isLocationOpen(location, session.timestamp)) return session;
  const product = getFoodProduct(productId);
  if (session.player.balance < product.price) return session;
  const purchase = purchaseFood(session.life.food, session.world.meta.seed, location.id, productId, 1, session.timestamp);
  if (!purchase) return session;
  const progressed = progressLife(session, 4, {
    category: "finance",
    title: `Куплено: ${product.name}.`,
    detail: `${location.name} · −₵ ${product.price} · срок хранения ${product.shelfLifeHours} ч.`,
    balanceDelta: -product.price,
    activity: `Покупки: ${location.name}`
  });
  return {
    ...progressed,
    life: {
      ...progressed.life,
      food: purchase.state
    }
  };
}


export function orderFoodToHome(session: GameSession, productId: string): GameSession {
  const market = session.world.locations.find((location) => location.type === "market");
  if (!market) return session;
  const product = getFoodProduct(productId);
  const deliveryFee = 14;
  const totalCost = product.price + deliveryFee;
  if (session.player.balance < totalCost) return session;
  const deliveryTimestamp = session.timestamp + 25 * 60_000;
  const purchase = purchaseFood(session.life.food, session.world.meta.seed, market.id, productId, 1, deliveryTimestamp);
  if (!purchase) return session;
  const progressed = progressLife(session, 25, {
    category: "finance",
    title: `Доставка получена: ${product.name}.`,
    detail: `${market.name} → ${session.world.locations.find((location) => location.id === session.life.housing.locationId)?.name ?? "HOME"} · товар ₵ ${product.price} · доставка ₵ ${deliveryFee}`,
    balanceDelta: -totalCost,
    stressDelta: -1,
    activity: "Заказ продуктов через городскую сеть"
  });
  return {
    ...progressed,
    life: {
      ...progressed.life,
      food: purchase.state
    }
  };
}

export function eatFoodFromStorage(session: GameSession, productId: string): GameSession {
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
  if (session.life.currentLocationId !== session.life.housing.locationId) return session;
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
    activity: `В жилом блоке`,
    suppressTimeEvent: true
  });
  return {
    ...progressed,
    life: { ...progressed.life, lastSleepAt: progressed.timestamp }
  };
}
