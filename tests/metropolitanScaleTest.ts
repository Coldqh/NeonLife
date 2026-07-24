import { createWorldSession } from "../src/world/generation/createWorld";
import { progressLife } from "../src/gameplay/life/lifeSimulation";
import { advanceMetropolitanState } from "../src/simulation/spatial/metropolitanSystem";
import { migrateEnvelope } from "../src/core/saves/migrations";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const DAY_MS = 24 * 60 * 60_000;
let session = createWorldSession("METROPOLITAN-SCALE-22");
const metro = session.metropolitan;

assert(metro.config.widthM === 42_000, "city width is not metropolitan scale");
assert(metro.config.heightM === 36_000, "city height is not metropolitan scale");
assert(metro.sectors.length === 42 * 36, "sector grid is incomplete");
assert(metro.totals.representedPopulation >= 5_000_000, "represented population is not metropolitan");
assert(metro.totals.estimatedBuildings > 30_000, "building estimate is too small");
assert(metro.locations.length === session.world.locations.length, "not every existing location has a physical placement");
assert(new Set(metro.locations.map((item) => item.locationId)).size === metro.locations.length, "location placements are duplicated");
assert(metro.streaming.activeSectorIds.length <= metro.config.maxActiveSectors, "active sector budget exceeded");
assert(metro.streaming.warmSectorIds.length <= metro.config.maxWarmSectors, "warm sector budget exceeded");
assert(metro.streaming.estimatedMemoryMb <= metro.config.memoryBudgetMb, "initial memory budget exceeded");
assert(metro.roadLinks.length > 100, "arterial road graph is missing");
assert(metro.transitLines.length >= 3, "mass transit lines are missing");

const locationIds = metro.locations.map((item) => item.locationId);
let isolated = metro;
let peak = isolated.streaming.estimatedMemoryMb;
for (let day = 1; day <= 90; day += 1) {
  const targetLocationId = locationIds[day % locationIds.length];
  const advanced = advanceMetropolitanState(isolated, {
    timestamp: session.timestamp + day * DAY_MS,
    seed: session.world.meta.seed,
    activeLocationId: targetLocationId,
    targetLocationId,
    districts: session.world.districts,
    locations: session.world.locations,
    representedPopulationByDistrict: session.population.lifecycle.representedPopulationByDistrict,
    transportServiceLevel: 72,
    dataServiceLevel: 68,
    recentEventCount: 760,
    recentObservationCount: 12_000
  });
  isolated = advanced.state;
  peak = Math.max(peak, isolated.streaming.estimatedMemoryMb);
  assert(isolated.streaming.activeSectorIds.length <= isolated.config.maxActiveSectors, `active cache exceeded on day ${day}`);
  assert(isolated.streaming.warmSectorIds.length <= isolated.config.maxWarmSectors, `warm cache exceeded on day ${day}`);
  assert(isolated.streaming.materializedResidentCount <= isolated.config.maxMaterializedResidents, `resident materialization exceeded on day ${day}`);
  assert(isolated.streaming.materializedInteriorCount <= isolated.config.maxMaterializedInteriors, `interior materialization exceeded on day ${day}`);
  assert(isolated.streaming.estimatedMemoryMb <= isolated.config.memoryBudgetMb, `memory budget exceeded on day ${day}`);
  assert(isolated.sectors.filter((sector) => sector.detailLevel === "cold").every((sector) => sector.materializedResidentCount === 0 && sector.materializedInteriorCount === 0), `cold sector kept detailed state on day ${day}`);
}
assert(isolated.streaming.sectorsEvicted > 0, "streaming never evicted sectors");
assert(isolated.streaming.compactions >= 10, "weekly compaction did not run");
assert(isolated.archive.length > 0, "spatial archive summaries were not created");
assert(peak <= isolated.config.memoryBudgetMb, "peak memory exceeded budget");

const target = session.world.locations.find((item) => item.id !== session.life.currentLocationId) ?? session.world.locations[0];
const previousFocus = session.metropolitan.streaming.focusSectorId;
session = progressLife(session, 24 * 60, {
  targetLocationId: target.id,
  activity: "METROPOLITAN STREAMING INTEGRATION",
  suppressTimeEvent: true,
  trackBalance: false
});
assert(session.metropolitan.streaming.focusSectorId !== previousFocus || session.metropolitan.locations.find((item) => item.locationId === target.id)?.sectorId === previousFocus, "life simulation did not update spatial focus");
assert(session.kernel.integrity.healthy, `kernel failed after metropolitan integration: ${session.kernel.integrity.warnings.join(" | ")}`);

const legacy = structuredClone(session) as any;
legacy.schemaVersion = 19;
legacy.world.city.population = 420_000;
legacy.world.districts = legacy.world.districts.map((district: any, index: number) => ({ ...district, population: [210_000, 130_000, 80_000][index] ?? 50_000 }));
legacy.population.lifecycle.representedPopulationByDistrict = Object.fromEntries(legacy.world.districts.map((district: any) => [district.id, district.population]));
delete legacy.metropolitan;
const migrated = migrateEnvelope({
  slotId: "slot-1",
  schemaVersion: 19,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  checksum: "legacy",
  payload: legacy
}, "slot-1");
assert(migrated, "migration returned null");
assert(migrated.schemaVersion === 25, "migration schema mismatch");
assert(migrated.payload.metropolitan.version === 1, "metropolitan state was not created during migration");
assert(migrated.payload.world.city.population >= 5_000_000, "legacy city was not expanded to metropolitan represented scale");
assert(migrated.payload.metropolitan.totals.representedPopulation === migrated.payload.world.city.population, "metropolitan and world population diverged");

console.log(JSON.stringify({
  cityKm: `${metro.config.widthM / 1000}x${metro.config.heightM / 1000}`,
  sectors: metro.sectors.length,
  population: metro.totals.representedPopulation,
  buildings: metro.totals.estimatedBuildings,
  roadKm: Math.round(metro.totals.roadLengthM / 1000),
  transitKm: Math.round(metro.totals.transitLengthM / 1000),
  activeSectors: isolated.streaming.activeSectorIds.length,
  warmSectors: isolated.streaming.warmSectorIds.length,
  evictedSectors: isolated.streaming.sectorsEvicted,
  compactions: isolated.streaming.compactions,
  peakMemoryMb: peak,
  migrationSchema: migrated.schemaVersion
}, null, 2));
