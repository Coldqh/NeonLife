import type { GameSession } from "../src/world/state/types";
import { createWorldSession } from "../src/world/generation/createWorld";
import { getSectorStreetTopology } from "../src/simulation/streets/streetTopologySystem";
import {
  localMovementTargetForActor,
  localMovementTargetForBuilding,
  localMovementTargetForPoint,
  localMovementTargetForStop,
  localMovementTargetForVehicle,
  planLocalMovement
} from "../src/simulation/localMovement/localMovementSystem";
import { advanceLocalMovement, finishLocalMovement, skipLocalMovement, startLocalMovement, startTransitJourney } from "../src/gameplay/life/lifeSimulation";
import { getTravelOptions } from "../src/gameplay/travel/travelSystem";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const seed = "local-movement-regression";
const created = createWorldSession(seed);
const focus = created.metropolitan.sectors.find((sector) => sector.id === created.metropolitan.streaming.focusSectorId)
  ?? created.metropolitan.sectors[0];
const topology = getSectorStreetTopology(created.streets, {
  timestamp: created.timestamp,
  seed,
  metropolitan: created.metropolitan,
  urban: created.urban,
  preferredSectorId: focus.id
}, focus.id);
assert(topology.intersections.length > 2, "focus sector has no walkable graph");

const originNode = topology.intersections[0];
const targetNode = [...topology.intersections]
  .sort((left, right) => Math.hypot(right.xM - originNode.xM, right.yM - originNode.yM) - Math.hypot(left.xM - originNode.xM, left.yM - originNode.yM))[0];
const session = {
  ...created,
  localScene: {
    ...created.localScene,
    playerPosition: {
      sectorId: focus.id,
      xM: originNode.xM,
      yM: originNode.yM,
      locationId: created.life.currentLocationId,
      state: "outside" as const,
      updatedAt: created.timestamp
    }
  }
};


const distanceFromOrigin = (point: { xM: number; yM: number }) => Math.hypot(point.xM - originNode.xM, point.yM - originNode.yM);
const farBuilding = [...session.urban.buildings]
  .filter((building) => building.sectorId === focus.id)
  .sort((left, right) => distanceFromOrigin({ xM: right.bounds.xM, yM: right.bounds.yM }) - distanceFromOrigin({ xM: left.bounds.xM, yM: left.bounds.yM }))[0];
const farStop = [...session.transit.stops]
  .filter((stop) => stop.sectorId === focus.id)
  .sort((left, right) => distanceFromOrigin(right) - distanceFromOrigin(left))[0];
const farVehicle = [...session.vehicles.vehicles]
  .filter((vehicle) => vehicle.position.sectorId === focus.id && vehicle.state !== "moving")
  .sort((left, right) => distanceFromOrigin(right.position) - distanceFromOrigin(left.position))[0];
const localActor = session.localScene.actors.find((actor) => actor.position.sectorId === focus.id && actor.position.state !== "in-transit");

const entityTargets = [
  farBuilding ? localMovementTargetForBuilding(session, farBuilding.id) : null,
  farStop ? localMovementTargetForStop(session, farStop.id) : null,
  farVehicle ? localMovementTargetForVehicle(session, farVehicle.id) : null,
  localActor ? localMovementTargetForActor(session, localActor.id) : null
];
assert(entityTargets.every(Boolean), "one or more physical target types could not be resolved");
for (const entityTarget of entityTargets) {
  const entityRoute = entityTarget ? planLocalMovement(session, entityTarget) : null;
  assert(entityRoute && entityRoute.totalDistanceM > 1, `route to ${entityTarget?.kind ?? "unknown"} was not planned`);
}

const neighbor = session.metropolitan.sectors.find((sector) => Math.abs(sector.xIndex - focus.xIndex) + Math.abs(sector.yIndex - focus.yIndex) === 1);
assert(neighbor, "focus sector has no adjacent sector");
const neighborTopology = getSectorStreetTopology(session.streets, {
  timestamp: session.timestamp,
  seed,
  metropolitan: session.metropolitan,
  urban: session.urban,
  preferredSectorId: neighbor.id
}, neighbor.id);
const neighborNode = [...neighborTopology.intersections]
  .sort((left, right) => distanceFromOrigin(right) - distanceFromOrigin(left))[0];
