import { PRODUCT_CATALOG, getProduct } from "../src/data/products/productCatalog";
import { createWorldSession } from "../src/world/generation/createWorld";
import { progressLife } from "../src/gameplay/life/lifeSimulation";
import {
  advanceProductInventoryState,
  businessInventoryId,
  facilityInventoryId,
  getInventoryQuantity,
  householdInventoryId,
  produceProductBatch,
  projectProductInventoryState,
  transferProduct
} from "../src/simulation/inventory/inventorySystem";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const seed = "product-inventory-foundation";
const session = createWorldSession(seed);
assert(PRODUCT_CATALOG.length >= 80, `catalog is too small: ${PRODUCT_CATALOG.length}`);
assert(new Set(PRODUCT_CATALOG.map((product) => product.id)).size === PRODUCT_CATALOG.length, "duplicate product ids");
assert(new Set(PRODUCT_CATALOG.map((product) => product.sku)).size === PRODUCT_CATALOG.length, "duplicate product SKUs");
assert(session.productInventory.integrity.healthy, session.productInventory.integrity.warnings.join(" | "));
assert(session.productInventory.inventories.length > 200, "world inventories were not created");
assert(session.productInventory.batches.length > 200, "initial batches were not created");
const autonomouslyAdvanced = progressLife(session, 24 * 60, { suppressTimeEvent: true });
assert(autonomouslyAdvanced.productInventory.lastUpdatedAt === autonomouslyAdvanced.timestamp, "inventory clock did not advance with the world");
assert(autonomouslyAdvanced.productInventory.integrity.healthy, autonomouslyAdvanced.productInventory.integrity.warnings.join(" | "));
assert(autonomouslyAdvanced.productInventory.totals.batches >= session.productInventory.totals.batches, "production did not create concrete batches during world advance");

const foodPlant = session.production.facilities.find((facility) => facility.name.includes("MIREVA"));
const hub = session.production.facilities.find((facility) => facility.kind === "distribution-hub");
const noodleBusiness = session.worldCore.businesses.find((business) => {
  if (!business.venueId) return false;
  return session.urban.venueOperations.operations.find((operation) => operation.venueId === business.venueId)?.offers.some((offer) => offer.productId === "blueroot-noodles");
});
const household = session.population.households[0];
assert(foodPlant && hub && noodleBusiness && household, "test supply chain entities are missing");

const sourceId = facilityInventoryId(foodPlant.id);
const hubId = facilityInventoryId(hub.id);
const businessId = businessInventoryId(noodleBusiness.id);
const householdId = householdInventoryId(household.id);
const beforeSource = getInventoryQuantity(session.productInventory, sourceId, "blueroot-noodles");
const beforeHub = getInventoryQuantity(session.productInventory, hubId, "blueroot-noodles");
const beforeBusiness = getInventoryQuantity(session.productInventory, businessId, "blueroot-noodles");
const beforeHousehold = getInventoryQuantity(session.productInventory, householdId, "blueroot-noodles");

let inventory = produceProductBatch(session.productInventory, seed, foodPlant.id, "blueroot-noodles", 120, session.timestamp, 83, foodPlant.recipeIds[0]);
assert(getInventoryQuantity(inventory, sourceId, "blueroot-noodles") === beforeSource + 120, "specific production batch was not created");
const producedBatch = inventory.batches[inventory.batches.length - 1];
assert(producedBatch.productId === "blueroot-noodles" && producedBatch.quantityProduced === 120, "wrong produced batch");
assert(producedBatch.lotCode.length > 8 && producedBatch.expiresAt !== undefined, "batch traceability is incomplete");

let transfer = transferProduct(inventory, sourceId, hubId, "blueroot-noodles", 120, session.timestamp + 60_000, "shipment", 7);
inventory = transfer.state;
assert(transfer.transferred === 120, "plant to hub shipment failed");
assert(getInventoryQuantity(inventory, sourceId, "blueroot-noodles") === beforeSource, "plant inventory did not decrease");
assert(getInventoryQuantity(inventory, hubId, "blueroot-noodles") === beforeHub + 120, "hub inventory did not increase");

