import { createWorldSession } from "../src/world/generation/createWorld";
import { advancePlayerCrimeState, createPlayerCrimeState, recordPlayerCrimeAction, releasePlayerCustodyState } from "../src/simulation/crime/playerCrimeSystem";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const session = createWorldSession("player-crime-regression");
const position = session.localScene.playerPosition;
const sector = session.metropolitan.sectors.find((item) => item.id === position.sectorId)!;
const baseInput = {
  seed: session.world.meta.seed,
  timestamp: session.timestamp,
  playerId: session.player.id,
  playerPosition: position,
  localScene: session.localScene,
  streetScene: session.streetScene,
  data: session.data,
  urban: session.urban,
  districts: session.world.districts,
  organizations: session.world.organizations
};
let state = createPlayerCrimeState(baseInput);
const kinds = ["shoplifting", "register-robbery", "vehicle-theft", "assault"] as const;
for (let index = 0; index < kinds.length; index += 1) {
  const kind = kinds[index];
  state = recordPlayerCrimeAction(state, {
    ...baseInput,
    timestamp: session.timestamp + index * 60_000,
    kind,
    sectorId: sector.id,
    districtId: sector.districtId,
    xM: position.xM,
    yM: position.yM,
    venueId: kind === "shoplifting" || kind === "register-robbery" ? session.urban.venues[0]?.id : undefined,
    vehicleId: kind === "vehicle-theft" ? session.vehicles.vehicles[0]?.id : undefined,
    victimActorId: kind === "assault" ? session.localScene.actors[0]?.id : undefined,
    victimResidentId: kind === "assault" ? session.localScene.actors[0]?.residentId : undefined,
    success: true,
    violence: kind === "register-robbery" ? 70 : kind === "assault" ? 62 : 8,
    stolenValue: kind === "shoplifting" ? 30 : kind === "register-robbery" ? 240 : kind === "vehicle-theft" ? 850 : 0,
    alarmTriggered: kind !== "shoplifting",
    stolenProperty: kind === "assault" ? undefined : {
      sourceVenueId: kind === "shoplifting" || kind === "register-robbery" ? session.urban.venues[0]?.id : undefined,
      sourceVehicleId: kind === "vehicle-theft" ? session.vehicles.vehicles[0]?.id : undefined,
      name: `TEST ${kind}`,
      value: kind === "vehicle-theft" ? 850 : 120,
      quantity: 1,
      evidenceStrength: 70
    }
  });
}
assert(state.incidents.length === 4, `expected 4 incidents, got ${state.incidents.length}`);
assert(state.totals.shoplifting === 1, "shoplifting total missing");
assert(state.totals.registerRobberies === 1, "register robbery total missing");
assert(state.totals.vehicleThefts === 1, "vehicle theft total missing");
assert(state.totals.assaults === 1, "assault total missing");
assert(state.stolenProperty.length === 3, "stolen property was not recorded");

const reportTimestamp = Math.max(...state.incidents.map((item) => item.reportDueAt)) + 60_000;
let advanced = advancePlayerCrimeState(state, { ...baseInput, timestamp: reportTimestamp });
state = advanced.state;
assert(state.incidents.every((item) => item.status !== "unreported"), "crimes were not reported");
assert(state.warrants.length > 0, "warrant was not created");
assert(state.policeResponses.length === 4, `expected four police responses, got ${state.policeResponses.length}`);
assert(advanced.notices.length > 0, "crime reports produced no notices");

const firstResponse = state.policeResponses[0];
const firstIncident = state.incidents.find((item) => item.id === firstResponse.incidentId)!;
const arrivalTimestamp = firstResponse.arrivesAt + 60_000;
advanced = advancePlayerCrimeState(state, {
  ...baseInput,
  timestamp: arrivalTimestamp,
  playerPosition: { ...position, sectorId: firstIncident.sectorId, xM: firstIncident.xM, yM: firstIncident.yM, updatedAt: arrivalTimestamp },
  localScene: { ...session.localScene, playerPosition: { ...position, sectorId: firstIncident.sectorId, xM: firstIncident.xM, yM: firstIncident.yM, updatedAt: arrivalTimestamp } }
});
state = advanced.state;
assert(advanced.newlyDetained, "police did not detain the player at the crime scene");
assert(state.custody?.status === "detained", "custody state missing after arrest");
assert(state.totals.arrests === 1, "arrest total missing");

const releaseAt = state.custody.releaseAt;
state = releasePlayerCustodyState(state, releaseAt, false);
assert(state.custody?.status === "released", "custody could not be served");
assert(state.warrants.some((item) => item.status === "closed"), "warrant did not close after custody");
assert(state.gangs.length >= 3, "gang ecosystem was not initialized");

console.log(JSON.stringify({
  incidents: state.incidents.length,
  evidence: state.evidence.length,
  warrants: state.warrants.length,
  responses: state.policeResponses.length,
  arrests: state.totals.arrests,
  gangs: state.gangs.map((item) => ({ name: item.name, influence: item.influence }))
}, null, 2));
