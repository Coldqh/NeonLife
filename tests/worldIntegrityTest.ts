import { createWorldSession } from "../src/world/generation/createWorld";
import {
  approachLocalBuilding,
  enterLocalBuilding,
  enterPhysicalVehicle,
  getPlayerExactLocationId,
  leaveLocalBuilding,
  leavePhysicalVehicle,
  payPlayerObligation,
  progressLife,
  requestEmergencyLoan,
  skipLocalMovement,
  startLocalMovement
} from "../src/gameplay/life/lifeSimulation";
import { localMovementTargetForPoint } from "../src/simulation/localMovement/localMovementSystem";
import { getSectorStreetTopology } from "../src/simulation/streets/streetTopologySystem";
import { kernelSystemEntityId } from "../src/simulation/kernel/simulationKernel";
import { businessInventoryId, facilityInventoryId, getInventoryQuantity, householdInventoryId, playerCarriedInventoryId } from "../src/simulation/inventory/inventorySystem";
import { productForLegacyResource } from "../src/data/products/productCatalog";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function close(left: number, right: number, epsilon = 0.0001): boolean {
  return Math.abs(left - right) <= epsilon;
}

function totalKernelCredits(session: ReturnType<typeof createWorldSession>): number {
  return session.kernel.accounts.reduce((sum, account) => sum + (account.balances.find((entry) => entry.resource === "credits")?.amount ?? 0), 0);
}

const seed = "world-integrity-regression";
const created = createWorldSession(seed);
const homeBuilding = created.urban.buildings.find((building) => building.anchorLocationId === created.life.housing.locationId);
assert(homeBuilding, "home building is missing");

const approachedHome = approachLocalBuilding(created, homeBuilding.id);
const enteredHome = enterLocalBuilding(approachedHome, homeBuilding.id);
assert(enteredHome.localScene.playerPosition.state === "inside", "player could not enter home building");
const leftHome = leaveLocalBuilding(enteredHome);
assert(leftHome.localScene.playerPosition.state === "outside", "player could not leave building");
assert(!leftHome.localScene.playerPosition.buildingId, "building id survived exit");

const ownedVehicleId = leftHome.vehicles.player.ownedVehicleIds[0];
const ownedVehicle = leftHome.vehicles.vehicles.find((vehicle) => vehicle.id === ownedVehicleId);
assert(ownedVehicle, "owned vehicle is missing");
const vehicleReady = {
  ...leftHome,
  localScene: {
    ...leftHome.localScene,
    playerPosition: {
      sectorId: ownedVehicle.position.sectorId,
      xM: ownedVehicle.position.xM,
      yM: ownedVehicle.position.yM,
      locationId: ownedVehicle.position.locationId,
      state: "outside" as const,
      updatedAt: leftHome.timestamp
    }
  },
  vehicles: {
    ...leftHome.vehicles,
    vehicles: leftHome.vehicles.vehicles.map((vehicle) => vehicle.id === ownedVehicle.id
      ? { ...vehicle, visible: true, nearby: true, distanceToPlayerM: 0, playerCanEnter: true, playerCanDrive: true, state: "parked" as const }
      : vehicle)
  }
};
const enteredVehicle = enterPhysicalVehicle(vehicleReady, ownedVehicle.id);
assert(enteredVehicle.localScene.playerPosition.state === "vehicle", "player could not enter owned vehicle");
const leftVehicle = leavePhysicalVehicle(enteredVehicle);
assert(leftVehicle.localScene.playerPosition.state === "outside", "player could not leave vehicle");
assert(!leftVehicle.vehicles.player.currentVehicleId, "vehicle state survived exit");

