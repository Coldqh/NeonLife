import { createWorldSession } from "../src/world/generation/createWorld";
import { progressLife } from "../src/gameplay/life/lifeSimulation";
import { projectProductInventoryState } from "../src/simulation/inventory/inventorySystem";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const seed = "runtime-performance-regression-49";
const creationStartedAt = performance.now();
const session = createWorldSession(seed);
const creationMs = performance.now() - creationStartedAt;

const projectionInput = {
  seed: session.world.meta.seed,
  timestamp: session.timestamp,
  playerId: session.player.id,
  worldCore: session.worldCore,
  production: session.production,
  urban: session.urban,
  population: session.population,
  food: session.life.food,
  previous: session.productInventory
};

projectProductInventoryState(session.productInventory, projectionInput);
let projectionMs = 0;
for (let index = 0; index < 5; index += 1) {
  const startedAt = performance.now();
  projectProductInventoryState(session.productInventory, projectionInput);
  projectionMs += performance.now() - startedAt;
}
projectionMs /= 5;

const hourStartedAt = performance.now();
progressLife(session, 60, { suppressTimeEvent: true });
const hourMs = performance.now() - hourStartedAt;

assert(creationMs < 3_000, `world creation exceeded 3000ms: ${Math.round(creationMs)}ms`);
assert(projectionMs < 120, `inventory projection exceeded 120ms: ${Math.round(projectionMs)}ms`);
assert(hourMs < 1_800, `hourly simulation exceeded 1800ms: ${Math.round(hourMs)}ms`);

console.log(JSON.stringify({
  businesses: session.worldCore.businesses.length,
  inventories: session.productInventory.inventories.length,
  stacks: session.productInventory.inventories.reduce((sum, inventory) => sum + inventory.stacks.length, 0),
  creationMs: Math.round(creationMs),
  projectionMs: Math.round(projectionMs * 100) / 100,
  hourMs: Math.round(hourMs)
}, null, 2));
