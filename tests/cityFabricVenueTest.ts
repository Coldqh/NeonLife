import { createWorldSession } from "../src/world/generation/createWorld";
import {
  approachLocalBuilding,
  enterBuildingUnit,
  enterLocalBuilding,
  moveInsideBuilding
} from "../src/gameplay/life/lifeSimulation";
import { getSectorStreetTopology } from "../src/simulation/streets/streetTopologySystem";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const session = createWorldSession("city-fabric-venues-regression");
assert(session.metropolitan.version === 3, "metropolitan fabric did not migrate to version 3");
assert(session.urban.version === 2, "urban fabric did not migrate to version 2");
assert(session.urban.venues.length >= 250, `too few materialized venues: ${session.urban.venues.length}`);
assert(session.urban.venues.length <= 900, `venue cache exceeded hard bound: ${session.urban.venues.length}`);

const buildingById = new Map(session.urban.buildings.map((building) => [building.id, building]));
const unitById = new Map(session.urban.units.map((unit) => [unit.id, unit]));
for (const venue of session.urban.venues) {
  const building = buildingById.get(venue.buildingId);
  const unit = unitById.get(venue.unitId);
  assert(building, `venue ${venue.name} has no building`);
  assert(unit, `venue ${venue.name} has no unit`);
  assert(unit.venueId === venue.id, `venue unit ${unit.unitNumber} is not linked back to venue`);
  assert(unit.buildingId === venue.buildingId, `venue unit belongs to another building`);
}

const categories = new Set(session.urban.venues.map((venue) => venue.category));
assert(categories.size >= 8, `venue diversity is too low: ${[...categories].join(", ")}`);
const generatedVenues = session.urban.venues.filter((venue) => !venue.anchorLocationId);
assert(generatedVenues.length >= 200, "city still relies almost entirely on hand-authored locations");

const nightKitchenLocation = session.world.locations.find((location) => location.name === "NIGHT KITCHEN 14");
assert(nightKitchenLocation, "NIGHT KITCHEN 14 location is missing");
const nightKitchenVenue = session.urban.venues.find((venue) => venue.anchorLocationId === nightKitchenLocation.id);
assert(nightKitchenVenue, "NIGHT KITCHEN 14 was not materialized as a venue");
assert(nightKitchenVenue.category === "food", "NIGHT KITCHEN 14 has the wrong venue category");

const playerSectorId = session.localScene.playerPosition.sectorId;
const localBuildings = session.urban.buildings.filter((building) => building.sectorId === playerSectorId);
const localVenues = session.urban.venues.filter((venue) => venue.sectorId === playerSectorId);
assert(localBuildings.length >= 24, `player sector has too few buildings: ${localBuildings.length}`);
assert(localVenues.length >= 12, `player sector has too few venues: ${localVenues.length}`);

const sector = session.metropolitan.sectors.find((item) => item.id === playerSectorId);
assert(sector, "player sector is missing");
const topology = getSectorStreetTopology(session.streets, {
  timestamp: session.timestamp,
  seed: session.world.meta.seed,
  metropolitan: session.metropolitan,
  urban: session.urban,
  preferredSectorId: sector.id
}, sector.id);
const entranceBuildingIds = new Set(topology.buildingEntrances.map((entrance) => entrance.buildingId));
const connectedBuildings = localBuildings.filter((building) => entranceBuildingIds.has(building.id));
assert(connectedBuildings.length / localBuildings.length >= 0.8, `only ${connectedBuildings.length}/${localBuildings.length} local buildings have street entrances`);

const uniqueLots = new Set(localBuildings.map((building) => `${Math.round(building.bounds.xM)}:${Math.round(building.bounds.yM)}`));
assert(uniqueLots.size / localBuildings.length >= 0.9, "too many buildings share the same generated lot");

let enteredVenue = null as typeof localVenues[number] | null;
let visiting = session;
for (const venue of localVenues) {
  const building = buildingById.get(venue.buildingId);
  const unit = unitById.get(venue.unitId);
  if (!building || !unit || venue.floor !== 1 || !session.localScene.buildings.some((local) => local.buildingId === building.id)) continue;
  let candidate = approachLocalBuilding(session, building.id);
  candidate = enterLocalBuilding(candidate, building.id);
  if (candidate.localScene.playerPosition.state !== "inside" || candidate.localScene.playerPosition.buildingId !== building.id) continue;
  candidate = enterBuildingUnit(candidate, venue.unitId);
  if (candidate.localScene.playerPosition.unitId !== venue.unitId) continue;
  enteredVenue = venue;
  visiting = candidate;
  break;
}
assert(enteredVenue, "no physical venue could be entered in the player sector");
assert(visiting.localScene.playerPosition.unitId === enteredVenue.unitId, `could not enter venue unit ${enteredVenue.name}`);

console.log(JSON.stringify({
  metropolitanVersion: session.metropolitan.version,
  urbanVersion: session.urban.version,
  buildings: session.urban.buildings.length,
  venues: session.urban.venues.length,
  generatedVenues: generatedVenues.length,
  categories: [...categories].sort(),
  localBuildings: localBuildings.length,
  localVenues: localVenues.length,
  streetConnectedBuildings: connectedBuildings.length,
  enteredVenue: enteredVenue.name
}, null, 2));
