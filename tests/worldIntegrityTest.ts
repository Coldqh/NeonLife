import { createWorldSession } from "../src/world/generation/createWorld";
import {
  approachLocalBuilding,
  enterLocalBuilding,
  enterPhysicalVehicle,
  getPlayerExactLocationId,
  leaveLocalBuilding,
  leavePhysicalVehicle,
  payPlayerObligation,
  progressLife,
  requestEmergencyLoan,
  skipLocalMovement,
  startLocalMovement
} from "../src/gameplay/life/lifeSimulation";
import { localMovementTargetForPoint } from "../src/simulation/localMovement/localMovementSystem";
import { getSectorStreetTopology } from "../src/simulation/streets/streetTopologySystem";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function close(left: number, right: number, epsilon = 0.0001): boolean {
  return Math.abs(left - right) <= epsilon;
}

const seed = "world-integrity-regression";
const created = createWorldSession(seed);
const homeBuilding = created.urban.buildings.find((building) => building.anchorLocationId === created.life.housing.locationId);
assert(homeBuilding, "home building is missing");

const approachedHome = approachLocalBuilding(created, homeBuilding.id);
const enteredHome = enterLocalBuilding(approachedHome, homeBuilding.id);
assert(enteredHome.localScene.playerPosition.state === "inside", "player could not enter home building");
const leftHome = leaveLocalBuilding(enteredHome);
assert(leftHome.localScene.playerPosition.state === "outside", "player could not leave building");
assert(!leftHome.localScene.playerPosition.buildingId, "building id survived exit");

const ownedVehicleId = leftHome.vehicles.player.ownedVehicleIds[0];
const ownedVehicle = leftHome.vehicles.vehicles.find((vehicle) => vehicle.id === ownedVehicleId);
assert(ownedVehicle, "owned vehicle is missing");
const vehicleReady = {
  ...leftHome,
  localScene: {
    ...leftHome.localScene,
    playerPosition: {
      sectorId: ownedVehicle.position.sectorId,
      xM: ownedVehicle.position.xM,
      yM: ownedVehicle.position.yM,
      locationId: ownedVehicle.position.locationId,
      state: "outside" as const,
      updatedAt: leftHome.timestamp
    }
  },
  vehicles: {
    ...leftHome.vehicles,
    vehicles: leftHome.vehicles.vehicles.map((vehicle) => vehicle.id === ownedVehicle.id
      ? { ...vehicle, visible: true, nearby: true, distanceToPlayerM: 0, playerCanEnter: true, playerCanDrive: true, state: "parked" as const }
      : vehicle)
  }
};
const enteredVehicle = enterPhysicalVehicle(vehicleReady, ownedVehicle.id);
assert(enteredVehicle.localScene.playerPosition.state === "vehicle", "player could not enter owned vehicle");
const leftVehicle = leavePhysicalVehicle(enteredVehicle);
assert(leftVehicle.localScene.playerPosition.state === "outside", "player could not leave vehicle");
assert(!leftVehicle.vehicles.player.currentVehicleId, "vehicle state survived exit");

const needsSeed = `${seed}:needs`;
const oneChunk = progressLife(createWorldSession(needsSeed), 120, { suppressTimeEvent: true });
let manyChunks = createWorldSession(needsSeed);
for (let step = 0; step < 10; step += 1) manyChunks = progressLife(manyChunks, 12, { suppressTimeEvent: true });
assert(close(oneChunk.player.condition.fatigue, manyChunks.player.condition.fatigue), "fatigue depends on time chunk size");
assert(close(oneChunk.player.condition.hunger, manyChunks.player.condition.hunger), "hunger depends on time chunk size");

const walkingCreated = createWorldSession(`${seed}:walking`);
const focus = walkingCreated.metropolitan.sectors.find((sector) => sector.id === walkingCreated.localScene.playerPosition.sectorId)
  ?? walkingCreated.metropolitan.sectors[0];