const needsSeed = `${seed}:needs`;
const needsCreated = createWorldSession(needsSeed);
const initialDayIndex = needsCreated.kernel.clock.dayIndex;
const initialAccountCount = needsCreated.kernel.accounts.length;
const initialKernelCredits = totalKernelCredits(needsCreated);
const oneChunk = progressLife(needsCreated, 120, { suppressTimeEvent: true });
let manyChunks = createWorldSession(needsSeed);
for (let step = 0; step < 10; step += 1) manyChunks = progressLife(manyChunks, 12, { suppressTimeEvent: true });
assert(oneChunk.timestamp === manyChunks.timestamp, "simulation timestamp depends on time chunk size");
assert(oneChunk.kernel.clock.dayIndex === manyChunks.kernel.clock.dayIndex, "kernel day index depends on time chunk size");
assert(oneChunk.kernel.clock.dayIndex > initialDayIndex, "time regression did not cross a day boundary");
assert(close(oneChunk.player.condition.fatigue, manyChunks.player.condition.fatigue), "fatigue depends on time chunk size");
assert(close(oneChunk.player.condition.hunger, manyChunks.player.condition.hunger), "hunger depends on time chunk size");
assert(oneChunk.kernel.integrity.healthy && manyChunks.kernel.integrity.healthy, "kernel integrity failed after day boundary");
assert(oneChunk.kernel.accounts.length - initialAccountCount <= 2, "day boundary leaked synthetic kernel accounts");
assert(manyChunks.kernel.accounts.length - initialAccountCount <= 2, "chunked day boundary leaked synthetic kernel accounts");
assert(!manyChunks.kernel.accounts.some((account) => account.entityId.startsWith("consumer-pool:") || account.entityId.startsWith("workforce-pool:")), "raw synthetic pool account survived kernel compaction");
assert(oneChunk.kernel.integrity.reconciliationTransactions === 0, "day boundary produced domain reconciliation");
assert(manyChunks.kernel.integrity.reconciliationTransactions === 0, "chunked day boundary produced domain reconciliation");
assert(close(totalKernelCredits(oneChunk), initialKernelCredits), "single-step day boundary created or destroyed credits");
assert(close(totalKernelCredits(manyChunks), initialKernelCredits), "chunked day boundary created or destroyed credits");

const canonicalBase = createWorldSession(`${seed}:canonical-economy`);
const canonicalFixture = canonicalBase.worldCore.businesses.map((business) => {
  if (!business.legacyBusinessId || !business.locationId) return null;
  const productId = Object.keys(canonicalBase.life.food.shopStocks[business.locationId] ?? {})[0];
  if (!productId) return null;
  const inventory = canonicalBase.productInventory.inventories.find((item) => item.id === businessInventoryId(business.id));
  if (!inventory || getInventoryQuantity(canonicalBase.productInventory, inventory.id, productId) <= 0) return null;
  return { business, inventory, productId, locationId: business.locationId, legacyBusinessId: business.legacyBusinessId };
}).find((fixture): fixture is NonNullable<typeof fixture> => Boolean(fixture));
assert(canonicalFixture, "canonical business fixture is missing");
const { business: canonicalBusiness, inventory: canonicalInventory, productId: canonicalProductId, locationId: canonicalLocationId, legacyBusinessId: canonicalLegacyBusinessId } = canonicalFixture;
const canonicalQuantityBefore = getInventoryQuantity(canonicalBase.productInventory, canonicalInventory.id, canonicalProductId);
const legacyBusiness = canonicalBase.economy.businesses.find((business) => business.id === canonicalLegacyBusinessId);
assert(legacyBusiness, "legacy business projection is missing");
const corruptedProjection = {
  ...canonicalBase,
  economy: {
    ...canonicalBase.economy,
    businesses: canonicalBase.economy.businesses.map((business) => business.id === legacyBusiness.id ? { ...business, cash: business.cash + 999_999, stock: 100 } : business)
  },
  life: {
    ...canonicalBase.life,
    food: {
      ...canonicalBase.life.food,
      shopStocks: {
        ...canonicalBase.life.food.shopStocks,
        [canonicalLocationId]: {
          ...(canonicalBase.life.food.shopStocks[canonicalLocationId] ?? {}),
          [canonicalProductId]: canonicalQuantityBefore + 9_999
        }
      }
    }
  }
};
const canonicalRecovered = progressLife(corruptedProjection, 20, { suppressTimeEvent: true, trackBalance: false });
const recoveredKernelCash = canonicalRecovered.kernel.accounts.find((account) => account.entityId === canonicalBusiness.id)?.balances.find((entry) => entry.resource === "credits")?.amount;
const recoveredLegacy = canonicalRecovered.economy.businesses.find((business) => business.id === legacyBusiness.id);
assert(recoveredKernelCash !== undefined && recoveredLegacy?.cash === recoveredKernelCash, "legacy business cash overrode the ledger");
assert(getInventoryQuantity(canonicalRecovered.productInventory, canonicalInventory.id, canonicalProductId) === canonicalQuantityBefore, "legacy shop stock overrode ProductInventory");
assert(canonicalRecovered.life.food.shopStocks[canonicalLocationId]?.[canonicalProductId] === canonicalQuantityBefore, "shop stock projection did not return to canonical quantity");
assert(canonicalRecovered.kernel.integrity.reconciliationTransactions === 0, "canonical projection repair created a reconciliation transaction");

