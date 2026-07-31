import { createWorldSession } from "../src/world/generation/createWorld";
import { progressLife } from "../src/gameplay/life/lifeSimulation";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const DAILY_SEED = "ECOSYSTEM-INTEGRITY-20-1";
let session = createWorldSession(DAILY_SEED);
let dailyReconciliations = 0;
let maximumDailyReconciliations = 0;
let sawRetailService = false;
let sawOperatingSettlement = false;
let sawClinicalSupplyConsumption = false;
let sawMedicalSettlement = false;

function inspectStep(dayLabel: string): void {
  dailyReconciliations += session.kernel.integrity.reconciliationTransactions;
  maximumDailyReconciliations = Math.max(maximumDailyReconciliations, session.kernel.integrity.reconciliationTransactions);
  assert(session.kernel.integrity.healthy, `kernel integrity failed on ${dayLabel}: ${session.kernel.integrity.warnings.join(" | ")}`);
  assert(session.kernel.integrity.negativePhysicalBalances === 0, `negative physical balance on ${dayLabel}`);
  sawRetailService ||= session.kernel.transactions.some((item) => item.reason === "retail-service" || item.reason === "food-sale" || item.reason === "discretionary-service");
  sawOperatingSettlement ||= session.kernel.transactions.some((item) => item.reason === "operating-settlement" || item.reason === "tax");
  sawClinicalSupplyConsumption ||= session.health.totals.medicalUnitsConsumed > 0;
  sawMedicalSettlement ||= session.kernel.transactions.some((item) => item.reason === "medical-service" || item.reason === "insurance-claim");
}

for (let day = 1; day <= 7; day += 1) {
  session = progressLife(session, 24 * 60, {
    activity: "ECOSYSTEM INTEGRITY DAILY ADVANCE",
    suppressTimeEvent: true,
    trackBalance: false
  });
  inspectStep(`day ${day}`);
}
session = progressLife(session, (30 - 7) * 24 * 60, {
  activity: "ECOSYSTEM INTEGRITY MONTHLY BATCH",
  suppressTimeEvent: true,
  trackBalance: false
});
inspectStep("monthly batch");

assert(dailyReconciliations <= 2_500, `monthly simulation produced ${dailyReconciliations} reconciliation transactions`);
assert(maximumDailyReconciliations <= 500, `a simulation boundary required ${maximumDailyReconciliations} reconciliations`);
assert(sawRetailService, "background retail revenue is not recorded");
assert(sawOperatingSettlement, "business operating settlement is not recorded");
assert(sawClinicalSupplyConsumption, "clinical supply consumption is not recorded");
assert(sawMedicalSettlement, "medical payments are not recorded");

let batch = createWorldSession("ECOSYSTEM-INTEGRITY-BATCH-20-1");
batch = progressLife(batch, 30 * 24 * 60, {
  activity: "ECOSYSTEM INTEGRITY BATCH ADVANCE",
  suppressTimeEvent: true,
  trackBalance: false
});

assert(batch.kernel.integrity.healthy, `batch kernel integrity failed: ${batch.kernel.integrity.warnings.join(" | ")}`);
assert(batch.kernel.integrity.reconciliationTransactions <= 500, `batch boundary required ${batch.kernel.integrity.reconciliationTransactions} reconciliations`);
assert(batch.kernel.integrity.reconciliationCreditVolume <= 5_000_000, `batch boundary credit settlement too large: ${batch.kernel.integrity.reconciliationCreditVolume}`);

console.log(JSON.stringify({
  dailyDays: 30,
  dailyReconciliations,
  maximumDailyReconciliations,
  dailyKernelWarnings: session.kernel.integrity.warnings,
  dailyTransactions: session.kernel.totals.transactions,
  batchDays: 30,
  batchReconciliations: batch.kernel.integrity.reconciliationTransactions,
  batchReconciliationCredits: batch.kernel.integrity.reconciliationCreditVolume,
  batchNegativePhysicalBalances: batch.kernel.integrity.negativePhysicalBalances
}, null, 2));
