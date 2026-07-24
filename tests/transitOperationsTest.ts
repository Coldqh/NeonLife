import { migrateEnvelope } from "../src/core/saves/migrations";
import {
  alightTransitVehicle,
  boardTransitVehicle,
  interactWithTransitPassenger,
  skipTransitJourney,
  rideTransitToNextStop,
  takeTransitSeat,
  travelToLocation,
  usePhoneInTransit,
  yieldTransitSeat
} from "../src/gameplay/life/lifeSimulation";
import { estimateTransitJourney, getTransitBoardingVehicle } from "../src/simulation/transit/transitOperationsSystem";
import { createWorldSession } from "../src/world/generation/createWorld";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function transitInput(session: ReturnType<typeof createWorldSession>) {
  return {
    timestamp: session.timestamp,
    seed: session.world.meta.seed,
    playerId: session.player.id,
    activeLocationId: session.life.currentLocationId,
    playerPosition: session.localScene.playerPosition,
    locations: session.world.locations,
    districts: session.world.districts,
    people: session.people,
    population: session.population,
    metropolitan: session.metropolitan,
    mobility: session.mobility,
    physicalVehicles: session.vehicles
  };
}

const seed = "TRANSIT-OPERATIONS-28";
let session = createWorldSession(seed);

assert(session.schemaVersion === 27, "new world schema is not 27");
assert(session.transit.version === 1, "transit operations version mismatch");
assert(session.transit.stops.length >= 30, "too few physical stops");
assert(session.transit.routes.some((route) => route.mode === "bus"), "bus routes missing");
assert(session.transit.routes.some((route) => route.mode === "metro"), "metro routes missing");
assert(session.transit.vehicles.length > 0, "individual transit vehicles missing");
assert(session.transit.vehicles.every((vehicle) => vehicle.crew.name.length > 0), "transit crew missing");
assert(session.transit.vehicles.some((vehicle) => vehicle.mode === "bus" && vehicle.physicalVehicleId), "bus operations are not linked to physical vehicles");

const localTarget = session.world.locations.find((location) => location.name.includes("NIGHT KITCHEN"));
assert(localTarget, "local transit target missing");
const localEstimate = estimateTransitJourney(session.transit, transitInput(session), session.life.currentLocationId, localTarget.id);
assert(localEstimate, "local transit route was not planned");
assert(localEstimate.segments.length === 1, "local route unexpectedly requires transfers");
assert(localEstimate.segments[0].stopIds.length >= 3, "local route has no interior gameplay legs");

const originalLocationId = session.life.currentLocationId;
session = travelToLocation(session, localTarget.id);
assert(session.transit.player.journey?.phase === "waiting", "travel did not create a waiting transit journey");
assert(session.life.currentLocationId === originalLocationId, "player teleported before boarding");
assert(session.localScene.playerPosition.state === "outside", "waiting player is not at the stop");
assert(getTransitBoardingVehicle(session.transit), "no concrete vehicle arrived for boarding");

const balanceBeforeBoarding = session.player.balance;
session = boardTransitVehicle(session);
assert(session.transit.player.journey?.phase === "onboard", "boarding did not enter transit vehicle");
assert(session.localScene.playerPosition.state === "in-transit", "player spatial state is not in transit");
assert(session.transit.cabin, "transit cabin was not materialized");
assert(session.transit.cabin.seats.length >= 12, "transit cabin has too few seats");
assert(session.transit.cabin.passengers.length >= 6, "transit cabin has too few materialized passengers");
const cabinSeatCount = session.transit.cabin.seats.length;
assert(session.player.balance < balanceBeforeBoarding, "fare was not charged");

const onboardReload = migrateEnvelope({
  slotId: "slot-2",
  schemaVersion: 26,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  checksum: "current",
  payload: structuredClone(session)
}, "slot-2");
assert(onboardReload, "current transit save reload returned null");
assert(onboardReload.payload.transit.player.journey?.phase === "onboard", "onboard journey was lost on reload");
assert(onboardReload.payload.transit.cabin?.seats.length === cabinSeatCount, "transit cabin was lost on reload");

