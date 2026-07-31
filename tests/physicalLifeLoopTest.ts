import { createWorldSession } from "../src/world/generation/createWorld";
import { migrateEnvelope } from "../src/core/saves/migrations";
import { SAVE_SCHEMA_VERSION } from "../src/core/saves/types";
import {
  acceptCourierOrder,
  buyFoodAtCurrentLocation,
  deliverCourierOrder,
  eatFoodFromStorage,
  enterPlayerHomeUnit,
  interviewForPlayerWork,
  pickupCourierOrder,
  progressLife,
  receiveClinicCare,
  signPlayerEmploymentContract,
  sleepAtHome,
  storeCarriedFoodAtHome
} from "../src/gameplay/life/lifeSimulation";
import { getActiveCourierOrder } from "../src/gameplay/jobs/courier/courierSystem";
import { getPlayerHomeBuilding, isPlayerInsideHome } from "../src/gameplay/life/playerPresence";
import { getInventoryQuantity, playerCarriedInventoryId, playerStorageInventoryId } from "../src/simulation/inventory/inventorySystem";

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

function insideVenue<T extends ReturnType<typeof createWorldSession>>(session: T, venueId: string): T {
  const venue = session.urban.venues.find((item) => item.id === venueId);
  assert(venue, `venue ${venueId} is missing`);
  const building = session.urban.buildings.find((item) => item.id === venue.buildingId);
  assert(building, `building for venue ${venueId} is missing`);
  return {
    ...session,
    life: { ...session.life, currentLocationId: building.anchorLocationId ?? session.life.currentLocationId },
    localScene: {
      ...session.localScene,
      playerPosition: {
        ...session.localScene.playerPosition,
        state: "inside",
        sectorId: building.sectorId,
        xM: building.bounds.xM + building.bounds.widthM / 2,
        yM: building.bounds.yM + building.bounds.heightM / 2,
        locationId: building.anchorLocationId,
        buildingId: building.id,
        floor: venue.floor,
        unitId: venue.unitId,
        roomId: undefined,
        vehicleId: undefined
      }
    }
  };
}


const localTickSource = createWorldSession("local-runtime-split");
const localTickStartedAt = performance.now();
const localTick = progressLife(localTickSource, 0, { activity: "Осмотр места", suppressTimeEvent: true });
const localTickDurationMs = performance.now() - localTickStartedAt;
assert(localTick.economy === localTickSource.economy, "zero-minute action recalculated the city economy");
assert(localTick.worldCore === localTickSource.worldCore, "zero-minute action rebuilt World Core");
assert(localTick.productInventory === localTickSource.productInventory, "zero-minute action rebuilt product inventory");
assert(localTick.kernel === localTickSource.kernel, "zero-minute action rebuilt the Kernel ledger");
const twelveMinuteLocalTick = progressLife(localTickSource, 12, { activity: "Короткий переход", suppressTimeEvent: true });
assert(twelveMinuteLocalTick.economy === localTickSource.economy, "sub-hour action recalculated the city economy");
assert(twelveMinuteLocalTick.productInventory === localTickSource.productInventory, "sub-hour action rebuilt product inventory");
assert(twelveMinuteLocalTick.kernel === localTickSource.kernel, "sub-hour action rebuilt the Kernel ledger");
const hourBoundaryTick = progressLife(twelveMinuteLocalTick, 12, { activity: "Переход через час", suppressTimeEvent: true });
assert(hourBoundaryTick.economy !== twelveMinuteLocalTick.economy, "hour boundary failed to run the city economy");
assert(hourBoundaryTick.productInventory !== twelveMinuteLocalTick.productInventory, "hour boundary failed to advance product inventory");

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
const canonicalCarriedBefore = getInventoryQuantity(session.productInventory, playerCarriedInventoryId(session.player.id), "kernel-9-brick", session.timestamp);
const canonicalStorageBefore = getInventoryQuantity(session.productInventory, playerStorageInventoryId(session.player.id), "kernel-9-brick", session.timestamp);
session = buyFoodAtCurrentLocation(session, "kernel-9-brick");
assert(session.life.food.carried.reduce((sum, stack) => sum + stack.quantity, 0) === carriedBefore + 1, "purchase did not enter carried inventory");
assert(session.life.food.storage.reduce((sum, stack) => sum + stack.quantity, 0) === storageBefore, "purchase teleported into home storage");
assert(getInventoryQuantity(session.productInventory, playerCarriedInventoryId(session.player.id), "kernel-9-brick", session.timestamp) === canonicalCarriedBefore + 1, "purchase did not update canonical carried inventory immediately");
assert(getInventoryQuantity(session.productInventory, playerStorageInventoryId(session.player.id), "kernel-9-brick", session.timestamp) === canonicalStorageBefore, "purchase changed canonical home storage");

session = insideLocation(session, session.life.housing.locationId);
session = enterPlayerHomeUnit(session);
assert(isPlayerInsideHome(session), "player could not return to own unit");
session = storeCarriedFoodAtHome(session);
assert(session.life.food.carried.length === 0, "carried food was not stored at home");
assert(session.life.food.storage.reduce((sum, stack) => sum + stack.quantity, 0) >= storageBefore + 1, "home storage did not receive carried food");
assert(getInventoryQuantity(session.productInventory, playerCarriedInventoryId(session.player.id), "kernel-9-brick", session.timestamp) === 0, "store action left canonical carried stock behind");
assert(getInventoryQuantity(session.productInventory, playerStorageInventoryId(session.player.id), "kernel-9-brick", session.timestamp) >= canonicalStorageBefore + canonicalCarriedBefore + 1, "store action did not update canonical home storage");
const hungerBeforeMeal = session.player.condition.hunger;
const canonicalMealBefore = getInventoryQuantity(session.productInventory, playerStorageInventoryId(session.player.id), "kernel-9-brick", session.timestamp);
session = eatFoodFromStorage(session, "kernel-9-brick");
assert(session.player.condition.hunger < hungerBeforeMeal, "home meal did not reduce hunger");
assert(getInventoryQuantity(session.productInventory, playerStorageInventoryId(session.player.id), "kernel-9-brick", session.timestamp) === canonicalMealBefore - 1, "meal did not consume canonical storage");

