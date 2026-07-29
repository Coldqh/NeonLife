import { createWorldSession } from "../src/world/generation/createWorld";
import { migrateEnvelope } from "../src/core/saves/migrations";
import {
  acceptCourierOrder,
  buyFoodAtCurrentLocation,
  deliverCourierOrder,
  eatFoodFromStorage,
  enterPlayerHomeUnit,
  pickupCourierOrder,
  receiveClinicCare,
  sleepAtHome,
  storeCarriedFoodAtHome
} from "../src/gameplay/life/lifeSimulation";
import { getActiveCourierOrder } from "../src/gameplay/jobs/courier/courierSystem";
import { getPlayerHomeBuilding, isPlayerInsideHome } from "../src/gameplay/life/playerPresence";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function insideLocation<T extends ReturnType<typeof createWorldSession>>(session: T, locationId: string): T {
  const building = session.urban.buildings.find((item) => item.anchorLocationId === locationId);
  assert(building, `building for ${locationId} is missing`);
  return {
    ...session,
    life: { ...session.life, currentLocationId: locationId },
    localScene: {
      ...session.localScene,
      playerPosition: {
        sectorId: building.sectorId,
        xM: building.bounds.xM + building.bounds.widthM / 2,
        yM: building.bounds.yM + building.bounds.heightM / 2,
        locationId,
        buildingId: building.id,
        floor: 1,
        state: "inside" as const,
        updatedAt: session.timestamp
      }
    }
  } as T;
}

const seed = "physical-life-loop";
let session = createWorldSession(seed);
const homeBuilding = getPlayerHomeBuilding(session);
assert(homeBuilding, "home building missing");

const homeLobby = insideLocation(session, session.life.housing.locationId);
const rejectedLobbySleep = sleepAtHome(homeLobby, 8);
assert(rejectedLobbySleep === homeLobby, "sleep was allowed in the building lobby");

session = enterPlayerHomeUnit(homeLobby);
assert(isPlayerInsideHome(session), "player could not enter own housing unit");
const beforeSleepFatigue = session.player.condition.fatigue;
session = sleepAtHome(session, 8);
assert(session.player.condition.fatigue < beforeSleepFatigue, "home sleep did not recover fatigue");

const shop = session.world.locations.find((item) => item.type === "clinic" && Boolean(session.life.food.shopStocks[item.id]?.["kernel-9-brick"]));
assert(shop, "open food shop missing");
session = insideLocation(session, shop.id);
const storageBefore = session.life.food.storage.reduce((sum, stack) => sum + stack.quantity, 0);
const carriedBefore = session.life.food.carried.reduce((sum, stack) => sum + stack.quantity, 0);
session = buyFoodAtCurrentLocation(session, "kernel-9-brick");
assert(session.life.food.carried.reduce((sum, stack) => sum + stack.quantity, 0) === carriedBefore + 1, "purchase did not enter carried inventory");
assert(session.life.food.storage.reduce((sum, stack) => sum + stack.quantity, 0) === storageBefore, "purchase teleported into home storage");

session = insideLocation(session, session.life.housing.locationId);
session = enterPlayerHomeUnit(session);
assert(isPlayerInsideHome(session), "player could not return to own unit");
session = storeCarriedFoodAtHome(session);
assert(session.life.food.carried.length === 0, "carried food was not stored at home");
assert(session.life.food.storage.reduce((sum, stack) => sum + stack.quantity, 0) >= storageBefore + 1, "home storage did not receive carried food");
const hungerBeforeMeal = session.player.condition.hunger;
session = eatFoodFromStorage(session, "kernel-9-brick");
assert(session.player.condition.hunger < hungerBeforeMeal, "home meal did not reduce hunger");

