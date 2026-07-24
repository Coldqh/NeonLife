import { migrateEnvelope } from "../src/core/saves/migrations";
import {
  approachPhysicalVehicle,
  drivePhysicalVehicleToLocation,
  enterPhysicalVehicle,
  leaveLocalBuilding,
  leavePhysicalVehicle,
  servicePhysicalVehicle
} from "../src/gameplay/life/lifeSimulation";
import { getPhysicalVehicle } from "../src/simulation/vehicles/physicalVehicleSystem";
import { createWorldSession } from "../src/world/generation/createWorld";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const seed = "PHYSICAL-VEHICLES-27";
let session = createWorldSession(seed);

assert(session.schemaVersion === 25, "new world schema is not 25");
assert(session.vehicles.version === 1, "physical vehicles version mismatch");
assert(session.vehicles.vehicles.length > 0, "no vehicles materialized");
assert(session.vehicles.parkingNodes.length > 0, "no parking nodes materialized");
assert(session.vehicles.vehicles.every((vehicle) => {
  const sector = session.metropolitan.sectors.find((item) => item.id === vehicle.position.sectorId);
  return sector
    && vehicle.position.xM >= sector.bounds.xM
    && vehicle.position.xM <= sector.bounds.xM + sector.bounds.widthM
    && vehicle.position.yM >= sector.bounds.yM
    && vehicle.position.yM <= sector.bounds.yM + sector.bounds.heightM;
}), "vehicle position escaped sector bounds");
assert(session.vehicles.player.ownedVehicleIds.length === 1, "starter vehicle ownership missing");

const ownedId = session.vehicles.player.ownedVehicleIds[0];
let owned = getPhysicalVehicle(session.vehicles, ownedId);
assert(owned, "starter vehicle missing");
assert(owned.ownerEntityId === session.player.id, "starter vehicle owner mismatch");
assert(owned.persistent, "starter vehicle is not persistent");
assert(session.kernel.assets.some((asset) => asset.kind === "vehicle" && asset.ownerEntityId === session.player.id), "starter vehicle is missing from kernel assets");
assert(owned.fuelL > 0 && owned.fuelL <= owned.fuelCapacityL, "starter vehicle fuel invalid");

session = leaveLocalBuilding(session);
const lockedVehicle = session.vehicles.vehicles.find((vehicle) => vehicle.visible && vehicle.access === "locked");
assert(lockedVehicle, "no locked vehicle available for denial test");
session = approachPhysicalVehicle(session, lockedVehicle.id);
const deniedEntry = enterPhysicalVehicle(session, lockedVehicle.id);
assert(deniedEntry.localScene.playerPosition.state === "outside", "locked vehicle allowed unauthorized entry");
assert(!deniedEntry.vehicles.player.currentVehicleId, "locked vehicle granted player control");

owned = getPhysicalVehicle(session.vehicles, ownedId);
assert(owned, "starter vehicle disappeared after leaving building");
assert(owned.visible, "starter vehicle is not visible outside home");
if (owned.distanceToPlayerM > 6) session = approachPhysicalVehicle(session, owned.id);
owned = getPhysicalVehicle(session.vehicles, ownedId);
assert(owned && owned.distanceToPlayerM <= 6, "approach did not reach vehicle");

session = enterPhysicalVehicle(session, ownedId);
assert(session.localScene.playerPosition.state === "vehicle", "entering vehicle did not update player presence");
assert(session.localScene.playerPosition.vehicleId === ownedId, "player position lost vehicle id");
assert(session.vehicles.player.currentVehicleId === ownedId, "player control did not bind vehicle");
assert(session.vehicles.player.seat === "driver", "owner did not take driver seat");

const target = session.world.locations.find((location) => location.type === "workshop");
assert(target, "workshop target missing");
const startLocationId = session.life.currentLocationId;
const drySession = {
  ...session,
  vehicles: {
    ...session.vehicles,
    vehicles: session.vehicles.vehicles.map((vehicle) => vehicle.id === ownedId ? { ...vehicle, fuelL: 0 } : vehicle)
  }
};
const rejectedDryTrip = drivePhysicalVehicleToLocation(drySession, target.id);
assert(rejectedDryTrip.life.currentLocationId === startLocationId, "vehicle drove without fuel");
assert(rejectedDryTrip.vehicles.player.tripsCompleted === session.vehicles.player.tripsCompleted, "rejected dry trip changed counters");
const fuelBefore = getPhysicalVehicle(session.vehicles, ownedId)?.fuelL ?? 0;
const odometerBefore = getPhysicalVehicle(session.vehicles, ownedId)?.odometerKm ?? 0;
session = drivePhysicalVehicleToLocation(session, target.id);
assert(session.life.currentLocationId === target.id, "vehicle trip did not change current location");
assert(session.localScene.playerPosition.state === "vehicle", "vehicle trip removed player from car");
owned = getPhysicalVehicle(session.vehicles, ownedId);
assert(owned, "vehicle disappeared after trip");
assert(owned.position.locationId === target.id, "vehicle did not reach destination");
assert(owned.fuelL < fuelBefore, "vehicle trip did not consume fuel");
assert(owned.odometerKm > odometerBefore, "vehicle trip did not update odometer");
assert(session.vehicles.player.tripsCompleted === 1, "vehicle trip counter mismatch");
assert(startLocationId !== session.life.currentLocationId, "vehicle did not leave origin");

session = leavePhysicalVehicle(session);
assert(session.localScene.playerPosition.state === "outside", "leaving vehicle did not return player outside");
assert(!session.vehicles.player.currentVehicleId, "vehicle control remained active after exit");
owned = getPhysicalVehicle(session.vehicles, ownedId);
assert(owned?.state === "parked", "vehicle was not parked after exit");

const balanceBeforeService = session.player.balance;
const conditionBeforeService = owned?.condition ?? 0;
session = servicePhysicalVehicle(session, ownedId);
owned = getPhysicalVehicle(session.vehicles, ownedId);
assert(owned, "vehicle disappeared during service");
assert(owned.condition >= conditionBeforeService, "service reduced vehicle condition");
assert(owned.fuelL === owned.fuelCapacityL, "service did not fill fuel tank");
assert(session.player.balance < balanceBeforeService, "service did not charge player");

const legacy = structuredClone(session) as any;
legacy.schemaVersion = 24;
delete legacy.vehicles;
const migrated = migrateEnvelope({
  slotId: "slot-1",
  schemaVersion: 24,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  checksum: "legacy",
  payload: legacy
}, "slot-1");
assert(migrated, "migration returned null");
assert(migrated.schemaVersion === 25, "migration schema mismatch");
assert(migrated.payload.vehicles.version === 1, "migration did not create physical vehicles");
assert(migrated.payload.vehicles.player.ownedVehicleIds.length === 1, "migration lost starter vehicle ownership");

console.log(JSON.stringify({
  vehicles: session.vehicles.vehicles.length,
  focusVehicles: session.vehicles.totals.focusSectorVehicles,
  parkingNodes: session.vehicles.parkingNodes.length,
  ownedVehicle: owned.id,
  plate: owned.plate,
  fuelL: owned.fuelL,
  condition: owned.condition,
  odometerKm: owned.odometerKm,
  trips: session.vehicles.player.tripsCompleted,
  migrationSchema: migrated.schemaVersion
}, null, 2));
