import { createWorldSession } from "../src/world/generation/createWorld";
import { progressLife } from "../src/gameplay/life/lifeSimulation";
import { migrateEnvelope } from "../src/core/saves/migrations";
import { advanceHealthCyberware } from "../src/simulation/health/healthSystem";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const DAY_MS = 24 * 60 * 60_000;
const seed = "HEALTH-CYBERWARE-VALIDATION-20";
let session = createWorldSession(seed);

assert(session.schemaVersion === 21, "new world schema mismatch");
assert(session.health.facilities.length >= 5, "clinical network missing");
assert(session.health.cyberwareModels.length >= 8, "cyberware catalog missing");
assert(session.health.policies.length === session.population.households.length, "insurance coverage not initialized for every household");
assert(session.world.locations.filter((item) => item.type === "clinic").length >= 5, "physical clinical locations missing");

// Full ecosystem integration: health must survive every other city system and settle through Kernel.
session = progressLife(session, 180 * 24 * 60, {
  activity: "INTEGRATED CLINICAL ECONOMY VALIDATION",
  suppressTimeEvent: true,
  trackBalance: false
});
assert(session.health.simulatedDays >= 180, "integrated health day drift");
assert(session.health.totals.conditionsCreated > 0, "integrated simulation created no conditions");
assert(session.health.totals.casesCreated > 0, "integrated simulation created no patient cases");
assert(session.kernel.transactions.some((item) => item.reason === "medical-service" || item.reason === "insurance-claim"), "medical transactions missing from Kernel");
assert(session.kernel.integrity.healthy, `kernel integrity failed: ${session.kernel.integrity.warnings.join(" | ")}`);

// Five-year clinical run. Other systems remain at their current state so this isolates care capacity,
// insurance, debt, implants, maintenance and condition progression.
let health = session.health;
let organizations = session.world.organizations;
let population = session.population;
let economy = session.economy;
let production = session.production;
let government = session.government;
const startTimestamp = session.timestamp;
for (let offset = 1; offset <= 1_825; offset += 1) {
  const result = advanceHealthCyberware(health, {
    timestamp: startTimestamp + offset * DAY_MS,
    seed,
    districts: session.world.districts,
    locations: session.world.locations,
    organizations,
    population,
    economy,
    infrastructure: session.infrastructure,
    production,
    government
  });
  health = result.state;
  organizations = result.organizations;
  population = result.population;
  economy = result.economy;
  production = result.production;
  government = result.government;
}

const residentIds = new Set(population.residents.map((resident) => resident.id));
const householdIds = new Set(population.households.map((household) => household.id));
const facilityIds = new Set(health.facilities.map((facility) => facility.id));
const modelIds = new Set(health.cyberwareModels.map((model) => model.id));
const activeDebt = health.debts.filter((debt) => debt.status === "current" || debt.status === "delinquent");
const openCases = health.cases.filter((item) => item.status === "waiting" || item.status === "admitted");

assert(health.simulatedDays >= 2_005, "health simulated day total incorrect");
assert(health.totals.conditionsCreated > 40, "condition incidence too low for five years");
assert(health.totals.casesTreated > 0, "no cases treated");
assert(health.totals.insuranceClaimsPaid > 0, "insurance never paid a claim");
assert(health.totals.patientPayments > 0, "households never paid for care");
assert(health.totals.debtCreated > 0, "medical debt never appeared");
assert(health.totals.medicalUnitsConsumed > 0, "clinical stock was never consumed");
assert(health.totals.cyberwareInstalled > 0, "no cyberware installed");
assert(health.totals.cyberwareMaintained > 0, "cyberware never received maintenance");
assert(health.history.length <= 180, "health history is not bounded");
assert(health.facilities.every((item) => item.medicalStock >= 0 && item.implantParts >= 0 && item.maintenanceKits >= 0), "negative clinical inventory");
assert(health.policies.every((policy) => householdIds.has(policy.householdId)), "policy references missing household");
assert(health.conditions.every((condition) => residentIds.has(condition.residentId)), "condition references missing resident");
assert(health.cases.every((caseState) => residentIds.has(caseState.residentId) && facilityIds.has(caseState.facilityId)), "case references invalid entity");
assert(health.installations.every((installation) => residentIds.has(installation.residentId) && facilityIds.has(installation.providerFacilityId) && modelIds.has(installation.modelId)), "cyberware installation references invalid entity");
assert(activeDebt.every((debt) => householdIds.has(debt.householdId) && debt.principal >= 0), "medical debt references invalid household or negative principal");
assert(openCases.length < population.residents.length, "clinical queue grew beyond detailed population");

const legacySession = createWorldSession("HEALTH-CYBERWARE-MIGRATION-20");
const legacyPayload = structuredClone(legacySession) as any;
legacyPayload.schemaVersion = 17;
delete legacyPayload.health;
delete legacyPayload.data;
legacyPayload.world.locations = legacyPayload.world.locations.filter((item: any) => ![
  "CMU INDUSTRIAL TRAUMA STATION",
  "CMU REGIONAL HOSPITAL",
  "AURELIAN OCCUPATIONAL CLINIC",
  "CUTWIRE BACKROOM SURGERY"
].includes(item.name));
const migrated = migrateEnvelope({
  slotId: "slot-1",
  schemaVersion: 17,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  checksum: "legacy",
  payload: legacyPayload
}, "slot-1");
assert(migrated, "migration returned null");
assert(migrated.schemaVersion === 21, "migration schema mismatch");
assert(migrated.payload.health.version === 1, "health state not created during migration");
assert(migrated.payload.data.version === 1, "data state not created during migration");
assert(migrated.payload.health.facilities.length >= 5, "clinical facilities not restored during migration");
assert(migrated.payload.health.policies.length === migrated.payload.population.households.length, "insurance policies not restored during migration");
assert(migrated.payload.world.locations.filter((item) => item.type === "clinic").length >= 5, "clinical locations not restored during migration");
assert(migrated.payload.kernel.integrity.healthy, "kernel failed after health migration");

console.log(JSON.stringify({
  integratedDays: session.health.simulatedDays,
  isolatedClinicalDays: 1_825,
  facilities: health.facilities.length,
  activeConditions: health.conditions.filter((item) => item.stage !== "resolved").length,
  casesCreated: health.totals.casesCreated,
  casesTreated: health.totals.casesTreated,
  waitingCases: openCases.length,
  inpatientAdmissions: health.totals.inpatientAdmissions,
  procedures: health.totals.procedures,
  insuranceClaimsPaid: Math.round(health.totals.insuranceClaimsPaid),
  patientPayments: Math.round(health.totals.patientPayments),
  medicalDebtCreated: Math.round(health.totals.debtCreated),
  activeMedicalDebt: Math.round(activeDebt.reduce((sum, item) => sum + item.principal, 0)),
  cyberwareInstalled: health.totals.cyberwareInstalled,
  cyberwareMaintained: health.totals.cyberwareMaintained,
  cyberwareFailures: health.totals.cyberwareFailures,
  undergroundProcedures: health.totals.undergroundProcedures,
  medicalUnitsConsumed: Math.round(health.totals.medicalUnitsConsumed),
  partsUnitsConsumed: Math.round(health.totals.partsUnitsConsumed),
  kernelTransactions: session.kernel.totals.transactions,
  kernelWarnings: session.kernel.integrity.warnings,
  migrationSchema: migrated.schemaVersion
}, null, 2));
