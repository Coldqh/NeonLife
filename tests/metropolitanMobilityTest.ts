import { migrateEnvelope } from "../src/core/saves/migrations";
import { progressLife } from "../src/gameplay/life/lifeSimulation";
import { getTravelOptions } from "../src/gameplay/travel/travelSystem";
import { advanceMetropolitanMobilityState, synchronizeMetropolitanFromMobility } from "../src/simulation/mobility/mobilitySystem";
import { createWorldSession } from "../src/world/generation/createWorld";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const HOUR_MS = 60 * 60_000;
const seed = "METROPOLITAN-MOBILITY-24";
let session = createWorldSession(seed);
const initial = session.mobility;

assert(session.schemaVersion === 26, "new world schema is not 26");
assert(initial.version === 1, "mobility state version mismatch");
assert(initial.sectorFlows.length === session.metropolitan.sectors.length, "not every sector has a mobility flow");
assert(initial.parking.length === session.metropolitan.sectors.length, "not every sector has physical parking");
assert(initial.routes.some((route) => route.primaryMode === "metro"), "metro routes are missing");
assert(initial.routes.some((route) => route.primaryMode === "bus"), "bus routes are missing");
assert(initial.routes.some((route) => route.primaryMode === "service"), "service routes are missing");
assert(initial.routes.some((route) => route.primaryMode === "freight"), "freight routes are missing");
assert(initial.routes.every((route) => route.pathSectorIds.length > 0 && route.distanceM > 0), "route geometry is invalid");
assert(initial.commuterPlans.length > 20, "detailed residents do not have commuter plans");
assert(initial.fleets.some((fleet) => fleet.mode === "private-car" && fleet.vehicles > 10_000), "private vehicle fleet is not metropolitan");
assert(initial.fleets.some((fleet) => fleet.mode === "metro" && fleet.activeVehicles > 0), "metro fleet is inactive");
assert(initial.sectorFlows.every((flow) => flow.congestionPercent >= 0 && flow.congestionPercent <= 100), "invalid congestion value");
assert(initial.parking.every((parking) => parking.spaces > 0 && parking.occupiedSpaces <= parking.spaces), "parking capacity is invalid");

const baseInput = {
  seed,
  metropolitan: session.metropolitan,
  urban: session.urban,
  districts: session.world.districts,
  locations: session.world.locations,
  organizations: session.world.organizations,
  population: session.population,
  economy: session.economy,
  production: session.production,
  transportServiceLevel: 72,
  dataServiceLevel: 68,
  activeLocationId: session.life.currentLocationId
};

const morningTimestamp = Math.floor(session.timestamp / (24 * HOUR_MS)) * 24 * HOUR_MS + 8 * HOUR_MS;
const nightTimestamp = morningTimestamp + 19 * HOUR_MS;
const morning = advanceMetropolitanMobilityState(initial, { ...baseInput, timestamp: Math.max(initial.lastUpdatedAt + HOUR_MS, morningTimestamp) });
const night = advanceMetropolitanMobilityState(morning, { ...baseInput, timestamp: Math.max(morning.lastUpdatedAt + HOUR_MS, nightTimestamp) });
const morningSnapshot = morning.history[morning.history.length - 1];
const nightSnapshot = night.history[night.history.length - 1];
assert(morningSnapshot.totalTripsPerHour > 0 && nightSnapshot.totalTripsPerHour > 0, "hourly mobility flow collapsed");
assert(morning.totals.passengerTrips > initial.totals.passengerTrips, "passenger trip totals did not advance");
assert(morning.commuterPlans.some((plan) => plan.tripsCompleted > 0), "commuter schedules never produced trips");
assert(morningSnapshot.peakCongestionPercent >= morningSnapshot.averageCongestionPercent, "peak congestion is below average");
assert(nightSnapshot.freightTripsPerHour > 0, "night freight flow is missing");

const synchronized = synchronizeMetropolitanFromMobility(session.metropolitan, morning);
assert(synchronized.sectors.some((sector) => sector.trafficLoad !== session.metropolitan.sectors.find((item) => item.id === sector.id)?.trafficLoad), "mobility did not update metropolitan traffic");

const options = getTravelOptions(session);
assert(options.length === session.world.locations.length - 1, "travel options are incomplete");
assert(options.every((option) => option.durationMinutes > 0 && option.distanceKm >= 0), "physical travel estimate is invalid");
assert(options.some((option) => option.routeCode.length > 0), "travel routes have no codes");

const target = options.find((option) => !option.sameDistrict) ?? options[0];
session = progressLife(session, target.durationMinutes, {
  targetLocationId: target.location.id,
  activity: "METROPOLITAN MOBILITY INTEGRATION",
  suppressTimeEvent: true,
  trackBalance: false
});
assert(session.mobility.lastUpdatedAt === session.timestamp, "life simulation did not advance mobility");
assert(session.metropolitan.sectors.some((sector) => sector.trafficLoad === session.mobility.sectorFlows.find((flow) => flow.sectorId === sector.id)?.congestionPercent), "metropolitan traffic was not synchronized");
assert(session.kernel.integrity.healthy, `kernel failed after mobility integration: ${session.kernel.integrity.warnings.join(" | ")}`);

const legacy = structuredClone(session) as any;
legacy.schemaVersion = 21;
delete legacy.mobility;
const migrated = migrateEnvelope({
  slotId: "slot-1",
  schemaVersion: 21,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  checksum: "legacy",
  payload: legacy
}, "slot-1");
assert(migrated, "migration returned null");
assert(migrated.schemaVersion === 26, "migration schema mismatch");
assert(migrated.payload.mobility.version === 1, "migration did not create mobility state");
assert(migrated.payload.mobility.sectorFlows.length === migrated.payload.metropolitan.sectors.length, "migration lost sector mobility flows");
assert(migrated.payload.mobility.routes.length > 0, "migration lost route network");

console.log(JSON.stringify({
  sectors: initial.sectorFlows.length,
  routes: initial.routes.length,
  commuterPlans: initial.commuterPlans.length,
  fleets: initial.fleets.length,
  morningTripsPerHour: morningSnapshot.totalTripsPerHour,
  morningAverageCongestion: morningSnapshot.averageCongestionPercent,
  morningPeakCongestion: morningSnapshot.peakCongestionPercent,
  nightFreightTripsPerHour: nightSnapshot.freightTripsPerHour,
  parkingSpaces: initial.parking.reduce((sum, item) => sum + item.spaces, 0),
  migrationSchema: migrated.schemaVersion
}, null, 2));
