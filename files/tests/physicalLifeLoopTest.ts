import { createWorldSession } from "../src/world/generation/createWorld";
import { migrateEnvelope } from "../src/core/saves/migrations";
import { SAVE_SCHEMA_VERSION } from "../src/core/saves/types";
import {
  buyFoodAtCurrentLocation,
  eatFoodFromStorage,
  enterPlayerHomeUnit,
  progressLife,
  receiveClinicCare,
  sleepAtHome,
  storeCarriedFoodAtHome
} from "../src/gameplay/life/lifeSimulation";
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

const clinic = session.world.locations.find((item) => item.type === "clinic" && session.health.facilities.some((facility) => facility.locationId === item.id && facility.medicalStock >= 4));
assert(clinic, "usable clinic missing");
session = insideLocation(session, clinic.id);
session = { ...session, player: { ...session.player, balance: Math.max(500, session.player.balance), condition: { ...session.player.condition, health: 55 } } };
const clinicBalance = session.player.balance;
session = receiveClinicCare(session, "stabilize");
assert(session.player.balance === clinicBalance - 120, "clinic did not charge exact treatment cost");
assert(session.player.condition.health > 55, "clinic did not improve player health");

const legacy = createWorldSession("physical-life-migration");
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
      work: {
        skills: { service: 62, technical: 31, medical: 27, cooking: 18 },
        activeContractId: "legacy-courier-contract",
        totalEarned: 900,
        contracts: [{ id: "legacy-courier-contract", role: "courier", completedShifts: 4 }]
      },
      courier: { rating: 80, completedDeliveries: 7, totalEarnings: 540 }
    }
  }
})) as any;
delete rawEnvelope.payload.playerLoop;
delete rawEnvelope.payload.life.food.carried;
delete rawEnvelope.payload.life.food.carryingCapacityGrams;
const migrated = migrateEnvelope(rawEnvelope, "slot-1");
assert(migrated?.schemaVersion === SAVE_SCHEMA_VERSION, `save was not migrated to schema ${SAVE_SCHEMA_VERSION}`);
assert(Array.isArray(migrated.payload.life.food.carried), "migration did not create carried food inventory");
assert(migrated.payload.life.food.carryingCapacityGrams === 6_500, "migration did not create carrying capacity");
assert(!("jobs" in migrated.payload), "migration preserved removed work and courier state");
assert(migrated.payload.playerLoop.employment === null, "legacy abstract job should not survive without a physical employer");
assert(migrated.payload.playerLoop.shiftsWorked === 11, "legacy work totals were not imported");
assert(migrated.payload.playerLoop.totalEarned === 1_440, "legacy earnings were not imported");
assert(migrated.payload.player.occupation === "UNEMPLOYED", "migrated occupation should require a new physical employer");

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
  physicalEmployment: migrated.payload.playerLoop.employment,
  clinicHealth: session.player.condition.health,
  migratedSchema: migrated.schemaVersion,
  localTickDurationMs: Math.round(localTickDurationMs)
}, null, 2));
