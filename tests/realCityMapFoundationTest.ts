import { createStableEntityId } from "../src/core/ids/entityId";
import { createMetropolitanState, normalizeMetropolitanState } from "../src/simulation/spatial/metropolitanSystem";
import type { DistrictState } from "../src/world/state/types";
import { createWorldSession } from "../src/world/generation/createWorld";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const seed = "real-city-map-foundation";
const session = createWorldSession(seed);
const metro = session.metropolitan;

assert(session.schemaVersion === 28, "new world schema is not 28");
assert(metro.version === 2, "metropolitan schema was not upgraded");
assert(metro.sectors.length === 1_512, "city sector count changed");
assert(metro.mapDistricts.length >= 10, "map district layer is too coarse");
assert(new Set(metro.mapDistricts.map((district) => district.name)).size === metro.mapDistricts.length, "map district names are not unique");
assert(metro.sectors.every((sector) => metro.mapDistricts.some((district) => district.id === sector.mapDistrictId)), "sector without map district");

const byCoordinate = new Map(metro.sectors.map((sector) => [`${sector.xIndex}:${sector.yIndex}`, sector]));
for (const district of metro.mapDistricts) {
  const allowed = new Set(district.sectorIds);
  assert(allowed.size > 0, `empty map district ${district.name}`);
  const first = metro.sectors.find((sector) => allowed.has(sector.id));
  assert(first, `missing first sector for ${district.name}`);
  const visited = new Set<string>([first.id]);
  const queue = [first];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const sector = queue[cursor];
    const neighbors = [
      byCoordinate.get(`${sector.xIndex - 1}:${sector.yIndex}`),
      byCoordinate.get(`${sector.xIndex + 1}:${sector.yIndex}`),
      byCoordinate.get(`${sector.xIndex}:${sector.yIndex - 1}`),
      byCoordinate.get(`${sector.xIndex}:${sector.yIndex + 1}`)
    ];
    for (const neighbor of neighbors) {
      if (!neighbor || !allowed.has(neighbor.id) || visited.has(neighbor.id)) continue;
      visited.add(neighbor.id);
      queue.push(neighbor);
    }
  }
  assert(visited.size === allowed.size, `map district ${district.name} is disconnected: ${visited.size}/${allowed.size}`);
}

assert(metro.roadNodes.length >= 400, "major road graph is too sparse");
assert(metro.roadLinks.length >= 800, "major road links are too sparse");
assert(["collector", "arterial", "expressway"].every((kind) => metro.roadLinks.some((link) => link.class === kind)), "road hierarchy is incomplete");
assert(metro.roadLinks.every((link) => link.name && link.corridorId && link.trafficLoad >= 0 && link.trafficLoad <= 100), "road metadata is incomplete");
assert(metro.transitLines.length >= 5, "rail network has too few lines");
assert(metro.transitLines.every((line) => line.stationIds.length >= 8), "rail line has too few intermediate stations");

const syntheticDistricts: DistrictState[] = Array.from({ length: 7 }, (_, index) => ({
  ...session.world.districts[index % session.world.districts.length],
  id: createStableEntityId("district", `${seed}:synthetic:${index}`),
  name: `SYNTHETIC ${index + 1}`,
  code: `D${index + 1}`,
  population: 700_000 + index * 40_000,
  locationIds: []
}));
const sevenDistrictMetro = createMetropolitanState({
  timestamp: session.timestamp,
  seed: `${seed}:seven`,
  activeLocationId: "none",
  districts: syntheticDistricts,
  locations: [],
  representedPopulationByDistrict: Object.fromEntries(syntheticDistricts.map((district) => [district.id, district.population])),
  transportServiceLevel: 80,
  dataServiceLevel: 85,
  recentEventCount: 0,
  recentObservationCount: 0
});
for (const district of syntheticDistricts) {
  assert(sevenDistrictMetro.sectors.some((sector) => sector.districtId === district.id), `arbitrary district ${district.name} received no sectors`);
}

const legacy = {
  ...metro,
  version: 1,
  mapDistricts: undefined,
  sectors: metro.sectors.map(({ mapDistrictId: _mapDistrictId, ...sector }) => sector),
  roadLinks: metro.roadLinks.map(({ corridorId: _corridorId, name: _name, trafficLoad: _trafficLoad, ...link }) => link)
};
const normalized = normalizeMetropolitanState(legacy, {
  timestamp: session.timestamp + 60_000,
  seed,
  activeLocationId: session.life.currentLocationId,
  districts: session.world.districts,
  locations: session.world.locations,
  representedPopulationByDistrict: session.population.lifecycle.representedPopulationByDistrict,
  transportServiceLevel: 80,
  dataServiceLevel: 85,
  recentEventCount: session.events.length,
  recentObservationCount: session.data.observations.length
});
assert(normalized.version === 2, "legacy metropolitan state was not upgraded");
assert(normalized.mapDistricts.length >= 10, "legacy state did not receive map districts");
assert(normalized.sectors.map((sector) => sector.id).join("|") === metro.sectors.map((sector) => sector.id).join("|"), "migration changed stable sector ids");
assert(normalized.locations.map((location) => location.locationId).join("|") === metro.locations.map((location) => location.locationId).join("|"), "migration changed location placement ids");

console.log(JSON.stringify({
  sectors: metro.sectors.length,
  mapDistricts: metro.mapDistricts.length,
  roads: metro.roadLinks.length,
  railLines: metro.transitLines.length,
  railStations: metro.transitStations.length,
  arbitraryAdministrativeDistricts: syntheticDistricts.length,
  migrationVersion: normalized.version
}, null, 2));
