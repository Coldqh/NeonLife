import type { GameSession } from "../../world/state/types";
import { getFoodProduct } from "../../data/products/foodCatalog";
import { getBusinessAtLocation, localPrice } from "../../gameplay/economy/localEconomy";
import { getActiveCourierOrder } from "../../gameplay/jobs/courier/courierSystem";
import { isLocationOpen } from "../../gameplay/travel/travelSystem";
import { currentPhysicalLocation, isPlayerInsideHome, isPlayerInsideLocation } from "../../gameplay/life/playerPresence";
import {
  acceptCourierOrder,
  acceptPersonalRequest,
  buyFoodAtCurrentLocation,
  deliverCourierOrder,
  declinePersonalRequest,
  discardSpoiled,
  completePersonalRequest,
  finishPlayerEmploymentShift,
  eatFoodFromStorage,
  enterPlayerHomeUnit,
  leaveBuildingUnit,
  payPlayerObligationAtHome,
  pickupCourierOrder,
  interviewForPlayerWork,
  joinVenueQueue,
  leaveVenueQueue,
  performPlayerWorkTask,
  purchaseVenueOffer,
  signPlayerEmploymentContract,
  startPlayerEmploymentShift,
  receiveClinicCare,
  shopliftVenueOffer,
  robVenueRegister,
  assaultLocalActor,
  inspectPhysicalVehicleForTheft,
  forceOpenPhysicalVehicle,
  hotwirePhysicalVehicle,
  resolvePlayerCustody,
  sleepAtHome,
  sleepOutside,
  storeCarriedFoodAtHome,
  waitForPlayerWorkShift
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
  | { kind: "accept-courier"; orderId: string }
  | { kind: "pickup-courier" }
  | { kind: "deliver-courier" }
  | { kind: "accept-personal-request"; requestId: string }
  | { kind: "decline-personal-request"; requestId: string }
  | { kind: "complete-personal-request"; requestId: string }
  | { kind: "pay-obligation"; obligationId: string }
  | { kind: "clinic-care"; care: "checkup" | "stabilize" }
  | { kind: "join-venue-queue"; venueId: string }
  | { kind: "leave-venue-queue"; venueId: string }
  | { kind: "buy-venue-offer"; venueId: string; offerId: string }
  | { kind: "interview-work"; vacancyId: string }
  | { kind: "sign-work-contract"; vacancyId: string }
  | { kind: "wait-work-shift"; contractId: string }
  | { kind: "start-work-shift"; contractId: string }
  | { kind: "perform-work-task"; taskId: string }
  | { kind: "finish-work-shift" }
  | { kind: "shoplift-venue-offer"; venueId: string; offerId: string }
  | { kind: "rob-venue-register"; venueId: string }
  | { kind: "assault-actor"; actorId: string }
  | { kind: "inspect-vehicle-crime"; vehicleId: string }
  | { kind: "break-in-vehicle"; vehicleId: string }
  | { kind: "hotwire-vehicle"; vehicleId: string }
  | { kind: "resolve-custody"; method: "pay" | "serve" };

export interface LocalLifeCommandResult {
  session: GameSession;
  ok: boolean;
  message: string;
  tone: NoticeTone;
  elapsedMinutes: number;
  moneyDelta: number;
}

function execute(session: GameSession, action: LocalLifeAction): GameSession {
  switch (action.kind) {
    case "enter-home-unit": return enterPlayerHomeUnit(session);
    case "leave-home-unit": return leaveBuildingUnit(session);
    case "buy-food": return buyFoodAtCurrentLocation(session, action.productId);
    case "eat-food": return eatFoodFromStorage(session, action.productId);
    case "store-food": return storeCarriedFoodAtHome(session);
    case "discard-spoiled": return discardSpoiled(session);
    case "sleep-home": return sleepAtHome(session, action.hours);
    case "sleep-outside": return sleepOutside(session, action.hours);
    case "accept-courier": return acceptCourierOrder(session, action.orderId);
    case "pickup-courier": return pickupCourierOrder(session);
    case "deliver-courier": return deliverCourierOrder(session);
    case "accept-personal-request": return acceptPersonalRequest(session, action.requestId);
    case "decline-personal-request": return declinePersonalRequest(session, action.requestId);
    case "complete-personal-request": return completePersonalRequest(session, action.requestId);
    case "pay-obligation": return payPlayerObligationAtHome(session, action.obligationId);
    case "clinic-care": return receiveClinicCare(session, action.care);
    case "join-venue-queue": return joinVenueQueue(session, action.venueId);
    case "leave-venue-queue": return leaveVenueQueue(session, action.venueId);
    case "buy-venue-offer": return purchaseVenueOffer(session, action.venueId, action.offerId);
    case "interview-work": return interviewForPlayerWork(session, action.vacancyId);
    case "sign-work-contract": return signPlayerEmploymentContract(session, action.vacancyId);
    case "wait-work-shift": return waitForPlayerWorkShift(session, action.contractId);
    case "start-work-shift": return startPlayerEmploymentShift(session, action.contractId);
    case "perform-work-task": return performPlayerWorkTask(session, action.taskId);
    case "finish-work-shift": return finishPlayerEmploymentShift(session);
    case "shoplift-venue-offer": return shopliftVenueOffer(session, action.venueId, action.offerId);
    case "rob-venue-register": return robVenueRegister(session, action.venueId);
    case "assault-actor": return assaultLocalActor(session, action.actorId);
    case "inspect-vehicle-crime": return inspectPhysicalVehicleForTheft(session, action.vehicleId);
    case "break-in-vehicle": return forceOpenPhysicalVehicle(session, action.vehicleId);
    case "hotwire-vehicle": return hotwirePhysicalVehicle(session, action.vehicleId);
    case "resolve-custody": return resolvePlayerCustody(session, action.method);
  }
}

function rejectionReason(session: GameSession, action: LocalLifeAction): string {
  const location = currentPhysicalLocation(session);
  switch (action.kind) {
    case "enter-home-unit":
      return session.pressure.housingStatus === "evicted" ? "Доступ к жилью отозван" : "Нужно находиться внутри своего жилого блока";
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
    case "accept-courier": {
      const courierContract = session.jobs.work.contracts.find((contract) => contract.id === session.jobs.work.activeContractId && contract.role === "courier" && (contract.status === "active" || contract.status === "warning"));
      if (!courierContract) return "Сначала устройся курьером во вкладке «Работа»";
      const order = session.jobs.courier.orders.find((item) => item.id === action.orderId);
      if (session.jobs.courier.activeOrderId) return "Сначала закончи текущую доставку";
      if (!order || order.status !== "available") return "Заказ уже недоступен";
      if (order.deadlineAt <= session.timestamp) return "Срок заказа уже истёк";
      if (order.weightKg > session.jobs.courier.cargoCapacityKg) return "Груз тяжелее доступной грузоподъёмности";
      return "Заказ нельзя принять из этой точки";
    }
    case "pickup-courier": {
      const order = getActiveCourierOrder(session.jobs.courier);
      return !order ? "Активного заказа нет" : order.status !== "accepted" ? "Груз уже забран" : "Сначала войди в точку выдачи";
    }
    case "deliver-courier": {
      const order = getActiveCourierOrder(session.jobs.courier);
      return !order ? "Активного заказа нет" : order.status !== "in-transit" ? "Сначала забери груз" : "Сначала войди в точку доставки";
    }
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
    case "interview-work": return "Собеседование доступно только в заведении с открытой вакансией";
    case "sign-work-contract": return "Работодатель ещё не сделал предложение";
    case "wait-work-shift": return "До смены слишком далеко или она уже началась";
    case "start-work-shift": return "Нужно быть на рабочем месте в окно начала смены";
    case "perform-work-task": return "Эта задача недоступна или нарушена очередь выполнения";
    case "finish-work-shift": return "Сначала заверши все задачи смены";
    case "shoplift-venue-offer": return "Товар недоступен для кражи или ты находишься слишком далеко";
    case "rob-venue-register": return "Касса недоступна или ты находишься не в заведении";
    case "assault-actor": return "Цель не находится рядом или уже недоступна";
    case "inspect-vehicle-crime": return "Подойди к машине ближе и выйди на улицу";
    case "break-in-vehicle": return "Машина не осмотрена, слишком далеко или уже открыта";
    case "hotwire-vehicle": return "Сначала проникни в машину и займи водительское место";
    case "resolve-custody": return action.method === "pay" ? "Не хватает денег на штраф" : "Игрок сейчас не задержан";
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
    "accept-courier": "Заказ принят",
    "pickup-courier": "Груз получен",
    "deliver-courier": "Доставка завершена",
    "accept-personal-request": "Просьба принята",
    "decline-personal-request": "Просьба отклонена",
    "complete-personal-request": "Просьба выполнена",
    "pay-obligation": "Платёж проведён",
    "clinic-care": "Медицинская процедура завершена",
    "join-venue-queue": "Ты занял место в очереди",
    "leave-venue-queue": "Ты вышел из очереди",
    "buy-venue-offer": "Покупка завершена",
    "interview-work": "Собеседование завершено",
    "sign-work-contract": "Контракт подписан",
    "wait-work-shift": "Время до смены пропущено",
    "start-work-shift": "Смена началась",
    "perform-work-task": "Рабочая задача выполнена",
    "finish-work-shift": "Смена закрыта",
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
  return {
    session: next,
    ok: true,
    message: successMessage(action, elapsedMinutes, moneyDelta),
    tone: action.kind === "decline-personal-request" || action.kind === "shoplift-venue-offer" || action.kind === "rob-venue-register" || action.kind === "assault-actor" || action.kind === "break-in-vehicle" || action.kind === "hotwire-vehicle" ? "warn" : "good",
    elapsedMinutes,
    moneyDelta
  };
}
