import { leaveLocalBuilding } from "../src/gameplay/life/lifeSimulation";
import {
  advanceStreetSceneState,
  applyStreetIncidentAction,
  createStreetSceneState
} from "../src/simulation/streetScene/streetSceneSystem";
import type { StreetSceneInput } from "../src/simulation/streetScene/types";
import { createWorldSession } from "../src/world/generation/createWorld";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const seed = "living-street-regression";
const created = createWorldSession(seed);
const outside = created.localScene.playerPosition.state === "inside" ? leaveLocalBuilding(created) : created;
assert(outside.localScene.playerPosition.state === "outside", "player could not reach the street");

const actor = outside.localScene.actors[0];
assert(actor, "street test needs a materialized actor");
const vehicle = outside.vehicles.vehicles[0];
assert(vehicle, "street test needs a physical vehicle");
const player = outside.localScene.playerPosition;

const localScene = {
  ...outside.localScene,
  focusSectorId: player.sectorId,
  playerPosition: player,
  actors: [{
    ...actor,
    visible: true,
    nearby: true,
    interactable: false,
    position: {
      ...actor.position,
      sectorId: player.sectorId,
      xM: player.xM + 34,
      yM: player.yM + 12,
      state: "outside" as const,
      buildingId: undefined,
      unitId: undefined,
      roomId: undefined,
      floor: undefined,
      interiorZone: undefined,
      updatedAt: outside.timestamp
    }
  }]
};
const vehicles = {
  ...outside.vehicles,
  vehicles: [{
    ...vehicle,
    visible: true,
    state: "moving" as const,
    position: {
      ...vehicle.position,
      sectorId: player.sectorId,
      xM: player.xM + 52,
      yM: player.yM + 18,
      buildingId: undefined,
      updatedAt: outside.timestamp
    }
  }]
};

function input(timestamp: number): StreetSceneInput {
  return {
    timestamp,
    seed,
    playerId: outside.player.id,
    metropolitan: outside.metropolitan,
    urban: outside.urban,
    streets: outside.streets,
    localScene: { ...localScene, lastUpdatedAt: timestamp },
    vehicles
  };
}

const initial = createStreetSceneState(input(outside.timestamp));
assert(initial.pedestrians.length === 1, "pedestrian was not materialized on the street");
assert(initial.traffic.length === 1, "traffic vehicle was not materialized on the street");
assert(initial.crossings.length > 0, "street crossings were not materialized");

const afterMinute = advanceStreetSceneState(initial, input(outside.timestamp + 60_000)).state;
const firstPedestrian = initial.pedestrians[0];
const movedPedestrian = afterMinute.pedestrians[0];
assert(firstPedestrian && movedPedestrian, "pedestrian disappeared during movement");
assert(firstPedestrian.xM !== movedPedestrian.xM || firstPedestrian.yM !== movedPedestrian.yM, "pedestrian did not move with game time");
const firstTraffic = initial.traffic[0];
const movedTraffic = afterMinute.traffic[0];
assert(firstTraffic && movedTraffic, "traffic disappeared during movement");
assert(firstTraffic.xM !== movedTraffic.xM || firstTraffic.yM !== movedTraffic.yM, "traffic did not move with game time");

let scene = afterMinute;
let timestamp = outside.timestamp + 60_000;
for (let step = 0; step < 80 && !scene.incidents.some((item) => item.status !== "resolved"); step += 1) {
  timestamp += 10 * 60_000;
  scene = advanceStreetSceneState(scene, input(timestamp)).state;
}
const incident = scene.incidents.find((item) => item.status !== "resolved");
assert(incident, "no physical street incident was generated");

const reported = applyStreetIncidentAction(scene, incident.id, "call-help", timestamp);
const reportedIncident = reported.incidents.find((item) => item.id === incident.id);
assert(reportedIncident?.status === "reported", "calling help did not report the incident");

const resolved = advanceStreetSceneState(reported, input(timestamp + 13 * 60_000)).state;
const resolvedIncident = resolved.incidents.find((item) => item.id === incident.id);
assert(resolvedIncident?.status === "resolved", "responders did not resolve the reported incident");

const secondActive = resolved.incidents.find((item) => item.status !== "resolved");
if (secondActive) {
  const intervened = applyStreetIncidentAction(resolved, secondActive.id, "intervene", timestamp + 14 * 60_000);
  assert(intervened.incidents.find((item) => item.id === secondActive.id)?.status === "resolved", "intervention did not resolve the incident");
}

console.log(JSON.stringify({
  pedestrians: initial.pedestrians.length,
  traffic: initial.traffic.length,
  crossings: initial.crossings.length,
  incident: incident.type,
  responder: incident.responder,
  outcome: resolvedIncident?.outcome
}, null, 2));