const freeSeat = session.transit.cabin.seats.find((seat) => seat.occupiedBy === null);
assert(freeSeat, "no free seat available for seat gameplay");
session = takeTransitSeat(session, freeSeat.id);
assert(session.transit.player.journey?.seatId === freeSeat.id, "player did not occupy selected seat");
assert(session.transit.cabin?.seats.find((seat) => seat.id === freeSeat.id)?.occupiedBy === "player", "seat map did not mark player");

const priorityPassenger = session.transit.cabin?.passengers.find((passenger) => passenger.standing && passenger.priorityNeed !== "none");
assert(priorityPassenger, "no standing priority passenger generated");
session = yieldTransitSeat(session, priorityPassenger.id);
assert(!session.transit.player.journey?.seatId, "player remained seated after yielding");
assert(session.transit.player.seatsYielded === 1, "yielded seat counter mismatch");
assert(session.transit.cabin?.passengers.find((passenger) => passenger.id === priorityPassenger.id)?.standing === false, "passenger did not take yielded seat");

const passenger = session.transit.cabin?.passengers.find((item) => item.id !== priorityPassenger.id);
assert(passenger, "no passenger available for interaction");
const interactionCount = session.transit.player.passengerInteractions;
session = interactWithTransitPassenger(session, passenger.id);
assert(session.transit.player.passengerInteractions === interactionCount + 1, "passenger interaction was not recorded");
assert(session.transit.cabin?.lastInteraction, "passenger interaction produced no cabin response");

if (session.transit.player.journey?.phase === "onboard") {
  const productiveBefore = session.transit.player.productivePhoneMinutes;
  session = usePhoneInTransit(session, "study");
  assert(session.transit.player.productivePhoneMinutes > productiveBefore, "phone activity did not use travel time");
  assert(session.transit.player.knowledgePoints > 0, "study did not create knowledge progress");
}
while (session.transit.player.journey?.phase === "onboard") {
  session = rideTransitToNextStop(session);
}

assert(session.transit.player.journey?.phase === "arrived", "ride did not reach destination after its legs");
session = alightTransitVehicle(session);
assert(!session.transit.player.journey, "journey remained active after alighting");
assert(session.life.currentLocationId === localTarget.id, "alighting did not update current location");
assert(session.localScene.playerPosition.state === "outside", "alighting did not place player outside");
assert(session.transit.player.completedTrips === 1, "completed trip counter mismatch");

let transferSession = createWorldSession(`${seed}-TRANSFER`);
const crossDistrictTarget = transferSession.world.locations.find((location) => location.districtId !== transferSession.world.activeDistrictId && location.type === "housing");
assert(crossDistrictTarget, "cross-district transit target missing");
const transferEstimate = estimateTransitJourney(transferSession.transit, transitInput(transferSession), transferSession.life.currentLocationId, crossDistrictTarget.id);
assert(transferEstimate, "cross-district journey was not planned");
assert(transferEstimate.segments.length >= 2, "cross-district route has no transfer");
transferSession = travelToLocation(transferSession, crossDistrictTarget.id);
assert(transferSession.transit.player.journey, "transfer journey did not start");
transferSession = skipTransitJourney(transferSession);
assert(!transferSession.transit.player.journey, "skipped journey remained active");
assert(transferSession.life.currentLocationId === crossDistrictTarget.id, "skipped journey did not reach destination");

const legacy = structuredClone(session) as any;
legacy.schemaVersion = 25;
delete legacy.transit;
const migrated = migrateEnvelope({
  slotId: "slot-1",
  schemaVersion: 25,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  checksum: "legacy",
  payload: legacy
}, "slot-1");
assert(migrated, "migration returned null");
assert(migrated.schemaVersion === 27, "migration schema mismatch");
assert(migrated.payload.transit.version === 1, "migration did not create transit operations");
assert(migrated.payload.transit.routes.length > 0, "migration created empty transit routes");

console.log(JSON.stringify({
  stops: session.transit.totals.stops,
  routes: session.transit.totals.routes,
  activeVehicles: session.transit.totals.activeVehicles,
  cabinSeats: cabinSeatCount,
  completedTrips: session.transit.player.completedTrips,
  seatsYielded: session.transit.player.seatsYielded,
  passengerInteractions: session.transit.player.passengerInteractions,
  productivePhoneMinutes: session.transit.player.productivePhoneMinutes,
  transferSegments: transferEstimate.segments.length,
  migrationSchema: migrated.schemaVersion
}, null, 2));