const dispatch = session.world.locations.find((item) => item.code.startsWith("MSH/"));
assert(dispatch, "courier dispatch missing");
const availableOrders = session.jobs.courier.orders.filter((order) => order.status === "available");
assert(availableOrders.length > 0, "courier order missing");
assert(availableOrders.every((order) => order.deadlineAt - session.timestamp >= 150 * 60_000), "courier board generated an impossible short deadline");
const available = availableOrders[0];
assert(!session.jobs.courier.activeOrderId, "fresh world assigned a courier order automatically");
const rejectedWithoutContract = acceptCourierOrder(insideLocation(session, dispatch.id), available.id);
assert(rejectedWithoutContract.jobs.courier.activeOrderId === null, "courier order was accepted without employment");
const courierVacancy = session.jobs.work.vacancies.find((vacancy) => vacancy.role === "courier");
assert(courierVacancy, "courier vacancy missing from ordinary professions");
session = {
  ...insideVenue(session, courierVacancy.venueId),
  jobs: { ...session.jobs, work: { ...session.jobs.work, skills: { ...session.jobs.work.skills, service: 100 } } }
};
session = interviewForPlayerWork(session, courierVacancy.id);
session = signPlayerEmploymentContract(session, courierVacancy.id);
const courierContract = session.jobs.work.contracts.find((contract) => contract.id === session.jobs.work.activeContractId);
assert(courierContract?.role === "courier", "courier contract was not signed through normal employment");
const rejectedRemoteAccept = acceptCourierOrder({ ...session, localScene: { ...session.localScene, playerPosition: { ...session.localScene.playerPosition, state: "outside", buildingId: undefined, unitId: undefined, roomId: undefined, locationId: undefined } } }, available.id);
assert(rejectedRemoteAccept.jobs.courier.activeOrderId === null, "courier order was accepted away from dispatch");
session = insideLocation(session, dispatch.id);
session = acceptCourierOrder(session, available.id);
let active = getActiveCourierOrder(session.jobs.courier);
assert(active?.status === "accepted", "courier order was not accepted at dispatch after employment");

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
assert(migrated?.schemaVersion === SAVE_SCHEMA_VERSION, `save was not migrated to schema ${SAVE_SCHEMA_VERSION}`);
assert(Array.isArray(migrated.payload.life.food.carried), "migration did not create carried food inventory");
assert(migrated.payload.life.food.carryingCapacityGrams === 6_500, "migration did not create carrying capacity");
assert(migrated.payload.jobs.courier.activeOrderId === null, "migration preserved an orphan courier order without employment");
assert(migrated.payload.jobs.courier.carriedCargo === null, "migration preserved orphan courier cargo without employment");
assert(migrated.payload.jobs.courier.orders.find((order) => order.id === legacyOrder.id)?.status === "expired", "migration returned an orphan order to the public board");
assert(migrated.payload.player.occupation === "UNEMPLOYED", "migration preserved a stale courier occupation without a contract");

const transitional = createWorldSession("physical-life-schema-41");
const transitionProduct = "kernel-9-brick";
const transitionStack = { id: "legacy-unsynced-stack", productId: transitionProduct, quantity: 1, purchasedAt: transitional.timestamp, expiresAt: transitional.timestamp + 24 * 60 * 60_000 };
const transitionalEnvelope = {
  slotId: "slot-1" as const,
  schemaVersion: 41,
  createdAt: new Date(transitional.timestamp).toISOString(),
  updatedAt: new Date(transitional.timestamp).toISOString(),
  checksum: "legacy",
  payload: {
    ...transitional,
    schemaVersion: 41,
    life: { ...transitional.life, food: { ...transitional.life.food, carried: [...transitional.life.food.carried, transitionStack] } },
    productInventory: {
      ...transitional.productInventory,
      adapterQuantities: { ...transitional.productInventory.adapterQuantities, [`player:carried:${transitionProduct}`]: 0 },
      adapterBindings: {
        ...transitional.productInventory.adapterBindings,
        [`player:carried:${transitionProduct}`]: {
          inventoryId: playerCarriedInventoryId(transitional.player.id),
          ownerEntityId: transitional.player.id,
          ownerKind: "player" as const,
          compartment: "carried",
          productId: transitionProduct
        }
      }
    }
  }
};
const transitionalMigrated = migrateEnvelope(transitionalEnvelope, "slot-1");
assert(transitionalMigrated?.schemaVersion === SAVE_SCHEMA_VERSION, "schema 41 inventory migration failed");
assert(getInventoryQuantity(transitionalMigrated.payload.productInventory, playerCarriedInventoryId(transitional.player.id), transitionProduct, transitional.timestamp) === 1, "schema 41 unsynchronized player item was lost");

console.log(JSON.stringify({
  insideHome: isPlayerInsideHome(enterPlayerHomeUnit(insideLocation(session, session.life.housing.locationId))),
  carriedFood: session.life.food.carried.length,
  storedFood: session.life.food.storage.reduce((sum, stack) => sum + stack.quantity, 0),
  deliveries: session.jobs.courier.completedDeliveries,
  clinicHealth: session.player.condition.health,
  migratedSchema: migrated.schemaVersion,
  localTickDurationMs: Math.round(localTickDurationMs)
}, null, 2));
