import { migrateEnvelope } from "../src/core/saves/migrations";
import {
  approachPhysicalVehicle,
  disposeStolenPhysicalVehicle,
  drivePhysicalVehicleToLocation,
  forceOpenPhysicalVehicle,
  hotwirePhysicalVehicle,
  inspectPhysicalVehicleForTheft,
  leaveLocalBuilding,
  leavePhysicalVehicle,
  progressLife,
  replateStolenPhysicalVehicle,
  stealPhysicalVehicleContents
} from "../src/gameplay/life/lifeSimulation";
import { getVehicleCrimeInspection, getVehicleWantedState } from "../src/simulation/crime/vehicleCrimeSystem";
import { getPhysicalVehicle } from "../src/simulation/vehicles/physicalVehicleSystem";
import { createWorldSession } from "../src/world/generation/createWorld";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let session = createWorldSession("VEHICLE-THEFT-WITNESSES-29");
assert(session.schemaVersion === 27, "new world schema is not 27");
assert(session.vehicleCrime.version === 1, "vehicle crime state missing");
session = leaveLocalBuilding(session);

let target = session.vehicles.vehicles.find((vehicle) =>
  vehicle.visible
  && vehicle.access === "locked"
  && vehicle.state === "parked"
  && vehicle.condition >= 18
  && vehicle.vehicleClass !== "police"
  && vehicle.vehicleClass !== "medical"
  && vehicle.vehicleClass !== "bus"
);
assert(target, "no eligible vehicle for theft test");
const vehicleId = target.id;
const originalPlate = target.plate;
const ownerResidentId = target.ownerResidentId;
const ownerSavingsBefore = ownerResidentId ? session.population.residents.find((resident) => resident.id === ownerResidentId)?.savings : undefined;
session = approachPhysicalVehicle(session, vehicleId);
target = getPhysicalVehicle(session.vehicles, vehicleId) ?? undefined;
assert(target && target.distanceToPlayerM <= 6, "player did not reach target vehicle");

session = inspectPhysicalVehicleForTheft(session, vehicleId);
const inspection = getVehicleCrimeInspection(session.vehicleCrime, vehicleId);
assert(inspection, "vehicle inspection was not recorded");
assert(inspection.lockDifficulty > 0 && inspection.ignitionDifficulty > 0, "inspection difficulty is invalid");

for (let attempt = 0; attempt < 12; attempt += 1) {
  target = getPhysicalVehicle(session.vehicles, vehicleId) ?? undefined;
  if (target && !target.locked) break;
  session = forceOpenPhysicalVehicle(session, vehicleId);
}
target = getPhysicalVehicle(session.vehicles, vehicleId) ?? undefined;
assert(target && !target.locked, "vehicle lock resisted every deterministic attempt");
assert(session.vehicleCrime.totals.breakInAttempts > 0, "break-in attempts were not counted");
assert(session.vehicleCrime.incidents.some((incident) => incident.vehicleId === vehicleId && incident.action === "break-in"), "break-in incident missing");

const lootBefore = target.cabinLootCredits;
const balanceBeforeLoot = session.player.balance;
if (lootBefore > 0) {
  session = stealPhysicalVehicleContents(session, vehicleId);
  assert(session.player.balance === balanceBeforeLoot + lootBefore, "cabin loot did not reach player balance");
  assert(getPhysicalVehicle(session.vehicles, vehicleId)?.cabinLootCredits === 0, "cabin loot remained in vehicle");
  assert(session.vehicleCrime.incidents.some((incident) => incident.vehicleId === vehicleId && incident.action === "cabin-theft"), "cabin theft incident missing");
}

for (let attempt = 0; attempt < 12 && session.vehicles.player.currentVehicleId !== vehicleId; attempt += 1) {
  session = hotwirePhysicalVehicle(session, vehicleId);
}
assert(session.vehicles.player.currentVehicleId === vehicleId, "vehicle was never hotwired");
assert(session.localScene.playerPosition.state === "vehicle", "hotwire did not put player in vehicle");
target = getPhysicalVehicle(session.vehicles, vehicleId) ?? undefined;
assert(target?.stolenByPlayer && target.hotwired, "vehicle theft flags missing");
assert(target.legalStatus === "stolen" || target.legalStatus === "wanted", "vehicle legal status was not changed");
assert(session.vehicleCrime.stolenVehicleIds.includes(vehicleId), "crime state lost stolen vehicle id");
assert(getVehicleWantedState(session.vehicleCrime, vehicleId), "wanted vehicle state missing");

