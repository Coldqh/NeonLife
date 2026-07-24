import { createWorldSession } from "../src/world/generation/createWorld";
import { progressLife } from "../src/gameplay/life/lifeSimulation";
import { migrateEnvelope } from "../src/core/saves/migrations";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let session = createWorldSession("DATA-SURVEILLANCE-21");
assert(session.data.identities.length === session.population.residents.length, "not every resident has a digital identity");
assert(session.data.records.length >= session.population.residents.length * 10, "core records were not created");
assert(session.data.nodes.length >= session.world.locations.length, "surveillance nodes missing");
assert(session.data.grants.length > 0, "data access grants missing");

let maximumReconciliations = 0;
for (let day = 1; day <= 365; day += 1) {
  session = progressLife(session, 24 * 60, {
    activity: "DATA SURVEILLANCE AUTONOMOUS ADVANCE",
    suppressTimeEvent: true,
    trackBalance: false
  });
  assert(session.kernel.integrity.healthy, `kernel integrity failed on day ${day}: ${session.kernel.integrity.warnings.join(" | ")}`);
  maximumReconciliations = Math.max(maximumReconciliations, session.kernel.integrity.reconciliationTransactions);
}

assert(session.data.simulatedDays >= 365, "data system did not advance");
assert(session.data.accessEvents.length > 0, "no data access was recorded");
assert(session.data.observations.length > 0, "surveillance produced no observations");
assert(session.data.totals.surveillanceCaptures > 0, "surveillance captured nothing");
assert(session.population.residents.every((resident) => typeof resident.creditScore === "number"), "credit score did not reach population records");
assert(session.population.residents.every((resident) => typeof resident.digitalAccess === "number"), "digital access did not reach population records");
assert(session.kernel.assets.some((asset) => asset.kind === "surveillance-node"), "surveillance nodes are absent from Kernel assets");
assert(session.kernel.contracts.some((contract) => contract.kind === "data-access"), "data grants are absent from Kernel contracts");
assert(session.data.records.every((record) => record.retentionUntilDay >= session.data.dayIndex - 1), "expired records remain active");
assert(maximumReconciliations === 0, `daily simulation required ${maximumReconciliations} reconciliation transactions`);


const invalidAllowed = session.data.accessEvents.filter((event) => {
  if (event.outcome !== "allowed") return false;
  const record = session.data.records.find((item) => item.id === event.recordId);
  if (!record || record.ownerEntityId === event.actorEntityId) return false;
  return !session.data.grants.some((grant) => grant.active && grant.granteeEntityId === event.actorEntityId && grant.purpose === event.purpose && grant.recordKinds.includes(record.kind));
});
assert(invalidAllowed.length === 0, `${invalidAllowed.length} accesses bypassed grants`);


const legacySession = createWorldSession("DATA-SURVEILLANCE-MIGRATION-21");
const legacyPayload = structuredClone(legacySession) as any;
legacyPayload.schemaVersion = 18;
delete legacyPayload.data;
for (const resident of legacyPayload.population.residents) {
  delete resident.creditScore;
  delete resident.digitalAccess;
  delete resident.identityStatus;
}
const migrated = migrateEnvelope({
  slotId: "slot-1",
  schemaVersion: 18,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  checksum: "legacy",
  payload: legacyPayload
}, "slot-1");
assert(migrated, "migration returned null");
assert(migrated.schemaVersion === 24, "migration schema mismatch");
assert(migrated.payload.data.version === 1, "data state was not created during migration");
assert(migrated.payload.data.identities.length === migrated.payload.population.residents.length, "migration did not create resident identities");
assert(migrated.payload.kernel.assets.some((asset) => asset.kind === "surveillance-node"), "migration did not register surveillance assets");
assert(migrated.payload.kernel.contracts.some((contract) => contract.kind === "data-access"), "migration did not register data grants");

console.log(JSON.stringify({
  days: session.data.simulatedDays,
  migrationSchema: migrated.schemaVersion,
  identities: session.data.identities.length,
  records: session.data.records.length,
  nodes: session.data.nodes.length,
  accesses: session.data.totals.accesses,
  deniedAccesses: session.data.totals.deniedAccesses,
  captures: session.data.totals.surveillanceCaptures,
  breaches: session.data.totals.breaches,
  recordsStolen: session.data.totals.recordsStolen,
  dataSales: session.data.totals.dataSales,
  activeForgeries: session.data.forgeries.filter((item) => item.status === "active").length,
  forgeriesCreated: session.data.totals.forgeriesCreated,
  forgeriesDetected: session.data.totals.forgeriesDetected,
  averageCredit: session.data.history.at(-1)?.averageCreditScore,
  maximumReconciliations,
  kernelWarnings: session.kernel.integrity.warnings
}, null, 2));
