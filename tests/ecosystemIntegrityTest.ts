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

for (let day = 1; day <= 365; day += 1) {
  session = progressLife(session, 24 * 60, {
    activity: "ECOSYSTEM INTEGRITY DAILY ADVANCE",
    suppressTimeEvent: true,
    trackBalance: false
  });
  dailyReconciliations += session.kernel.integrity.reconciliationTransactions;
  maximumDailyReconciliations = Math.max(maximumDailyReconciliations, session.kernel.integrity.reconciliationTransactions);
  assert(session.kernel.integrity.healthy, `kernel integrity failed on day ${day}: ${session.kernel.integrity.warnings.join(" | ")}`);
  assert(session.kernel.integrity.negativePhysicalBalances === 0, `negative physical balance on day ${day}`);
  sawRetailService ||= session.kernel.transactions.some((item) => item.reason === "retail-service");
  sawOperatingSettlement ||= session.kernel.transactions.some((item) => item.reason === "operating-settlement");
  sawClinicalSupplyConsumption ||= session.kernel.transactions.some((item) => item.reason === "inventory-transfer" && (item.description ?? "").includes("Clinical supplies consumed"));
  sawMedicalSettlement ||= session.kernel.transactions.some((item) => item.reason === "medical-service" || item.reason === "insurance-claim");
}

assert(dailyReconciliations === 0, `daily simulation produced ${dailyReconciliations} reconciliation transactions`);
assert(maximumDailyReconciliations === 0, `a daily step required ${maximumDailyReconciliations} reconciliations`);
assert(sawRetailService, "background retail revenue is not recorded");
assert(sawOperatingSettlement, "business operating settlement is not recorded");
assert(sawClinicalSupplyConsumption, "clinical supply consumption is not recorded");
assert(sawMedicalSettlement, "medical payments are not recorded");

let batch = createWorldSession("ECOSYSTEM-INTEGRITY-BATCH-20-1");
batch = progressLife(batch, 180 * 24 * 60, {
  activity: "ECOSYSTEM INTEGRITY BATCH ADVANCE",
  suppressTimeEvent: true,
  trackBalance: false
});

assert(batch.kernel.integrity.healthy, `batch kernel integrity failed: ${batch.kernel.integrity.warnings.join(" | ")}`);
assert(batch.kernel.integrity.reconciliationTransactions <= 5, `batch boundary required ${batch.kernel.integrity.reconciliationTransactions} reconciliations`);
assert(batch.kernel.integrity.reconciliationCreditVolume <= 500, `batch boundary credit settlement too large: ${batch.kernel.integrity.reconciliationCreditVolume}`);

console.log(JSON.stringify({
  dailyDays: 365,
  dailyReconciliations,
  maximumDailyReconciliations,
  dailyKernelWarnings: session.kernel.integrity.warnings,
  dailyTransactions: session.kernel.totals.transactions,
  batchDays: 180,
  batchReconciliations: batch.kernel.integrity.reconciliationTransactions,
  batchReconciliationCredits: batch.kernel.integrity.reconciliationCreditVolume,
  batchNegativePhysicalBalances: batch.kernel.integrity.negativePhysicalBalances
}, null, 2));
