import type { GameSession } from "../../world/state/types";
import { getFoodProduct } from "../../data/products/foodCatalog";
import { getBusinessAtLocation, localPrice } from "../../gameplay/economy/localEconomy";
import { isLocationOpen } from "../../gameplay/travel/travelSystem";
import { jobAvailableAtVenue, resolvePlayerLoopAction, TRAINING_ACTIONS } from "../../gameplay/playerLoop/playerLoopSystem";
import { venueIsOpenAt } from "../../simulation/venues/venueOperationsSystem";
import type { PlayerLoopAction } from "../../gameplay/playerLoop/types";
import { currentPhysicalLocation, isPlayerInsideHome, isPlayerInsideLocation } from "../../gameplay/life/playerPresence";
import {
  acceptPersonalRequest,
  assaultLocalActor,
  buyFoodAtCurrentLocation,
  completePersonalRequest,
  declinePersonalRequest,
  discardSpoiled,
  eatFoodFromStorage,
  enterPlayerHomeUnit,
  forceOpenPhysicalVehicle,
  hotwirePhysicalVehicle,
  inspectPhysicalVehicleForTheft,
  joinVenueQueue,
  leaveBuildingUnit,
  leaveVenueQueue,
  payPlayerObligationAtHome,
  performPlayerLoopAction,
  purchaseVenueOffer,
  receiveClinicCare,
  resolvePlayerCustody,
  robVenueRegister,
  shopliftVenueOffer,
  sleepAtHome,
  sleepOutside,
  storeCarriedFoodAtHome
} from "../../gameplay/life/lifeSimulation";
import type { NoticeTone } from "../shared/types";

export type LocalLifeAction =
  | { kind: "enter-home-unit" }
  | { kind: "leave-home-unit" }
  | { kind: "buy-food"; productId: string }
  | { kind: "eat-food"; productId: string }
  | { kind: "store-food" }
  | { kind: "discard-spoiled" }
  | { kind: "sleep-home"; hours: number }
  | { kind: "sleep-outside"; hours: number }
  | { kind: "accept-personal-request"; requestId: string }
  | { kind: "decline-personal-request"; requestId: string }
  | { kind: "complete-personal-request"; requestId: string }
  | { kind: "pay-obligation"; obligationId: string }
  | { kind: "clinic-care"; care: "checkup" | "stabilize" }
  | { kind: "join-venue-queue"; venueId: string }
  | { kind: "leave-venue-queue"; venueId: string }
  | { kind: "buy-venue-offer"; venueId: string; offerId: string }
  | { kind: "shoplift-venue-offer"; venueId: string; offerId: string }
  | { kind: "rob-venue-register"; venueId: string }
  | { kind: "assault-actor"; actorId: string }
  | { kind: "inspect-vehicle-crime"; vehicleId: string }
  | { kind: "break-in-vehicle"; vehicleId: string }
  | { kind: "hotwire-vehicle"; vehicleId: string }
  | { kind: "resolve-custody"; method: "submit-search" | "resist-search" | "attempt-escape" | "proceed-hearing" | "pay" | "serve" }
  | PlayerLoopAction;

export interface LocalLifeCommandResult {
  session: GameSession;
  ok: boolean;
  message: string;
  tone: NoticeTone;
  elapsedMinutes: number;
  moneyDelta: number;
}

function isPlayerLoopAction(action: LocalLifeAction): action is PlayerLoopAction {
  return ["select-job", "leave-job", "work-shift", "train", "equip-item", "unequip-item", "boxing-fight"].includes(action.kind);
}

function execute(session: GameSession, action: LocalLifeAction): GameSession {
  if (isPlayerLoopAction(action)) return performPlayerLoopAction(session, action);
  switch (action.kind) {
    case "enter-home-unit": return enterPlayerHomeUnit(session);
    case "leave-home-unit": return leaveBuildingUnit(session);
    case "buy-food": return buyFoodAtCurrentLocation(session, action.productId);
    case "eat-food": return eatFoodFromStorage(session, action.productId);
    case "store-food": return storeCarriedFoodAtHome(session);
    case "discard-spoiled": return discardSpoiled(session);
    case "sleep-home": return sleepAtHome(session, action.hours);
    case "sleep-outside": return sleepOutside(session, action.hours);
    case "accept-personal-request": return acceptPersonalRequest(session, action.requestId);
    case "decline-personal-request": return declinePersonalRequest(session, action.requestId);
    case "complete-personal-request": return completePersonalRequest(session, action.requestId);
    case "pay-obligation": return payPlayerObligationAtHome(session, action.obligationId);
    case "clinic-care": return receiveClinicCare(session, action.care);
    case "join-venue-queue": return joinVenueQueue(session, action.venueId);
    case "leave-venue-queue": return leaveVenueQueue(session, action.venueId);
    case "buy-venue-offer": return purchaseVenueOffer(session, action.venueId, action.offerId);
    case "shoplift-venue-offer": return shopliftVenueOffer(session, action.venueId, action.offerId);
    case "rob-venue-register": return robVenueRegister(session, action.venueId);
    case "assault-actor": return assaultLocalActor(session, action.actorId);
    case "inspect-vehicle-crime": return inspectPhysicalVehicleForTheft(session, action.vehicleId);
    case "break-in-vehicle": return forceOpenPhysicalVehicle(session, action.vehicleId);
    case "hotwire-vehicle": return hotwirePhysicalVehicle(session, action.vehicleId);
    case "resolve-custody": return resolvePlayerCustody(session, action.method);
  }
}