const readModelBase = createWorldSession(`${seed}:canonical-physical-inventory`);
const readModelHousehold = readModelBase.population.households.find((household) => household.pantry.length > 0);
const readModelFacility = readModelBase.production.facilities.find((facility) => facility.inventory.length > 0);
assert(readModelHousehold && readModelFacility, "canonical physical inventory fixtures are missing");
const householdProductId = readModelHousehold.pantry[0].productId;
const facilityResource = readModelFacility.inventory[0].resource;
const facilityProductId = productForLegacyResource(facilityResource, `${readModelFacility.name}:${readModelFacility.kind}`).id;
const fakePlayerStack = { id: "corrupt-player-stack", productId: "kernel-9-brick", quantity: 999, purchasedAt: readModelBase.timestamp, expiresAt: readModelBase.timestamp + 24 * 60 * 60_000 };
const corruptedPhysicalProjection = {
  ...readModelBase,
  life: { ...readModelBase.life, food: { ...readModelBase.life.food, carried: [...readModelBase.life.food.carried, fakePlayerStack] } },
  population: {
    ...readModelBase.population,
    households: readModelBase.population.households.map((household) => household.id === readModelHousehold.id
      ? { ...household, pantry: household.pantry.map((item) => item.productId === householdProductId ? { ...item, units: item.units + 999 } : item), foodUnits: household.foodUnits + 999 }
      : household)
  },
  production: {
    ...readModelBase.production,
    facilities: readModelBase.production.facilities.map((facility) => facility.id === readModelFacility.id
      ? { ...facility, inventory: facility.inventory.map((item) => item.resource === facilityResource ? { ...item, amount: item.amount + 999 } : item) }
      : facility)
  }
};
const physicalControl = progressLife(readModelBase, 20, { suppressTimeEvent: true, trackBalance: false });
const physicalRecovered = progressLife(corruptedPhysicalProjection, 20, { suppressTimeEvent: true, trackBalance: false });
assert(getInventoryQuantity(physicalRecovered.productInventory, playerCarriedInventoryId(readModelBase.player.id), "kernel-9-brick") === getInventoryQuantity(physicalControl.productInventory, playerCarriedInventoryId(readModelBase.player.id), "kernel-9-brick"), "legacy player inventory overrode canonical inventory");
assert(getInventoryQuantity(physicalRecovered.productInventory, householdInventoryId(readModelHousehold.id), householdProductId) === getInventoryQuantity(physicalControl.productInventory, householdInventoryId(readModelHousehold.id), householdProductId), "legacy household pantry overrode canonical inventory");
assert(getInventoryQuantity(physicalRecovered.productInventory, facilityInventoryId(readModelFacility.id), facilityProductId) === getInventoryQuantity(physicalControl.productInventory, facilityInventoryId(readModelFacility.id), facilityProductId), "legacy production inventory overrode canonical inventory");
assert(Object.keys(physicalRecovered.productInventory.adapterQuantities).length === 0 && Object.keys(physicalRecovered.productInventory.adapterBindings).length === 0, "transitional inventory adapters survived a canonical tick");

