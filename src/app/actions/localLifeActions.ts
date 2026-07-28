import type { GameSession } from "../../world/state/types";
import {
  acceptCourierOrder,
  buyFoodAtCurrentLocation,
  deliverCourierOrder,
  discardSpoiled,
  eatFoodFromStorage,
  enterPlayerHomeUnit,
  leaveBuildingUnit,
  payPlayerObligationAtHome,
  pickupCourierOrder,
  receiveClinicCare,
  sleepAtHome,
  sleepOutside,
  storeCarriedFoodAtHome
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
  | { kind: "clinic-care"; care: "checkup" | "stabilize" };

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
  }
}