function playerLoopRejection(session: GameSession, action: PlayerLoopAction): string {
  const venueId = "venueId" in action ? action.venueId : undefined;
  const venue = venueId ? session.urban.venues.find((item) => item.id === venueId && item.unitId === session.localScene.playerPosition.unitId) : undefined;
  if (venueId) {
    if (!venue) return "Нужно находиться внутри нужного заведения";
    if (!venueIsOpenAt(venue, session.timestamp)) return "Заведение сейчас закрыто";
  }
  if (action.kind === "select-job") {
    if (!venue || !jobAvailableAtVenue(action.jobId, venue.category)) return "У этого работодателя нет такой вакансии";
  }
  if (action.kind === "work-shift") {
    if (!session.playerLoop.employment || session.playerLoop.employment.venueId !== action.venueId) return "Смена доступна только у твоего работодателя";
  }
  if (action.kind === "boxing-fight" && venue?.category !== "boxing-gym") return "Боксёрский бой проводится только в боксёрском зале";
  if (action.kind === "train") {
    const training = TRAINING_ACTIONS.find((item) => item.id === action.trainingId);
    if (!venue || !training || !training.venueCategories.includes(venue.category as "gym" | "boxing-gym" | "shooting-range")) return "Эта тренировка здесь недоступна";
  }
  const location = currentPhysicalLocation(session);
  return resolvePlayerLoopAction(session.playerLoop, action, {
    seed: session.world.meta.seed,
    timestamp: session.timestamp,
    balance: session.player.balance,
    health: session.player.condition.health,
    fatigue: session.player.condition.fatigue,
    stress: session.player.condition.stress,
    locationId: location?.id,
    locationName: venue?.name ?? location?.name
  }).message;
}

function rejectionReason(session: GameSession, action: LocalLifeAction): string {
  if (isPlayerLoopAction(action)) return playerLoopRejection(session, action);
  const location = currentPhysicalLocation(session);
  switch (action.kind) {
    case "enter-home-unit": return session.pressure.housingStatus === "evicted" ? "Доступ к жилью отозван" : "Нужно находиться внутри своего жилого блока";
    case "leave-home-unit": return "Ты не находишься внутри отдельного помещения";
    case "buy-food": {
      if (!location || !isPlayerInsideLocation(session, location.id)) return "Сначала войди в торговую точку";
      if (!isLocationOpen(location, session.timestamp)) return "Торговая точка закрыта";
      const product = getFoodProduct(action.productId);
      const price = localPrice(product.price, getBusinessAtLocation(session.economy, location.id));
      if (session.player.balance < price) return `Не хватает ₵ ${price - session.player.balance}`;
      return "Товара нет в физическом остатке или сумка переполнена";
    }
    case "eat-food": return "Еду нельзя приготовить здесь или подходящей порции нет";
    case "store-food": return isPlayerInsideHome(session) ? "В сумке нечего убирать" : "Пищевой шкаф доступен только дома";
    case "discard-spoiled": return "Испорченных продуктов нет";
    case "sleep-home": return "Спать дома можно только внутри своего помещения";
    case "sleep-outside": return session.localScene.playerPosition.state === "outside" ? "Сейчас нельзя лечь спать" : "Сначала выйди на улицу";
    case "accept-personal-request": {
      const request = session.pressure.requests.find((item) => item.id === action.requestId);
      if (!request || request.status !== "open") return "Просьба уже недоступна";
      if (request.dueAt <= session.timestamp) return "Срок просьбы истёк";
      return "Нужно находиться рядом с человеком";
    }
    case "decline-personal-request": {
      const request = session.pressure.requests.find((item) => item.id === action.requestId);
      return !request || (request.status !== "open" && request.status !== "accepted") ? "Просьба уже закрыта" : "Нужно находиться рядом с человеком";
    }
    case "complete-personal-request": {
      const request = session.pressure.requests.find((item) => item.id === action.requestId);
      if (!request || request.status !== "accepted") return "Сначала прими просьбу";
      if (request.dueAt <= session.timestamp) return "Срок просьбы истёк";
      if (session.player.balance < request.upfrontCost) return `Не хватает ₵ ${request.upfrontCost - session.player.balance}`;
      return "Нужно встретиться с человеком в указанной точке";
    }
    case "pay-obligation": {
      const obligation = session.pressure.obligations.find((item) => item.id === action.obligationId);
      if (!isPlayerInsideHome(session)) return "Оплата обязательств доступна через домашний терминал";
      if (!obligation || obligation.status === "paid") return "Обязательство уже закрыто";
      return session.player.balance < (obligation?.amount ?? 0) ? "На счёте недостаточно денег" : "Платёж сейчас недоступен";
    }
    case "clinic-care": return location?.type === "clinic" ? "Недостаточно денег, медикаментов или мест" : "Сначала войди в клинику";
    case "join-venue-queue": return "Очередь закрыта, заведение недоступно или ты находишься не там";
    case "leave-venue-queue": return "Ты не стоишь в этой очереди";
    case "buy-venue-offer": return "Предложение недоступно, не хватает денег или ты находишься не у кассы";
    case "shoplift-venue-offer": return "Товар недоступен для кражи или ты находишься слишком далеко";
    case "rob-venue-register": return "Касса недоступна или ты находишься не в заведении";
    case "assault-actor": return "Цель не находится рядом или уже недоступна";
    case "inspect-vehicle-crime": return "Подойди к машине ближе и выйди на улицу";
    case "break-in-vehicle": return "Машина не осмотрена, слишком далеко или уже открыта";
    case "hotwire-vehicle": return "Сначала проникни в машину и займи водительское место";
    case "resolve-custody": {
      const custody = session.playerCrime.custody;
      if (!custody || custody.status !== "detained") return "Игрок сейчас не задержан";
      if (action.method === "pay") return custody.phase !== "hearing" ? "Сначала пройди обыск и разбор дела" : "Не хватает денег на штраф";
      if (action.method === "serve") return custody.phase !== "hearing" ? "Сначала пройди обыск и разбор дела" : "Срок сейчас нельзя отбыть";
      if (action.method === "proceed-hearing") return custody.phase !== "searched" ? "Сначала должен завершиться обыск" : "Разбор дела сейчас недоступен";
      if (action.method === "submit-search" || action.method === "resist-search") return custody.phase !== "stopped" ? "Обыск уже завершён" : "Действие сейчас недоступно";
      return custody.escapeAttempted || custody.phase !== "stopped" ? "Побег сейчас невозможен" : "Попытка побега сорвалась";
    }
  }
}