const topology = getSectorStreetTopology(walkingCreated.streets, {
  timestamp: walkingCreated.timestamp,
  seed: walkingCreated.world.meta.seed,
  metropolitan: walkingCreated.metropolitan,
  urban: walkingCreated.urban,
  preferredSectorId: focus.id
}, focus.id);
const originNode = topology.intersections[0];
assert(originNode, "street origin is missing");
const walkingBase = {
  ...walkingCreated,
  localScene: {
    ...walkingCreated.localScene,
    playerPosition: {
      sectorId: focus.id,
      xM: originNode.xM,
      yM: originNode.yM,
      locationId: walkingCreated.life.currentLocationId,
      state: "outside" as const,
      updatedAt: walkingCreated.timestamp
    }
  }
};
const targetNode = [...topology.intersections]
  .sort((left, right) => Math.hypot(right.xM - originNode.xM, right.yM - originNode.yM)
    - Math.hypot(left.xM - originNode.xM, left.yM - originNode.yM))[0];
assert(targetNode, "street target is missing");
const streetTarget = localMovementTargetForPoint(walkingBase, focus.id, targetNode.xM, targetNode.yM, "Свободная точка");
const arrivedAtPoint = skipLocalMovement(startLocalMovement(walkingBase, streetTarget));
assert(arrivedAtPoint.localMovement?.status === "arrived", "free street route did not finish");
assert(getPlayerExactLocationId(arrivedAtPoint) === null, "free street movement retained stale named location");

const rentBase = createWorldSession(`${seed}:rent`);
const rentSession = { ...rentBase, player: { ...rentBase.player, balance: 10_000 } };
const rent = rentSession.pressure.obligations.find((obligation) => obligation.type === "rent" && obligation.status === "active");
assert(rent, "active rent obligation is missing");
const rentPaid = payPlayerObligation(rentSession, rent.id);
const nextRent = rentPaid.pressure.obligations.find((obligation) => obligation.type === "rent" && obligation.status === "active");
assert(rentPaid.pressure.obligations.some((obligation) => obligation.id === rent.id && obligation.status === "paid"), "paid rent was not archived");
assert(nextRent && nextRent.id !== rent.id, "next weekly rent obligation was not created");
assert(nextRent.dueAt === rentPaid.life.housing.paidUntil, "next rent due date does not match housing period");

const loanBase = createWorldSession(`${seed}:loan`);
const creditor = loanBase.people.people[0];
const creditorResident = loanBase.population.residents.find((resident) => resident.activePersonId === creditor.id);
assert(creditorResident, "creditor resident is missing");
const creditorHousehold = loanBase.population.households.find((household) => household.id === creditorResident.householdId);
assert(creditorHousehold, "creditor household is missing");
const loanReady = {
  ...loanBase,
  people: {
    ...loanBase.people,
    people: loanBase.people.people.map((person) => person.id === creditor.id ? { ...person, trustToPlayer: 80, money: 500 } : person)
  },
  population: {
    ...loanBase.population,
    residents: loanBase.population.residents.map((resident) => resident.id === creditorResident.id ? { ...resident, savings: 1_000 } : resident)
  }
};
const moneyBeforeLoan = loanReady.player.balance + 1_000 + creditorHousehold.balance;
const borrowed = requestEmergencyLoan(loanReady, creditor.id);
const borrowedResident = borrowed.population.residents.find((resident) => resident.id === creditorResident.id);
const borrowedHousehold = borrowed.population.households.find((household) => household.id === creditorHousehold.id);
assert(borrowedResident && borrowedHousehold, "creditor finance state disappeared after loan");
const personalDebt = borrowed.pressure.obligations.find((obligation) => obligation.type === "personal" && obligation.creditorPersonId === creditor.id && obligation.status === "active");
assert(personalDebt, "personal loan obligation was not created");
const moneyAfterLoan = borrowed.player.balance + borrowedResident.savings + borrowedHousehold.balance;
assert(close(moneyBeforeLoan, moneyAfterLoan), "personal loan created or destroyed money");
const repaid = payPlayerObligation(borrowed, personalDebt.id);
const repaidResident = repaid.population.residents.find((resident) => resident.id === creditorResident.id);
assert(repaidResident && close(repaidResident.savings, borrowedResident.savings + personalDebt.amount), "personal repayment did not credit canonical resident funds");

console.log(JSON.stringify({
  buildingExit: leftHome.localScene.playerPosition.state,
  vehicleExit: leftVehicle.localScene.playerPosition.state,
  fatigueAfter120m: oneChunk.player.condition.fatigue,
  hungerAfter120m: oneChunk.player.condition.hunger,
  exactLocationAfterStreetWalk: getPlayerExactLocationId(arrivedAtPoint),
  nextRentCode: nextRent.code,
  loanAmount: personalDebt.amount
}, null, 2));
