import { migrateEnvelope } from "../src/core/saves/migrations";
import { progressLife } from "../src/gameplay/life/lifeSimulation";
import { getTravelOptions } from "../src/gameplay/travel/travelSystem";
import { createLocalSceneState } from "../src/simulation/localScene/localSceneSystem";
import { createWorldSession } from "../src/world/generation/createWorld";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const seed = "LOCAL-SCENE-25";
let session = createWorldSession(seed);
const initial = session.localScene;

assert(session.schemaVersion === 25, "new world schema is not 25");
assert(initial.version === 1, "local scene version mismatch");
assert(initial.focusSectorId === initial.playerPosition.sectorId, "player focus sector mismatch");
assert(session.metropolitan.streaming.activeSectorIds.includes(initial.focusSectorId), "player is outside active streaming window");
assert(initial.actors.length > 0, "active sectors have no physical actors");
assert(initial.buildings.length > 0, "focus sector has no physical buildings");
assert(initial.actors.every((actor) => session.metropolitan.streaming.activeSectorIds.includes(actor.position.sectorId)), "actor materialized outside active sectors");
assert(initial.actors.every((actor) => {
  const sector = session.metropolitan.sectors.find((item) => item.id === actor.position.sectorId);
  return sector
    && actor.position.xM >= sector.bounds.xM
    && actor.position.xM <= sector.bounds.xM + sector.bounds.widthM
    && actor.position.yM >= sector.bounds.yM
    && actor.position.yM <= sector.bounds.yM + sector.bounds.heightM;
}), "actor position escaped sector bounds");
assert(initial.actors.some((actor) => actor.activePersonId), "known human network did not materialize into local actors");
assert(initial.totals.materializedActors === initial.actors.length, "actor totals are inconsistent");
assert(initial.totals.visibleActors === initial.visibleActorIds.length, "visible actor totals are inconsistent");
assert(initial.totals.nearbyActors === initial.nearbyActorIds.length, "nearby actor totals are inconsistent");

const rebuilt = createLocalSceneState({
  timestamp: session.timestamp,
  seed,
  activeLocationId: session.life.currentLocationId,
  locations: session.world.locations,
  people: session.people,
  population: session.population,
  metropolitan: session.metropolitan,
  urban: session.urban,
  mobility: session.mobility
});
assert(JSON.stringify(rebuilt) === JSON.stringify(initial), "local scene is not deterministic at the same timestamp");

session = progressLife(session, 60, {
  activity: "LOCAL SCENE HOURLY ADVANCE",
  suppressTimeEvent: true,
  trackBalance: false
});
assert(session.localScene.lastUpdatedAt === session.timestamp, "life simulation did not advance local scene");
assert(session.localScene.actors.every((actor) => actor.lastMaterializedAt === session.timestamp), "actor timestamp was not refreshed");

const option = getTravelOptions(session).find((item) => !item.sameDistrict) ?? getTravelOptions(session)[0];
assert(option, "no travel target available");
const previousFocus = session.localScene.focusSectorId;
session = progressLife(session, option.durationMinutes, {
  targetLocationId: option.location.id,
  activity: "LOCAL SCENE TRAVEL",
  suppressTimeEvent: true,
  trackBalance: false
});
assert(session.life.currentLocationId === option.location.id, "travel did not move player location");
assert(session.localScene.playerPosition.locationId === option.location.id, "local scene did not move player position");
assert(session.localScene.focusSectorId === session.metropolitan.streaming.focusSectorId, "local scene and metropolitan focus diverged");
assert(session.localScene.focusSectorId !== previousFocus || option.sameDistrict, "cross-district travel did not change local focus");
assert(session.localScene.actors.every((actor) => session.metropolitan.streaming.activeSectorIds.includes(actor.position.sectorId)), "travel left stale actors outside active sectors");

const legacy = structuredClone(session) as any;
legacy.schemaVersion = 23;
delete legacy.localScene;
const migrated = migrateEnvelope({
  slotId: "slot-1",
  schemaVersion: 23,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  checksum: "legacy",
  payload: legacy
}, "slot-1");
assert(migrated, "migration returned null");
assert(migrated.schemaVersion === 25, "migration schema mismatch");
assert(migrated.payload.localScene.version === 1, "migration did not create local scene");
assert(migrated.payload.localScene.playerPosition.locationId === migrated.payload.life.currentLocationId, "migration lost player spatial position");
assert(migrated.payload.localScene.actors.length > 0, "migration created empty local scene");

console.log(JSON.stringify({
  initialActors: initial.actors.length,
  visibleActors: initial.totals.visibleActors,
  nearbyActors: initial.totals.nearbyActors,
  knownActors: initial.totals.knownActors,
  focusBuildings: initial.buildings.length,
  previousFocus,
  nextFocus: session.localScene.focusSectorId,
  migratedActors: migrated.payload.localScene.actors.length,
  migrationSchema: migrated.schemaVersion
}, null, 2));