function successMessage(action: LocalLifeAction, elapsedMinutes: number, moneyDelta: number): string {
  const names: Record<LocalLifeAction["kind"], string> = {
    "enter-home-unit": "Ты вошёл домой",
    "leave-home-unit": "Ты вышел в коридор",
    "buy-food": "Покупка завершена",
    "eat-food": "Еда использована",
    "store-food": "Продукты убраны в шкаф",
    "discard-spoiled": "Испорченные продукты выброшены",
    "sleep-home": "Сон завершён",
    "sleep-outside": "Сон на улице завершён",
    "accept-personal-request": "Просьба принята",
    "decline-personal-request": "Просьба отклонена",
    "complete-personal-request": "Просьба выполнена",
    "pay-obligation": "Платёж проведён",
    "clinic-care": "Медицинская процедура завершена",
    "join-venue-queue": "Ты занял место в очереди",
    "leave-venue-queue": "Ты вышел из очереди",
    "buy-venue-offer": "Покупка завершена",
    "select-job": "Работа выбрана",
    "leave-job": "Работа оставлена",
    "work-shift": "Смена завершена",
    "train": "Тренировка завершена",
    "equip-item": "Снаряжение надето",
    "unequip-item": "Снаряжение снято",
    "boxing-fight": "Боксёрский бой завершён",
    "shoplift-venue-offer": "Попытка кражи завершена",
    "rob-venue-register": "Попытка ограбления завершена",
    "assault-actor": "Нападение завершено",
    "inspect-vehicle-crime": "Машина осмотрена",
    "break-in-vehicle": "Попытка взлома завершена",
    "hotwire-vehicle": "Попытка запуска завершена",
    "resolve-custody": "Задержание завершено"
  };
  const details = [elapsedMinutes > 0 ? `${elapsedMinutes} мин.` : "без затрат времени", moneyDelta ? `${moneyDelta > 0 ? "+" : "−"}₵ ${Math.abs(moneyDelta)}` : ""].filter(Boolean).join(" · ");
  return details ? `${names[action.kind]} · ${details}` : names[action.kind];
}

export function applyLocalLifeAction(session: GameSession, action: LocalLifeAction): LocalLifeCommandResult {
  const next = execute(session, action);
  if (next === session) {
    return { session, ok: false, message: rejectionReason(session, action), tone: "warn", elapsedMinutes: 0, moneyDelta: 0 };
  }
  const elapsedMinutes = Math.max(0, Math.round((next.timestamp - session.timestamp) / 60_000));
  const moneyDelta = next.player.balance - session.player.balance;
  const risky = ["boxing-fight", "shoplift-venue-offer", "rob-venue-register", "assault-actor", "break-in-vehicle", "hotwire-vehicle", "decline-personal-request"].includes(action.kind);
  return { session: next, ok: true, message: successMessage(action, elapsedMinutes, moneyDelta), tone: risky ? "warn" : "good", elapsedMinutes, moneyDelta };
}
