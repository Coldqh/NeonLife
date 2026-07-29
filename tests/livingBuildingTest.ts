import { FOOD_CATALOG } from "../src/data/products/foodCatalog";
import {
  approachLocalBuilding,
  buyFoodAtCurrentLocation,
  enterBuildingUnit,
  enterInteriorRoom,
  enterLocalBuilding,
  enterPlayerHomeUnit,
  leaveBuildingUnit,
  leaveInteriorRoom,
  leaveLocalBuilding,
  moveInsideBuilding
} from "../src/gameplay/life/lifeSimulation";
import { getPlayerHomeUnit } from "../src/gameplay/life/playerPresence";
import { createWorldSession } from "../src/world/generation/createWorld";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const seed = "living-building-regression";
const created = createWorldSession(seed);
const homeBuilding = created.urban.buildings.find((building) => building.anchorLocationId === created.life.housing.locationId);
assert(homeBuilding, "home building missing");

const approached = approachLocalBuilding(created, homeBuilding.id);
const entered = enterLocalBuilding(approached, homeBuilding.id);
assert(entered.localScene.playerPosition.state === "inside", "building entry failed");
assert(entered.localScene.playerPosition.interiorZone === "lobby", "entry did not place player in lobby");
assert(entered.buildingAccess.floors.length >= homeBuilding.floors, "building floors were not materialized");
assert(entered.buildingAccess.units.length > 0, "building units were not materialized");

const homeUnit = getPlayerHomeUnit(entered);
assert(homeUnit, "player home unit missing");
const onHomeFloor = homeUnit.floor === entered.localScene.playerPosition.floor
  ? entered
  : moveInsideBuilding(entered, homeUnit.floor, homeBuilding.elevatorCount > 0 ? "elevator" : "stairs");
const inHome = enterPlayerHomeUnit(onHomeFloor);
assert(inHome.localScene.playerPosition.unitId === homeUnit.id, "player could not enter home unit");
assert(inHome.localScene.playerPosition.interiorZone === "unit", "unit entry did not set physical zone");
assert(moveInsideBuilding(inHome, Math.min(homeBuilding.floors, homeUnit.floor + 1), homeBuilding.elevatorCount > 0 ? "elevator" : "stairs") === inHome, "player moved between floors through a closed unit door");
assert(leaveLocalBuilding(inHome) === inHome, "player exited the building through a unit wall");
assert(inHome.buildingAccess.rooms.length > 0, "unit rooms were not materialized");
assert(inHome.localScene.actors.filter((actor) => actor.visible).every((actor) => actor.position.unitId === homeUnit.id && !actor.position.roomId), "unit visibility leaks through walls");

const room = inHome.buildingAccess.rooms[0];
assert(room, "room access missing");
const inRoom = enterInteriorRoom(inHome, room.roomId);
assert(inRoom.localScene.playerPosition.roomId === room.roomId, "room entry failed");
assert(inRoom.localScene.playerPosition.interiorZone === "room", "room entry did not set physical zone");
assert(inRoom.localScene.actors.filter((actor) => actor.visible).every((actor) => actor.position.roomId === room.roomId), "room visibility leaks through doors");
const backInUnit = leaveInteriorRoom(inRoom);
assert(!backInUnit.localScene.playerPosition.roomId && backInUnit.localScene.playerPosition.unitId === homeUnit.id, "room exit failed");
const inCorridor = leaveBuildingUnit(backInUnit);
assert(!inCorridor.localScene.playerPosition.unitId && inCorridor.localScene.playerPosition.buildingId === homeBuilding.id, "unit exit failed");
const outside = leaveLocalBuilding(inCorridor);
assert(outside.localScene.playerPosition.state === "outside", "building exit failed");

const venueLocation = outside.world.locations.find((location) => (location.type === "market" || location.type === "food") && outside.life.food.shopStocks[location.id]);
assert(venueLocation, "venue with stock missing");
const venueBuilding = outside.urban.buildings.find((building) => building.anchorLocationId === venueLocation.id);
assert(venueBuilding, "venue building missing");
const venueReady = {
  ...outside,
  localScene: {
    ...outside.localScene,
    focusSectorId: venueBuilding.sectorId,
    playerPosition: {
      sectorId: venueBuilding.sectorId,
      xM: venueBuilding.bounds.xM + venueBuilding.bounds.widthM / 2,
      yM: venueBuilding.bounds.yM - 2,
      locationId: venueLocation.id,
      state: "outside" as const,
      updatedAt: outside.timestamp
    },
    buildings: [
      ...outside.localScene.buildings.filter((item) => item.buildingId !== venueBuilding.id),
      {
        buildingId: venueBuilding.id,
        addressCode: venueBuilding.addressCode,
        use: venueBuilding.use,
        distanceToPlayerM: 0,
        publicEntrances: venueBuilding.publicEntrances,
        serviceEntrances: venueBuilding.serviceEntrances,
        security: venueBuilding.security,
        occupiedActorCount: 0,
        playerInside: false
      }
    ]
  }
};
const venueEntered = enterLocalBuilding(venueReady, venueBuilding.id);
assert(venueEntered.localScene.playerPosition.buildingId === venueBuilding.id, "venue entry failed");
const stock = venueEntered.life.food.shopStocks[venueLocation.id];
const product = FOOD_CATALOG.find((item) => (stock?.[item.id] ?? 0) > 0);
assert(product, "venue product missing");
const funded = { ...venueEntered, player: { ...venueEntered.player, balance: 10_000 } };
const purchased = buyFoodAtCurrentLocation(funded, product.id);
assert(purchased.life.food.carried.some((stack) => stack.productId === product.id), "physical venue purchase failed");

const commercialUnits = venueEntered.buildingAccess.units.filter((unit) => unit.floor === 1 && ["shop", "clinic", "office", "workshop"].includes(unit.use));
assert(venueBuilding.commercialUnits === 0 || commercialUnits.length > 0, "commercial building has no physical service unit");

console.log(JSON.stringify({
  homeBuilding: homeBuilding.addressCode,
  homeFloor: homeUnit.floor,
  room: room.kind,
  venue: venueLocation.name,
  product: product.name,
  visibleInRoom: inRoom.localScene.actors.filter((actor) => actor.visible).length
}, null, 2));
