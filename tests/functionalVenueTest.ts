import { createWorldSession } from "../src/world/generation/createWorld";
import {
  approachLocalBuilding,
  enterBuildingUnit,
  enterLocalBuilding,
  joinVenueQueue,
  leaveLocalBuilding,
  moveInsideBuilding,
  progressLife,
  purchaseVenueOffer
} from "../src/gameplay/life/lifeSimulation";
import { venueIsOpenAt } from "../src/simulation/venues/venueOperationsSystem";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let session = createWorldSession("functional-venues-regression");
if (session.localScene.playerPosition.state === "inside") session = leaveLocalBuilding(session);
assert(session.localScene.playerPosition.state === "outside", "player could not reach the street before venue test");

const buildingById = new Map(session.urban.buildings.map((building) => [building.id, building]));
const unitById = new Map(session.urban.units.map((unit) => [unit.id, unit]));
const operationByVenueId = new Map(session.urban.venueOperations.operations.map((operation) => [operation.venueId, operation]));
const playerSectorId = session.localScene.playerPosition.sectorId;
const candidates = session.urban.venues
  .filter((venue) => venue.sectorId === playerSectorId && venue.active && venue.operatingStatus === "operating" && venueIsOpenAt(venue, session.timestamp))
  .filter((venue) => {
    const operation = operationByVenueId.get(venue.id);
    return operation?.offers.some((offer) => offer.active && offer.stock > 0 && offer.kind !== "vehicle-service");
  })
  .sort((left, right) => left.floor - right.floor || left.name.localeCompare(right.name));

assert(candidates.length > 0, "no usable open venue exists in the player sector");

let selectedVenue = candidates[0];
let selectedOfferId = "";
let entered = false;
for (const venue of candidates) {
  const building = buildingById.get(venue.buildingId);
  const unit = unitById.get(venue.unitId);
  const operation = operationByVenueId.get(venue.id);
  const offer = operation?.offers.find((item) => item.active && item.stock > 0 && item.kind !== "vehicle-service");
  if (!building || !unit || !offer) continue;

  let candidate = approachLocalBuilding(session, building.id);
  candidate = enterLocalBuilding(candidate, building.id);
  if (candidate.localScene.playerPosition.buildingId !== building.id) continue;
  if ((candidate.localScene.playerPosition.floor ?? 1) !== venue.floor) {
    const method = building.elevatorCount > 0 && building.utilityService >= 25 ? "elevator" as const : "stairs" as const;
    candidate = moveInsideBuilding(candidate, venue.floor, method);
  }
  candidate = enterBuildingUnit(candidate, venue.unitId);
  if (candidate.localScene.playerPosition.unitId !== venue.unitId) continue;
  selectedVenue = venue;
  selectedOfferId = offer.id;
  session = candidate;
  entered = true;
  break;
}

assert(entered, "player could not physically enter a functional venue");
assert(session.localScene.playerPosition.unitId === selectedVenue.unitId, "player is not inside the selected venue unit");

session = { ...session, player: { ...session.player, balance: Math.max(10_000, session.player.balance) } };
const beforeOperation = session.urban.venueOperations.operations.find((item) => item.venueId === selectedVenue.id);
const beforeOffer = beforeOperation?.offers.find((item) => item.id === selectedOfferId);
assert(beforeOperation && beforeOffer, "selected venue operation or offer disappeared");

if (beforeOperation.queue.estimatedWaitMinutes > 0) {
  const beforeQueueTime = session.timestamp;
  session = joinVenueQueue(session, selectedVenue.id);
  const queued = session.urban.venueOperations.operations.find((item) => item.venueId === selectedVenue.id);
  assert(session.timestamp > beforeQueueTime, "joining a non-empty queue did not advance time");
  assert(queued?.queue.playerState === "ready", "player did not reach the front of the queue");
}

const balanceBefore = session.player.balance;
const timestampBefore = session.timestamp;
const receiptsBefore = session.urban.venueOperations.receipts.length;
const stockBefore = session.urban.venueOperations.operations.find((item) => item.venueId === selectedVenue.id)?.offers.find((item) => item.id === selectedOfferId)?.stock ?? -1;
const revenueBefore = session.urban.venueOperations.operations.find((item) => item.venueId === selectedVenue.id)?.revenueToday ?? -1;

session = purchaseVenueOffer(session, selectedVenue.id, selectedOfferId);
const afterOperation = session.urban.venueOperations.operations.find((item) => item.venueId === selectedVenue.id);
const afterOffer = afterOperation?.offers.find((item) => item.id === selectedOfferId);
assert(afterOperation && afterOffer, "venue operation disappeared after purchase");
assert(session.timestamp > timestampBefore, "venue purchase did not consume time");
assert(session.player.balance < balanceBefore, "venue purchase did not charge the player");
assert(afterOffer.stock === stockBefore - 1, `venue stock did not decrease: ${stockBefore} -> ${afterOffer.stock}`);
assert(afterOperation.revenueToday > revenueBefore, "venue revenue did not increase");
assert(session.urban.venueOperations.receipts.length === receiptsBefore + 1, "venue receipt was not recorded");
assert(afterOperation.queue.playerState === "none", "queue state did not reset after service");

const autonomousBefore = {
  revenue: afterOperation.revenueToday,
  expenses: afterOperation.expensesToday,
  stock: afterOperation.offers.reduce((sum, item) => sum + item.stock, 0),
  served: afterOperation.queue.servedToday
};
session = progressLife(session, 60, { category: "personal", title: "Проверка автономной работы заведения", suppressTimeEvent: true });
const autonomousAfter = session.urban.venueOperations.operations.find((item) => item.venueId === selectedVenue.id);
assert(autonomousAfter, "venue operation disappeared during autonomous simulation");
assert(autonomousAfter.lastUpdatedAt === session.timestamp, "venue operation did not advance with world time");
assert(
  autonomousAfter.revenueToday !== autonomousBefore.revenue
    || autonomousAfter.expensesToday !== autonomousBefore.expenses
    || autonomousAfter.offers.reduce((sum, item) => sum + item.stock, 0) !== autonomousBefore.stock
    || autonomousAfter.queue.servedToday !== autonomousBefore.served,
  "venue did not perform any autonomous trade or operating expense during an hour"
);

console.log(JSON.stringify({
  venue: selectedVenue.name,
  category: selectedVenue.category,
  offer: beforeOffer.name,
  price: balanceBefore - session.player.balance,
  stockBefore,
  stockAfter: afterOffer.stock,
  revenueBefore,
  revenueAfter: afterOperation.revenueToday,
  receipts: session.urban.venueOperations.receipts.length,
  timestampAdvancedMinutes: Math.round((session.timestamp - timestampBefore) / 60_000),
  autonomousRevenueNow: autonomousAfter.revenueToday,
  autonomousExpensesNow: autonomousAfter.expensesToday,
  autonomousServedNow: autonomousAfter.queue.servedToday
}, null, 2));
