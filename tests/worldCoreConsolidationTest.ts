import { createWorldSession } from "../src/world/generation/createWorld";
import { progressLife } from "../src/gameplay/life/lifeSimulation";
import { interviewPlayerForVacancy, signPlayerWorkContract } from "../src/gameplay/jobs/work/workSystem";
import { advanceWorldCoreState } from "../src/simulation/worldCore/worldCoreSystem";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function credit(session: ReturnType<typeof createWorldSession>, entityId: string): number | undefined {
  return session.kernel.accounts.find((account) => account.entityId === entityId)?.balances.find((entry) => entry.resource === "credits")?.amount;
}

const seed = "world-core-consolidation";
const created = createWorldSession(seed);

assert(created.worldCore.version === 1, "world core was not created");
assert(created.worldCore.clock.timestamp === created.timestamp, "world core clock differs from session time");
assert(created.worldCore.integrity.healthy, `initial world core integrity failed: ${created.worldCore.integrity.warnings.join(" | ")}`);

for (const legacy of created.economy.businesses) {
  const canonicalId = created.worldCore.aliasToBusinessId[legacy.id];
  assert(canonicalId, `legacy business ${legacy.id} has no canonical id`);
  const canonical = created.worldCore.businesses.find((business) => business.id === canonicalId);
  assert(canonical, `canonical business ${canonicalId} is missing`);
  assert(Math.abs(canonical.cash - legacy.cash) < 0.01, `legacy cash is not projected from core for ${legacy.id}`);
}

for (const entry of created.urban.venueOperations.registry) {
  const canonicalId = created.worldCore.aliasToBusinessId[entry.venue.id]
    ?? created.worldCore.aliasToBusinessId[`venue-account:${entry.venue.id}`];
  assert(canonicalId, `venue ${entry.venue.id} has no canonical business`);
  const canonical = created.worldCore.businesses.find((business) => business.id === canonicalId);
  const operation = created.urban.venueOperations.operations.find((item) => item.venueId === entry.venue.id);
  assert(canonical && operation, `venue operation ${entry.venue.id} is missing`);
  assert(Math.abs(canonical.cash - operation.cash) < 0.01, `venue cash is not projected from core for ${entry.venue.id}`);
}

for (const business of created.worldCore.businesses) {
  assert(created.kernel.accounts.some((account) => account.entityId === business.id), `kernel account is missing for ${business.id}`);
}

for (const employment of created.population.employments) {
  assert(created.worldCore.employments.some((item) => item.sourceEmploymentId === employment.id), `employment ${employment.id} was not consolidated`);
}

const transactionCount = created.kernel.transactions.length;
const advanced = progressLife(created, 6 * 60, { suppressTimeEvent: true });
assert(advanced.worldCore.clock.timestamp === advanced.timestamp, "advanced world core clock differs from session time");
assert(advanced.worldCore.integrity.healthy, `advanced world core integrity failed: ${advanced.worldCore.integrity.warnings.join(" | ")}`);
assert(advanced.kernel.clock.lastAdvancedAt === advanced.worldCore.clock.timestamp, "kernel and world-core clocks diverged");

const newTransactions = advanced.kernel.transactions.slice(transactionCount);
const managedLocations = new Set(advanced.worldCore.businesses.filter((business) => business.source === "merged").map((business) => business.locationId));
for (const transaction of newTransactions.filter((item) => item.idempotencyKey.includes(":economy:") && item.reason === "retail-service")) {
  const managed = advanced.economy.businesses.find((business) => business.id === transaction.creditEntityId && managedLocations.has(business.locationId));
  assert(!managed, `managed venue ${managed?.id ?? transaction.creditEntityId} was simulated twice`);
}

const vacancy = advanced.jobs.work.vacancies[0];
assert(vacancy, "player vacancy is missing");
const skilledWork = {
  ...advanced.jobs.work,
  skills: { service: 100, cooking: 100, medical: 100, technical: 100 }
};
const interviewed = interviewPlayerForVacancy(skilledWork, vacancy.id, {
  seed,
  playerId: advanced.player.id,
  timestamp: advanced.timestamp,
  venues: advanced.urban.venueOperations.registry.map((entry) => entry.venue),
  venueOperations: advanced.urban.venueOperations,
  playerHealth: 100,
  playerFatigue: 0,
  playerStress: 0
});
const signed = signPlayerWorkContract(interviewed, vacancy.id, advanced.timestamp);
assert(signed.activeContractId, "player contract was not signed");
const consolidatedWithPlayer = advanceWorldCoreState({
  seed,
  timestamp: advanced.timestamp,
  playerId: advanced.player.id,
  locations: advanced.world.locations,
  organizations: advanced.world.organizations,
  economy: advanced.economy,
  population: advanced.population,
  urban: advanced.urban,
  work: signed,
  kernel: advanced.kernel,
  previous: advanced.worldCore
});
assert(consolidatedWithPlayer.employments.some((employment) => employment.sourcePlayerContractId === signed.activeContractId && employment.residentId === advanced.player.id), "player contract did not enter the unified labor registry");

console.log(JSON.stringify({
  businesses: advanced.worldCore.businesses.length,
  mergedBusinesses: advanced.worldCore.businesses.filter((business) => business.source === "merged").length,
  employments: advanced.worldCore.employments.length,
  kernelBusinessAccounts: advanced.worldCore.businesses.filter((business) => advanced.kernel.accounts.some((account) => account.entityId === business.id)).length,
  worldCoreRevision: advanced.worldCore.clock.revision,
  integrityWarnings: advanced.worldCore.integrity.warnings,
  playerEmploymentUnified: true
}, null, 2));
