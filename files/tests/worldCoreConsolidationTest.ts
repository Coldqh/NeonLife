import { createWorldSession } from "../src/world/generation/createWorld";
import { performPlayerLoopAction, progressLife } from "../src/gameplay/life/lifeSimulation";
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

const employerVenue = advanced.urban.venues.find((venue) => ["convenience", "clothing", "market", "weapon-shop"].includes(venue.category));
assert(employerVenue, "physical player employer was not generated");
const insideEmployer = {
  ...advanced,
  urban: {
    ...advanced.urban,
    venues: advanced.urban.venues.map((venue) => venue.id === employerVenue.id ? { ...venue, active: true, operatingStatus: "operating" as const, openHour: 0, closeHour: 24 } : venue)
  },
  localScene: {
    ...advanced.localScene,
    playerPosition: {
      ...advanced.localScene.playerPosition,
      state: "inside" as const,
      sectorId: employerVenue.sectorId,
      buildingId: employerVenue.buildingId,
      unitId: employerVenue.unitId,
      floor: employerVenue.floor,
      roomId: undefined,
      interiorZone: "unit" as const
    }
  }
};
const employedPlayer = performPlayerLoopAction(insideEmployer, { kind: "select-job", jobId: "store-clerk", venueId: employerVenue.id, employerName: employerVenue.name });
assert(employedPlayer.playerLoop.employment?.venueId === employerVenue.id, "physical player job was not selected");
const employedAdvanced = progressLife(employedPlayer, 6 * 60, { suppressTimeEvent: true });
const consolidated = advanceWorldCoreState({
  seed,
  timestamp: employedAdvanced.timestamp,
  playerId: employedAdvanced.player.id,
  locations: employedAdvanced.world.locations,
  organizations: employedAdvanced.world.organizations,
  economy: employedAdvanced.economy,
  population: employedAdvanced.population,
  urban: employedAdvanced.urban,
  kernel: employedAdvanced.kernel,
  previous: employedAdvanced.worldCore
});
assert(!consolidated.employments.some((employment) => employment.playerControlled), "simple player job must not be duplicated in the world-core labor registry");

console.log(JSON.stringify({
  businesses: advanced.worldCore.businesses.length,
  mergedBusinesses: advanced.worldCore.businesses.filter((business) => business.source === "merged").length,
  employments: advanced.worldCore.employments.length,
  kernelBusinessAccounts: advanced.worldCore.businesses.filter((business) => advanced.kernel.accounts.some((account) => account.entityId === business.id)).length,
  worldCoreRevision: advanced.worldCore.clock.revision,
  integrityWarnings: advanced.worldCore.integrity.warnings,
  playerEmploymentDuplicated: false
}, null, 2));
