import { migrateEnvelope } from "../src/core/saves/migrations";
import {
  approachLocalBuilding,
  enterBuildingUnit,
  enterInteriorRoom,
  enterLocalBuilding,
  leaveBuildingUnit,
  leaveInteriorRoom,
  leaveLocalBuilding,
  moveInsideBuilding
} from "../src/gameplay/life/lifeSimulation";
import { createWorldSession } from "../src/world/generation/createWorld";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const seed = "BUILDING-ACCESS-26";
let session = createWorldSession(seed);

assert(session.schemaVersion === 27, "new world schema is not 27");
assert(session.buildingAccess.version === 1, "building access version mismatch");
assert(session.localScene.playerPosition.buildingId, "player did not start inside home building");
assert(session.buildingAccess.player.level === "building", "player access level did not start inside building");
const homeUnit = session.urban.units.find((unit) => unit.tenantEntityId === session.player.id);
assert(homeUnit, "player home unit was not materialized");
assert(homeUnit.unitNumber === "01-P1", "player home unit number is unstable");

session = leaveLocalBuilding(session);
assert(session.buildingAccess.player.level === "street", "leaving building did not move player to street");
assert(!session.localScene.playerPosition.buildingId, "street position still references building");

let accessible = session.buildingAccess.buildingEntries
  .filter((entry) => entry.publicDecision === "open" || entry.publicDecision === "authorized" || entry.serviceDecision === "open" || entry.serviceDecision === "authorized")
  .sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM)[0];
assert(accessible, "active sector has no accessible building");
if (accessible.distanceToPlayerM > 20) session = approachLocalBuilding(session, accessible.buildingId);
accessible = session.buildingAccess.buildingEntries.find((entry) => entry.buildingId === accessible.buildingId) ?? accessible;
assert(accessible.distanceToPlayerM <= 20, "approach did not bring player to entrance");
const entrance = accessible.publicDecision === "open" || accessible.publicDecision === "authorized" ? "public" : "service";
session = enterLocalBuilding(session, accessible.buildingId, entrance);
assert(session.localScene.playerPosition.buildingId === accessible.buildingId, "entry did not move player inside building");
assert(session.buildingAccess.player.level === "building", "entry access level mismatch");
assert(session.buildingAccess.floors.length > 0, "building floors were not materialized");
assert(session.buildingAccess.units.length > 0, "building units were not materialized");
assert(session.urban.interiors.some((interior) => interior.buildingId === accessible.buildingId && !interior.unitId), "building lobby interior missing");

const otherFloor = session.buildingAccess.floors.find((floor) => floor.floor !== 1 && floor.accessible);
if (otherFloor) {
  const method = otherFloor.elevatorAvailable ? "elevator" : "stairs";
  session = moveInsideBuilding(session, otherFloor.floor, method);
  assert(session.localScene.playerPosition.floor === otherFloor.floor, "vertical movement did not change floor");
}

let enterableUnit = session.buildingAccess.units.find((unit) => unit.floor === (session.localScene.playerPosition.floor ?? 1) && (unit.decision === "open" || unit.decision === "authorized"));
if (!enterableUnit) {
  const floorWithUnit = session.buildingAccess.floors.find((floor) => floor.accessible && session.buildingAccess.units.some((unit) => unit.floor === floor.floor && (unit.decision === "open" || unit.decision === "authorized")));
  if (floorWithUnit) {
    session = moveInsideBuilding(session, floorWithUnit.floor, floorWithUnit.elevatorAvailable ? "elevator" : "stairs");
    enterableUnit = session.buildingAccess.units.find((unit) => unit.floor === floorWithUnit.floor && (unit.decision === "open" || unit.decision === "authorized"));
  }
}

if (enterableUnit) {
  session = enterBuildingUnit(session, enterableUnit.unitId);
  assert(session.localScene.playerPosition.unitId === enterableUnit.unitId, "unit entry did not update player position");
  assert(session.buildingAccess.player.level === "unit", "unit access level mismatch");
  assert(session.buildingAccess.rooms.length > 0, "unit interior rooms were not materialized");
  const room = session.buildingAccess.rooms[0];
  session = enterInteriorRoom(session, room.roomId);
  assert(session.localScene.playerPosition.roomId === room.roomId, "room entry did not update player position");
  assert(session.buildingAccess.player.level === "room", "room access level mismatch");
  session = leaveInteriorRoom(session);
  assert(session.buildingAccess.player.level === "unit", "leaving room did not return to unit");
  session = leaveBuildingUnit(session);
  assert(session.buildingAccess.player.level === "building", "leaving unit did not return to building");
}

const enteredFloorCount = session.buildingAccess.floors.length;
const enteredUnitCount = session.buildingAccess.units.length;
const enteredRoomCount = session.buildingAccess.rooms.length;
session = leaveLocalBuilding(session);
const deniedBefore = session.buildingAccess.totals.deniedAttempts;
let locked = session.buildingAccess.buildingEntries
  .filter((entry) => entry.publicDecision === "locked" && entry.serviceDecision !== "open" && entry.serviceDecision !== "authorized")
  .sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM)[0];
if (locked) {
  if (locked.distanceToPlayerM > 20) session = approachLocalBuilding(session, locked.buildingId);
  session = enterLocalBuilding(session, locked.buildingId, "public");
  assert(session.buildingAccess.player.level === "street", "locked entrance moved player inside");
  assert(session.buildingAccess.totals.deniedAttempts === deniedBefore + 1, "denied access counter did not increase");
}

const legacy = structuredClone(session) as any;
legacy.schemaVersion = 23;
delete legacy.buildingAccess;
const migrated = migrateEnvelope({
  slotId: "slot-1",
  schemaVersion: 23,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  checksum: "legacy",
  payload: legacy
}, "slot-1");
assert(migrated, "migration returned null");
assert(migrated.schemaVersion === 27, "migration schema mismatch");
assert(migrated.payload.buildingAccess.version === 1, "migration did not create building access state");
assert(
  migrated.payload.buildingAccess.player.level !== "street"
    || migrated.payload.localScene.playerPosition.state === "outside",
  "migration building access diverged from local scene"
);

console.log(JSON.stringify({
  homeBuilding: homeUnit.buildingId,
  enteredBuilding: accessible.buildingId,
  floors: enteredFloorCount,
  units: enteredUnitCount,
  rooms: enteredRoomCount,
  visitedBuildings: session.buildingAccess.visitedBuildingIds.length,
  visitedUnits: session.buildingAccess.visitedUnitIds.length,
  deniedAttempts: session.buildingAccess.totals.deniedAttempts,
  migrationSchema: migrated.schemaVersion
}, null, 2));