transfer = transferProduct(inventory, hubId, businessId, "blueroot-noodles", 120, session.timestamp + 120_000, "wholesale", 12);
inventory = transfer.state;
assert(transfer.transferred === 120, "hub to business shipment failed");
assert(getInventoryQuantity(inventory, businessId, "blueroot-noodles") === beforeBusiness + 120, "business did not receive SKU stock");

transfer = transferProduct(inventory, businessId, householdId, "blueroot-noodles", 17, session.timestamp + 180_000, "household-purchase", getProduct("blueroot-noodles").basePrice);
inventory = transfer.state;
assert(transfer.transferred === 17, "household purchase failed");
assert(getInventoryQuantity(inventory, businessId, "blueroot-noodles") === beforeBusiness + 103, "business stock should be 103 units above baseline");
assert(getInventoryQuantity(inventory, householdId, "blueroot-noodles") === beforeHousehold + 17, "household pantry did not receive product");
assert(inventory.transfers.slice(-3).every((item) => item.productId === "blueroot-noodles" && item.batchId), "batch lineage was lost in transfers");

inventory = produceProductBatch(inventory, seed, foodPlant.id, "dockyard-stew-04", 5, session.timestamp, 76, foodPlant.recipeIds[0]);
const expiryTimestamp = session.timestamp + 6 * 60 * 60_000;
const advanced = advanceProductInventoryState({
  seed,
  timestamp: expiryTimestamp,
  playerId: session.player.id,
  worldCore: session.worldCore,
  production: session.production,
  urban: session.urban,
  population: session.population,
  food: session.life.food,
  previous: inventory
});
const expiredStew = advanced.inventories.flatMap((item) => item.stacks).filter((stack) => stack.productId === "dockyard-stew-04" && stack.status === "expired");
assert(expiredStew.some((stack) => stack.quantity >= 5), "short-life batch did not expire");
assert(advanced.integrity.healthy, advanced.integrity.warnings.join(" | "));

const projected = projectProductInventoryState(advanced, {
  seed,
  timestamp: expiryTimestamp,
  playerId: session.player.id,
  worldCore: session.worldCore,
  production: session.production,
  urban: session.urban,
  population: session.population,
  food: session.life.food,
  previous: advanced
});
const projectedHousehold = projected.population.households.find((item) => item.id === household.id);
assert(projectedHousehold?.pantry.some((item) => item.productId === "blueroot-noodles" && item.units === beforeHousehold + 17), "household adapter was not projected from canonical inventory");
const projectedOperation = noodleBusiness.venueId ? projected.urban.venueOperations.operations.find((item) => item.venueId === noodleBusiness.venueId) : undefined;
assert(projectedOperation?.offers.find((offer) => offer.productId === "blueroot-noodles")?.stock === beforeBusiness + 103, "venue stock adapter was not projected from canonical inventory");
const feedbackCheck = advanceProductInventoryState({
  seed,
  timestamp: expiryTimestamp + 60_000,
  playerId: session.player.id,
  worldCore: projected.worldCore,
  production: projected.production,
  urban: projected.urban,
  population: projected.population,
  food: projected.food,
  previous: projected.state
});
assert(getInventoryQuantity(feedbackCheck, businessId, "blueroot-noodles") === beforeBusiness + 103, "adapter projection fed stock back into canonical inventory");
assert(feedbackCheck.integrity.healthy, feedbackCheck.integrity.warnings.join(" | "));

console.log(JSON.stringify({
  catalogProducts: PRODUCT_CATALOG.length,
  inventories: advanced.inventories.length,
  batches: advanced.batches.length,
  transfers: advanced.transfers.length,
  producedLot: producedBatch.lotCode,
  businessNoodleDelta: getInventoryQuantity(advanced, businessId, "blueroot-noodles") - beforeBusiness,
  householdNoodleDelta: getInventoryQuantity(advanced, householdId, "blueroot-noodles") - beforeHousehold,
  expiredStewUnits: expiredStew.reduce((sum, stack) => sum + stack.quantity, 0),
  integrityWarnings: advanced.integrity.warnings
}, null, 2));