const workshop = session.world.locations.find((location) => location.type === "workshop");
assert(workshop, "workshop missing");
session = drivePhysicalVehicleToLocation(session, workshop.id);
assert(session.life.currentLocationId === workshop.id, "stolen vehicle did not reach workshop");

session = progressLife(session, 180, { suppressTimeEvent: true });
const reported = session.vehicleCrime.incidents.find((incident) => incident.vehicleId === vehicleId && incident.action === "hotwire");
assert(reported?.status === "reported" || reported?.status === "investigating", "owner/witness report never reached government");
assert(reported.caseId, "reported theft has no enforcement case");
assert(session.government.cases.some((item) => item.id === reported.caseId && item.kind === "vehicle-theft"), "government vehicle-theft case missing");
assert(session.data.observations.some((item) => item.vehicleIds?.includes(vehicleId) && item.eventKind === "vehicle-theft") || reported.cameraObservationIds.length === 0, "camera evidence was not stored");
if (target.insured && ownerResidentId && ownerSavingsBefore !== undefined) {
  const claim = session.vehicleCrime.insuranceClaims.find((item) => item.vehicleId === vehicleId);
  const ownerSavingsAfter = session.population.residents.find((resident) => resident.id === ownerResidentId)?.savings;
  assert(claim?.status === "paid", "insured owner did not receive a paid theft claim");
  assert(ownerSavingsAfter === ownerSavingsBefore + claim.amount, "insurance payment did not reach vehicle owner");
  assert(session.vehicleCrime.totals.insuranceCreditsPaid >= claim.amount, "insurance totals did not track payment");
  assert(session.kernel.transactions.some((transaction) => transaction.reason === "insurance-claim" && transaction.creditEntityId === ownerResidentId), "vehicle insurance transfer missing from kernel");
}
assert(session.kernel.integrity.healthy, `kernel integrity failed after vehicle theft: ${session.kernel.integrity.warnings.join(" | ")}`);
assert(session.kernel.integrity.reconciliationTransactions === 0, "vehicle theft required domain reconciliation");

const balanceBeforeReplate = session.player.balance;
session = replateStolenPhysicalVehicle(session, vehicleId);
target = getPhysicalVehicle(session.vehicles, vehicleId) ?? undefined;
assert(target, "vehicle disappeared during replate");
assert(target.plate !== originalPlate, "vehicle plate did not change");
assert(target.originalPlate === originalPlate, "original plate was lost");
assert(target.legalStatus === "replated", "vehicle legal status is not replated");
assert(session.player.balance < balanceBeforeReplate, "replate did not cost credits");

session = leavePhysicalVehicle(session);
assert(session.localScene.playerPosition.state === "outside", "player could not leave replated vehicle");
const balanceBeforeFence = session.player.balance;
session = disposeStolenPhysicalVehicle(session, vehicleId, "fence");
assert(session.player.balance > balanceBeforeFence, "vehicle fence did not pay player");
assert(!getPhysicalVehicle(session.vehicles, vehicleId), "fenced vehicle still exists physically");
assert(session.vehicles.disposedVehicleIds.includes(vehicleId), "disposed vehicle tombstone missing");
assert(getVehicleWantedState(session.vehicleCrime, vehicleId)?.status === "fenced", "wanted state was not closed as fenced");

session = progressLife(session, 60, { suppressTimeEvent: true });
assert(!getPhysicalVehicle(session.vehicles, vehicleId), "disposed vehicle regenerated after time advance");

const legacy = structuredClone(session) as any;
legacy.schemaVersion = 26;
delete legacy.vehicleCrime;
const migrated = migrateEnvelope({
  slotId: "slot-1",
  schemaVersion: 26,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  checksum: "legacy",
  payload: legacy
}, "slot-1");
assert(migrated, "migration returned null");
assert(migrated.schemaVersion === 27, "migration schema mismatch");
assert(migrated.payload.vehicleCrime.version === 1, "migration did not create vehicle crime state");

console.log(JSON.stringify({
  vehicleId,
  originalPlate,
  replatedPlate: target.plate,
  incidents: session.vehicleCrime.incidents.length,
  witnessReports: session.vehicleCrime.totals.witnessReports,
  cameraCaptures: session.vehicleCrime.totals.cameraCaptures,
  casesOpened: session.vehicleCrime.totals.casesOpened,
  insuranceClaims: session.vehicleCrime.insuranceClaims.length,
  insuranceCreditsPaid: session.vehicleCrime.totals.insuranceCreditsPaid,
  playerHeat: session.vehicleCrime.playerHeat,
  fenceRevenue: session.player.balance - balanceBeforeFence,
  migrationSchema: migrated.schemaVersion
}, null, 2));