const dispatch = session.world.locations.find((item) => item.code.startsWith("MSH/"));
assert(dispatch, "courier dispatch missing");
const available = session.jobs.courier.orders.find((order) => order.status === "available");
assert(available, "courier order missing");
const rejectedRemoteAccept = acceptCourierOrder(session, available.id);
assert(rejectedRemoteAccept === session, "courier order was accepted away from dispatch");
session = insideLocation(session, dispatch.id);
session = acceptCourierOrder(session, available.id);
let active = getActiveCourierOrder(session.jobs.courier);
assert(active?.status === "accepted", "courier order was not accepted at dispatch");

session = insideLocation(session, active.pickupLocationId);
session = pickupCourierOrder(session);
active = getActiveCourierOrder(session.jobs.courier);
assert(active?.status === "in-transit", "courier cargo was not collected");
assert(session.jobs.courier.carriedCargo?.orderId === active.id, "courier cargo does not exist as carried inventory");

session = {
  ...insideLocation(session, active.dropoffLocationId),
  people: {
    ...session.people,
    people: session.people.people.map((person) => person.id === active?.clientId ? { ...person, currentLocationId: active.dropoffLocationId } : person)
  }
};
const balanceBeforeDelivery = session.player.balance;
session = deliverCourierOrder(session);
assert(!session.jobs.courier.activeOrderId, "completed delivery remained active");
assert(!session.jobs.courier.carriedCargo, "completed courier cargo remained in inventory");
assert(session.player.balance > balanceBeforeDelivery, "delivery did not pay the player");

const clinic = session.world.locations.find((item) => item.type === "clinic" && session.health.facilities.some((facility) => facility.locationId === item.id && facility.medicalStock >= 4));
assert(clinic, "usable clinic missing");
session = insideLocation(session, clinic.id);
session = { ...session, player: { ...session.player, balance: Math.max(500, session.player.balance), condition: { ...session.player.condition, health: 55 } } };
const clinicBalance = session.player.balance;
session = receiveClinicCare(session, "stabilize");
assert(session.player.balance === clinicBalance - 120, "clinic did not charge exact treatment cost");
assert(session.player.condition.health > 55, "clinic did not improve player health");

const legacy = createWorldSession("physical-life-migration");
const legacyOrder = legacy.jobs.courier.orders[0];
assert(legacyOrder, "legacy courier order missing");
const rawEnvelope = JSON.parse(JSON.stringify({
  slotId: "slot-1",
  schemaVersion: 29,
  createdAt: new Date(legacy.timestamp).toISOString(),
  updatedAt: new Date(legacy.timestamp).toISOString(),
  checksum: "",
  payload: {
    ...legacy,
    schemaVersion: 29,
    jobs: {
      ...legacy.jobs,
      courier: {
        ...legacy.jobs.courier,
        activeOrderId: legacyOrder.id,
        orders: legacy.jobs.courier.orders.map((order) => order.id === legacyOrder.id
          ? { ...order, status: "in-transit", acceptedAt: legacy.timestamp, collectedAt: legacy.timestamp }
          : order)
      }
    }
  }
})) as any;
delete rawEnvelope.payload.life.food.carried;
delete rawEnvelope.payload.life.food.carryingCapacityGrams;
delete rawEnvelope.payload.jobs.courier.carriedCargo;
const migrated = migrateEnvelope(rawEnvelope, "slot-1");
assert(migrated?.schemaVersion === 32, "save was not migrated to schema 32");
assert(Array.isArray(migrated.payload.life.food.carried), "migration did not create carried food inventory");
assert(migrated.payload.life.food.carryingCapacityGrams === 6_500, "migration did not create carrying capacity");
assert(migrated.payload.jobs.courier.carriedCargo?.orderId === legacyOrder.id, "migration did not reconstruct carried courier cargo");

console.log(JSON.stringify({
  insideHome: isPlayerInsideHome(enterPlayerHomeUnit(insideLocation(session, session.life.housing.locationId))),
  carriedFood: session.life.food.carried.length,
  storedFood: session.life.food.storage.reduce((sum, stack) => sum + stack.quantity, 0),
  deliveries: session.jobs.courier.completedDeliveries,
  clinicHealth: session.player.condition.health,
  migratedSchema: migrated.schemaVersion
}, null, 2));
