import { createWorldSession } from "../src/world/generation/createWorld";
import { progressLife } from "../src/gameplay/life/lifeSimulation";
import { migrateEnvelope } from "../src/core/saves/migrations";
import { advancePopulationLifecycleDay } from "../src/simulation/lifecycle/lifecycleSystem";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const seed = "POPULATION-LIFECYCLE-VALIDATION-19";
let session = createWorldSession(seed);
assert(session.schemaVersion === 22, "new world schema mismatch");
assert(session.population.lifecycle.institutions.length === 3, "education institutions missing");
assert(session.world.locations.filter((item) => item.type === "education").length === 3, "education locations missing");

const initialResidents = session.population.residents.length;
const initialHouseholds = session.population.households.length;
const initialRepresented = Object.values(session.population.lifecycle.representedPopulationByDistrict).reduce((sum, value) => sum + value, 0);

// Integration check: lifecycle must survive the entire ecosystem and write to Kernel.
session = progressLife(session, 24 * 60, { activity: "INTEGRATED DEMOGRAPHIC VALIDATION", suppressTimeEvent: true, trackBalance: false });
assert(session.kernel.transactions.some((item) => item.reason === "education-service"), "education transactions missing from kernel");
session = progressLife(session, 179 * 24 * 60, { activity: "INTEGRATED DEMOGRAPHIC VALIDATION", suppressTimeEvent: true, trackBalance: false });
assert(session.population.lifecycle.lastProcessedDay === session.population.dayIndex, "integrated lifecycle day drift");
assert(session.kernel.integrity.healthy, `kernel integrity failed: ${session.kernel.integrity.warnings.join(" | ")}`);

// Long-run lifecycle check without recalculating every unrelated hourly network.
let lifecycle = session.population.lifecycle;
let residents = session.population.residents;
let households = session.population.households;
let employments = session.population.employments;
let housing = session.population.housing;
const startDay = session.population.dayIndex;
const budgetByOrganization = new Map(session.world.organizations.map((organization) => [organization.id, organization.budget]));
for (let offset = 1; offset <= 3_650; offset += 1) {
  const result = advancePopulationLifecycleDay({
    state: lifecycle,
    dayIndex: startDay + offset,
    seed,
    residents,
    households,
    employments,
    housing,
    districts: session.world.districts,
    locations: session.world.locations,
    organizations: session.world.organizations.map((organization) => ({ ...organization, budget: budgetByOrganization.get(organization.id) ?? organization.budget }))
  });
  lifecycle = result.state;
  residents = result.residents;
  households = result.households;
  employments = result.employments;
  housing = result.housing;
  for (const delta of result.organizationBudgetDeltas) {
    budgetByOrganization.set(delta.organizationId, Math.max(0, (budgetByOrganization.get(delta.organizationId) ?? 0) + delta.delta));
  }
}

const residentIds = new Set(residents.map((resident) => resident.id));
const householdIds = new Set(households.map((household) => household.id));
const activeEmploymentResidentIds = employments.filter((item) => item.status !== "unemployed").map((item) => item.residentId);
const represented = Object.values(lifecycle.representedPopulationByDistrict).reduce((sum, value) => sum + value, 0);

assert(lifecycle.totals.births > 0, "no births occurred");
assert(lifecycle.totals.deaths > 0, "no deaths occurred");
assert(lifecycle.totals.immigrants > 0, "no inward migration occurred");
assert(lifecycle.totals.partnerships > 0, "no partnerships formed");
assert(lifecycle.totals.householdsFormed > 0, "no households formed");
assert(lifecycle.totals.graduates > 0, "no education completions occurred");
assert(lifecycle.totals.retirements > 0, "no retirements occurred");
assert(lifecycle.archive.length === lifecycle.totals.deaths + lifecycle.totals.emigrants, "archive totals mismatch");
assert(residents.every((resident) => householdIds.has(resident.householdId)), "resident references missing household");
assert(households.every((household) => household.memberIds.every((id) => residentIds.has(id))), "household references missing resident");
assert(activeEmploymentResidentIds.every((id) => residentIds.has(id)), "active employment references archived resident");
assert(housing.every((unit) => unit.occupied >= 0 && unit.occupied <= unit.capacity), "housing occupancy invalid");
assert(lifecycle.institutions.every((item) => item.enrolled >= 0 && item.enrolled <= item.capacity), "institution load invalid");
assert(represented > 0 && represented !== initialRepresented, "represented population did not evolve");
assert(residents.length >= 120 && residents.length <= 420, `detailed population escaped bounds: ${residents.length}`);

const legacySession = createWorldSession("POPULATION-LIFECYCLE-MIGRATION-19");
const legacyPayload = structuredClone(legacySession) as any;
legacyPayload.schemaVersion = 16;
delete legacyPayload.population.lifecycle;
legacyPayload.world.locations = legacyPayload.world.locations.filter((item: any) => item.type !== "education");
for (const resident of legacyPayload.population.residents) {
  delete resident.birthDay;
  delete resident.sex;
  delete resident.educationLevel;
  delete resident.educationProgressDays;
  delete resident.enrolledInstitutionId;
  delete resident.partnerId;
  delete resident.parentIds;
  delete resident.childIds;
  delete resident.generation;
  delete resident.retired;
}
const migrated = migrateEnvelope({
  slotId: "slot-1",
  schemaVersion: 16,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  checksum: "legacy",
  payload: legacyPayload
}, "slot-1");
assert(migrated, "migration returned null");
assert(migrated.schemaVersion === 22, "migration schema mismatch");
assert(migrated.payload.population.lifecycle.version === 1, "lifecycle state not created during migration");
assert(migrated.payload.population.lifecycle.institutions.length === 3, "education institutions not restored during migration");
assert(migrated.payload.world.locations.filter((item) => item.type === "education").length === 3, "education locations not restored during migration");
assert(migrated.payload.population.residents.every((resident) => typeof resident.birthDay === "number"), "resident birth dates not normalized");

console.log(JSON.stringify({
  integratedDays: session.population.simulatedDays,
  lifecycleDays: 3_650,
  initialResidents,
  finalResidents: residents.length,
  initialHouseholds,
  finalHouseholds: households.length,
  initialRepresented,
  finalRepresented: represented,
  births: lifecycle.totals.births,
  deaths: lifecycle.totals.deaths,
  immigrants: lifecycle.totals.immigrants,
  emigrants: lifecycle.totals.emigrants,
  partnerships: lifecycle.totals.partnerships,
  separations: lifecycle.totals.separations,
  householdsFormed: lifecycle.totals.householdsFormed,
  graduates: lifecycle.totals.graduates,
  retirements: lifecycle.totals.retirements,
  archivedResidents: lifecycle.archive.length,
  lifecycleEvents: lifecycle.events.length,
  educationInstitutions: lifecycle.institutions.length,
  kernelTransactions: session.kernel.totals.transactions,
  kernelWarnings: session.kernel.integrity.warnings,
  migrationSchema: migrated.schemaVersion
}, null, 2));