const legacyKernelBase = createWorldSession(`${seed}:legacy-kernel`);
const consumptionId = kernelSystemEntityId(legacyKernelBase.world.meta.seed, "consumption");
const laborMarketId = kernelSystemEntityId(legacyKernelBase.world.meta.seed, "labor-market");
const creditBalance = (entityId: string): number => legacyKernelBase.kernel.accounts
  .find((account) => account.entityId === entityId)?.balances.find((entry) => entry.resource === "credits")?.amount ?? 0;
const legacyKernelSession = {
  ...legacyKernelBase,
  kernel: {
    ...legacyKernelBase.kernel,
    accounts: [
      ...legacyKernelBase.kernel.accounts,
      { id: "legacy-consumer-account", entityId: "consumer-pool:legacy-district", entityKind: "system" as const, balances: [{ resource: "credits" as const, amount: 75 }], updatedAt: legacyKernelBase.timestamp },
      { id: "legacy-workforce-account", entityId: "workforce-pool:legacy-business", entityKind: "system" as const, balances: [{ resource: "credits" as const, amount: 125 }], updatedAt: legacyKernelBase.timestamp }
    ]
  }
};
const compactedLegacyKernel = progressLife(legacyKernelSession, 1, { suppressTimeEvent: true });
assert(!compactedLegacyKernel.kernel.accounts.some((account) => account.entityId.startsWith("consumer-pool:") || account.entityId.startsWith("workforce-pool:")), "legacy synthetic kernel accounts were not compacted");
const compactedBalance = (entityId: string): number => compactedLegacyKernel.kernel.accounts
  .find((account) => account.entityId === entityId)?.balances.find((entry) => entry.resource === "credits")?.amount ?? 0;
assert(close(compactedBalance(consumptionId), creditBalance(consumptionId) + 75), "legacy consumer balance was lost during compaction");
assert(close(compactedBalance(laborMarketId), creditBalance(laborMarketId) + 125), "legacy workforce balance was lost during compaction");

const walkingCreated = createWorldSession(`${seed}:walking`);
const focus = walkingCreated.metropolitan.sectors.find((sector) => sector.id === walkingCreated.localScene.playerPosition.sectorId)
  ?? walkingCreated.metropolitan.sectors[0];
const topology = getSectorStreetTopology(walkingCreated.streets, {
  timestamp: walkingCreated.timestamp,
  seed: walkingCreated.world.meta.seed,
  metropolitan: walkingCreated.metropolitan,
  urban: walkingCreated.urban,
  preferredSectorId: focus.id
}, focus.id);
const originNode = topology.intersections[0];
assert(originNode, "street origin is missing");
const walkingBase = {
  ...walkingCreated,
  localScene: {
    ...walkingCreated.localScene,
    playerPosition: {
      sectorId: focus.id,
      xM: originNode.xM,
      yM: originNode.yM,
      locationId: walkingCreated.life.currentLocationId,
      state: "outside" as const,
      updatedAt: walkingCreated.timestamp
    }
  }
};
const targetNode = [...topology.intersections]
  .sort((left, right) => Math.hypot(right.xM - originNode.xM, right.yM - originNode.yM)
    - Math.hypot(left.xM - originNode.xM, left.yM - originNode.yM))[0];
assert(targetNode, "street target is missing");
const streetTarget = localMovementTargetForPoint(walkingBase, focus.id, targetNode.xM, targetNode.yM, "Свободная точка");
const arrivedAtPoint = skipLocalMovement(startLocalMovement(walkingBase, streetTarget));
assert(arrivedAtPoint.localMovement?.status === "arrived", "free street route did not finish");
assert(getPlayerExactLocationId(arrivedAtPoint) === null, "free street movement retained stale named location");

