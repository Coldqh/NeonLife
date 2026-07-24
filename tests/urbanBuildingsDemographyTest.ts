import { createWorldSession } from "../src/world/generation/createWorld";
import { advanceUrbanFabricState, synchronizeMetropolitanFromUrban, urbanMemoryHealthy } from "../src/simulation/urban/urbanSystem";
import { advanceMetropolitanState } from "../src/simulation/spatial/metropolitanSystem";
import { migrateEnvelope } from "../src/core/saves/migrations";
import { progressLife } from "../src/gameplay/life/lifeSimulation";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const DAY_MS = 24 * 60 * 60_000;
const seed = "URBAN-BUILDINGS-MASS-23";
let session = createWorldSession(seed);
const initial = session.urban;

assert(initial.catalogs.length === session.metropolitan.sectors.length, "not every sector has a building catalog");
assert(initial.totals.indexedBuildings >= 30_000, "city building stock is too small");
assert(initial.totals.indexedResidentialUnits >= 1_000_000, "city apartment stock is too small");
assert(initial.totals.indexedResidentCapacity >= session.world.city.population, "building capacity is below represented population");
assert(initial.buildings.some((building) => building.scale === "megablock" || building.scale === "megastructure"), "no megablock or megastructure materialized");
assert(initial.buildings.every((building) => building.bounds.widthM > 0 && building.bounds.heightM > 0 && building.floors > 0), "invalid building geometry");
assert(new Set(initial.buildings.map((building) => building.id)).size === initial.buildings.length, "duplicate building ids");
assert(new Set(initial.units.map((unit) => unit.id)).size === initial.units.length, "duplicate unit ids");
assert(initial.householdAddresses.length === session.population.households.filter((household) => household.homeLocationId && household.kind !== "unhoused").length, "not every housed detailed household received an apartment");
assert(initial.householdAddresses.every((address) => initial.units.some((unit) => unit.id === address.unitId && unit.householdId === address.householdId)), "household address points to missing unit");
assert(initial.interiors.length > 0 && initial.interiors.length <= initial.memory.interiorCacheLimit, "interior cache is invalid");
assert(urbanMemoryHealthy(initial), "initial urban cache exceeds memory limits");

const second = createWorldSession(seed).urban;
const firstAnchor = initial.buildings.find((building) => building.permanent);
const secondAnchor = firstAnchor ? second.buildings.find((building) => building.id === firstAnchor.id) : undefined;
assert(firstAnchor && secondAnchor, "deterministic anchor building missing");
assert(JSON.stringify(firstAnchor.bounds) === JSON.stringify(secondAnchor.bounds), "building coordinates are not deterministic");
const firstInterior = initial.interiors[0];
const matchingInterior = second.interiors.find((interior) => interior.id === firstInterior.id);
assert(matchingInterior && JSON.stringify(matchingInterior.rooms) === JSON.stringify(firstInterior.rooms), "interior reconstruction changed for same seed");

let urban = initial;
let metropolitan = session.metropolitan;
for (let month = 1; month <= 120; month += 1) {
  const target = session.world.locations[month % session.world.locations.length];
  const timestamp = session.timestamp + month * 30 * DAY_MS;
  metropolitan = advanceMetropolitanState(metropolitan, {
    timestamp,
    seed,
    activeLocationId: target.id,
    targetLocationId: target.id,
    districts: session.world.districts,
    locations: session.world.locations,
    representedPopulationByDistrict: Object.fromEntries(urban.demography.cohorts.reduce((map, cohort) => {
      map.set(cohort.districtId, (map.get(cohort.districtId) ?? 0) + cohort.population);
      return map;
    }, new Map<string, number>())),
    transportServiceLevel: 72,
    dataServiceLevel: 68,
    recentEventCount: 0,
    recentObservationCount: 0
  }).state;
  const advanced = advanceUrbanFabricState(urban, {
    timestamp,
    seed,
    activeLocationId: target.id,
    targetLocationId: target.id,
    metropolitan,
    districts: session.world.districts,
    locations: session.world.locations,
    organizations: session.world.organizations,
    population: session.population,
    transportServiceLevel: 72,
    dataServiceLevel: 68
  });
  urban = advanced.state;
  metropolitan = synchronizeMetropolitanFromUrban(metropolitan, urban);
  assert(urbanMemoryHealthy(urban), `urban memory limit exceeded in month ${month}`);
  assert(urban.memory.cachedBuildings <= urban.memory.buildingCacheLimit, `building cache exceeded in month ${month}`);
  assert(urban.memory.cachedUnits <= urban.memory.unitCacheLimit, `unit cache exceeded in month ${month}`);
  assert(urban.memory.cachedInteriors <= urban.memory.interiorCacheLimit, `interior cache exceeded in month ${month}`);
  assert(urban.demography.cohorts.every((cohort) => cohort.population > 0), `sector population collapsed in month ${month}`);
}