assert(neighborNode, "adjacent sector has no street node");
const crossSectorTarget = localMovementTargetForPoint(session, neighbor.id, neighborNode.xM, neighborNode.yM, "Соседний сектор");
const crossSectorRoute = planLocalMovement(session, crossSectorTarget);
assert(crossSectorRoute, "cross-sector route was not planned");
assert(crossSectorRoute.points.some((point) => point.sectorId === neighbor.id), "cross-sector route never enters the target sector");
const crossSectorArrival = skipLocalMovement(startLocalMovement(session, crossSectorTarget));
assert(crossSectorArrival.localMovement?.status === "arrived", "cross-sector route did not finish");
assert(crossSectorArrival.localScene.playerPosition.sectorId === neighbor.id, "player arrived in the wrong sector");

const target = localMovementTargetForPoint(session, focus.id, targetNode.xM, targetNode.yM, "Тестовая точка");
const preview = planLocalMovement(session, target);
assert(preview, "local route was not planned");
assert(preview.points.length >= 2, "route has too few points");
assert(preview.totalDistanceM > 1, "route distance is invalid");
assert(preview.streetNames.length > 0, "route has no street names");

const started = startLocalMovement(session, target);
assert(started.localMovement?.status === "walking", "route did not start");
const advanced = advanceLocalMovement(started, 1);
assert((advanced.localMovement?.travelledM ?? 0) > 0, "walking did not advance");
assert(advanced.timestamp > started.timestamp, "walking did not advance world time");
assert(advanced.localScene.playerPosition.state === "outside", "walking changed player presence state");

const arrived = skipLocalMovement(advanced);
assert(arrived.localMovement?.status === "arrived", "skip did not finish the route");
assert(arrived.localMovement.remainingDistanceM === 0, "arrived route still has distance remaining");
assert(Math.hypot(arrived.localScene.playerPosition.xM - target.xM, arrived.localScene.playerPosition.yM - target.yM) < 1, "player did not reach target coordinates");

const finished = finishLocalMovement(arrived);
assert(!finished.localMovement, "finished route was not cleared");

const transitOptions = getTravelOptions(session).filter((option) => option.mode === "bus" || option.mode === "metro");
let transitStarted: GameSession | null = null;
for (const option of transitOptions) {
  const candidate = startTransitJourney(session, option.location.id);
  if (candidate.transit.player.journey?.phase === "walking" && candidate.localMovement?.target.stopId) {
    transitStarted = candidate;
    break;
  }
}
assert(transitStarted, "transit route did not create a street walk to its first stop");
assert(transitStarted.localMovement?.target.stopId === transitStarted.transit.player.journey?.currentStopId, "street walk targets the wrong transit stop");
const reachedStop = skipLocalMovement(transitStarted);
assert(reachedStop.localMovement?.status === "arrived", "street walk did not reach the transit stop");
assert(reachedStop.transit.player.journey?.phase === "waiting", "arrival did not hand control to transit waiting");
const waitingAtStop = finishLocalMovement(reachedStop);
assert(!waitingAtStop.localMovement && waitingAtStop.transit.player.journey?.phase === "waiting", "transit handoff did not clear the walking overlay");


console.log(JSON.stringify({
  routePoints: preview.points.length,
  streets: preview.streetNames.length,
  distanceM: Math.round(preview.totalDistanceM),
  elapsedMinutes: Math.round((arrived.timestamp - session.timestamp) / 60_000),
  targetKinds: entityTargets.map((item) => item?.kind),
  transitHandoff: waitingAtStop.transit.player.journey?.phase,
  crossSectorDistanceM: Math.round(crossSectorRoute.totalDistanceM)
}, null, 2));
