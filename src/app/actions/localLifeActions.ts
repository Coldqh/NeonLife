import type { GameSession } from "../../world/state/types";
import {
  acceptCourierOrder,
  buyFoodAtCurrentLocation,
  deliverCourierOrder,
  discardSpoiled,
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

export function applyLocalLifeAction(session: GameSession, action: LocalLifeAction): GameSession {
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