assert(urban.demography.totals.births > 250_000, "ten-year mass births are unrealistically small");
assert(urban.demography.totals.deaths > 200_000, "ten-year mass deaths are unrealistically small");
assert(urban.demography.totals.immigrants > 200_000, "ten-year immigration is unrealistically small");
assert(urban.demography.totals.emigrants > 150_000, "ten-year emigration is unrealistically small");
assert(urban.demography.totals.internalMoves > 100_000, "internal city migration did not operate");
assert(urban.demography.history.length === 121, "monthly demographic history is incomplete");
assert(metropolitan.totals.representedPopulation === urban.demography.totals.population, "metropolitan population diverged from mass demography");
assert(urban.memory.buildingsEvicted > 0 || urban.memory.interiorsEvicted > 0, "streaming never released urban detail");

session = progressLife(session, 24 * 60, {
  targetLocationId: session.world.locations[3].id,
  activity: "URBAN FABRIC INTEGRATION",
  suppressTimeEvent: true,
  trackBalance: false
});
assert(session.urban.lastUpdatedAt === session.timestamp, "life simulation did not advance urban fabric");
assert(session.world.city.population === session.urban.demography.totals.population, "world population did not sync from mass demography");
assert(session.metropolitan.totals.representedPopulation === session.urban.demography.totals.population, "metropolitan integration diverged");
assert(session.kernel.integrity.healthy, `kernel failed after urban integration: ${session.kernel.integrity.warnings.join(" | ")}`);

const legacy = structuredClone(session) as any;
legacy.schemaVersion = 20;
delete legacy.urban;
const migrated = migrateEnvelope({
  slotId: "slot-1",
  schemaVersion: 20,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  checksum: "legacy",
  payload: legacy
}, "slot-1");
assert(migrated, "migration returned null");
assert(migrated.schemaVersion === 27, "migration schema mismatch");
assert(migrated.payload.urban.version === 1, "urban state was not created during migration");
assert(migrated.payload.urban.catalogs.length === migrated.payload.metropolitan.sectors.length, "migration lost sector building indexes");
assert(migrated.payload.urban.householdAddresses.length > 0, "migration did not assign detailed households to apartments");

console.log(JSON.stringify({
  cityPopulationStart: initial.demography.totals.population,
  cityPopulationAfterTenYears: urban.demography.totals.population,
  births: urban.demography.totals.births,
  deaths: urban.demography.totals.deaths,
  immigrants: urban.demography.totals.immigrants,
  emigrants: urban.demography.totals.emigrants,
  internalMoves: urban.demography.totals.internalMoves,
  indexedBuildings: urban.totals.indexedBuildings,
  residentialUnits: urban.totals.indexedResidentialUnits,
  materializedBuildings: urban.totals.materializedBuildings,
  detailedAddresses: urban.totals.detailedHouseholdAddresses,
  interiors: urban.totals.materializedInteriors,
  peakUrbanMemoryMb: urban.memory.peakEstimatedMemoryMb,
  buildingsEvicted: urban.memory.buildingsEvicted,
  interiorsEvicted: urban.memory.interiorsEvicted,
  migrationSchema: migrated.schemaVersion
}, null, 2));