const rentBase = createWorldSession(`${seed}:rent`);
const rentSession = { ...rentBase, player: { ...rentBase.player, balance: 10_000 } };
const rent = rentSession.pressure.obligations.find((obligation) => obligation.type === "rent" && obligation.status === "active");
assert(rent, "active rent obligation is missing");
const rentPaid = payPlayerObligation(rentSession, rent.id);
const nextRent = rentPaid.pressure.obligations.find((obligation) => obligation.type === "rent" && obligation.status === "active");
assert(rentPaid.pressure.obligations.some((obligation) => obligation.id === rent.id && obligation.status === "paid"), "paid rent was not archived");
assert(nextRent && nextRent.id !== rent.id, "next weekly rent obligation was not created");
assert(nextRent.dueAt === rentPaid.life.housing.paidUntil, "next rent due date does not match housing period");

const loanBase = createWorldSession(`${seed}:loan`);
const creditor = loanBase.people.people[0];
const creditorResident = loanBase.population.residents.find((resident) => resident.activePersonId === creditor.id);
assert(creditorResident, "creditor resident is missing");
const creditorHousehold = loanBase.population.households.find((household) => household.id === creditorResident.householdId);
assert(creditorHousehold, "creditor household is missing");
const loanReady = {
  ...loanBase,
  people: {
    ...loanBase.people,
    people: loanBase.people.people.map((person) => person.id === creditor.id ? { ...person, trustToPlayer: 80, money: 500 } : person)
  }
};
const loanCreditBalance = (entityId: string, source = loanReady) => source.kernel.accounts
  .find((account) => account.entityId === entityId)?.balances
  .find((entry) => entry.resource === "credits")?.amount ?? 0;
const moneyBeforeLoan = loanCreditBalance(loanReady.player.id) + loanCreditBalance(creditorResident.id) + loanCreditBalance(creditorHousehold.id);
const borrowed = requestEmergencyLoan(loanReady, creditor.id);
const borrowedResident = borrowed.population.residents.find((resident) => resident.id === creditorResident.id);
const borrowedHousehold = borrowed.population.households.find((household) => household.id === creditorHousehold.id);
assert(borrowedResident && borrowedHousehold, "creditor finance state disappeared after loan");
const personalDebt = borrowed.pressure.obligations.find((obligation) => obligation.type === "personal" && obligation.creditorPersonId === creditor.id && obligation.status === "active");
assert(personalDebt, "personal loan obligation was not created");
const moneyAfterLoan = borrowed.kernel.accounts
  .filter((account) => [borrowed.player.id, creditorResident.id, creditorHousehold.id].includes(account.entityId))
  .reduce((sum, account) => sum + (account.balances.find((entry) => entry.resource === "credits")?.amount ?? 0), 0);
assert(close(moneyBeforeLoan, moneyAfterLoan), "personal loan created or destroyed money");
assert(close(borrowedResident.savings, borrowed.kernel.accounts.find((account) => account.entityId === creditorResident.id)?.balances.find((entry) => entry.resource === "credits")?.amount ?? 0), "resident savings are not projected from the ledger");
const repaid = payPlayerObligation(borrowed, personalDebt.id);
const repaidResident = repaid.population.residents.find((resident) => resident.id === creditorResident.id);
assert(repaidResident && close(repaidResident.savings, borrowedResident.savings + personalDebt.amount), "personal repayment did not credit canonical resident funds");

console.log(JSON.stringify({
  buildingExit: leftHome.localScene.playerPosition.state,
  vehicleExit: leftVehicle.localScene.playerPosition.state,
  fatigueAfter120m: oneChunk.player.condition.fatigue,
  hungerAfter120m: oneChunk.player.condition.hunger,
  dayBoundaryAccounts: manyChunks.kernel.accounts.length,
  dayBoundaryReconciliations: manyChunks.kernel.integrity.reconciliationTransactions,
  legacySyntheticAccounts: compactedLegacyKernel.kernel.accounts.filter((account) => account.entityId.startsWith("consumer-pool:") || account.entityId.startsWith("workforce-pool:")).length,
  exactLocationAfterStreetWalk: getPlayerExactLocationId(arrivedAtPoint),
  nextRentCode: nextRent.code,
  loanAmount: personalDebt.amount
}, null, 2));
