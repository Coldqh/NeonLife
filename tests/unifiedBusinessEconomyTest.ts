import { createWorldSession } from "../src/world/generation/createWorld";
import { progressLife } from "../src/gameplay/life/lifeSimulation";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function creditBalance(session: ReturnType<typeof createWorldSession>, entityId: string): number | undefined {
  return session.kernel.accounts.find((account) => account.entityId === entityId)?.balances.find((entry) => entry.resource === "credits")?.amount;
}

const seed = "unified-business-economy";
const session = createWorldSession(seed);
const economy = session.businessEconomy;

assert(economy.integrity.healthy, economy.integrity.warnings.join(" | "));
assert(economy.businesses.length > 1_000, `citywide business registry is too small: ${economy.businesses.length}`);
assert(economy.companies.length > 500, `company registry is too small: ${economy.companies.length}`);
assert(economy.totals.materializedBusinesses < economy.businesses.length / 4, "business registry still depends on spatial materialization");
assert(new Set(economy.businesses.map((business) => business.id)).size === economy.businesses.length, "duplicate business ids");
assert(new Set(economy.businesses.map((business) => business.venueId)).size === economy.businesses.length, "duplicate venue links");
assert(economy.leases.length === economy.businesses.length, "every business must have a premises agreement");

const companyKinds = new Set(economy.companies.map((company) => company.kind));
for (const kind of ["independent", "franchise", "cooperative", "corporate", "public", "criminal"] as const) {
  assert(companyKinds.has(kind), `missing company kind: ${kind}`);
}

const companyIds = new Set(economy.companies.map((company) => company.id));
const inventoryIds = new Set(session.productInventory.inventories.map((inventory) => inventory.id));
for (const business of economy.businesses) {
  assert(companyIds.has(business.companyId), `${business.id} has no company`);
  assert(Boolean(business.sectorId && business.buildingId && business.unitId), `${business.id} has no physical premises`);
  assert(inventoryIds.has(business.inventoryId), `${business.id} has no canonical inventory`);
  const lease = economy.leases.find((item) => item.businessId === business.id);
  assert(lease?.premisesId === business.unitId, `${business.id} lease does not reference its unit`);
  assert(lease.tenantCompanyId === business.companyId, `${business.id} lease tenant differs from owner company`);
}

const organizationIds = new Set(session.world.organizations.map((organization) => organization.id));
for (const company of economy.companies.filter((item) => !organizationIds.has(item.id)).slice(0, 200)) {
  assert(creditBalance(session, company.id) !== undefined, `${company.id} has no kernel account`);
}
const contractCounts = session.kernel.contracts.reduce<Record<string, number>>((result, contract) => {
  result[contract.kind] = (result[contract.kind] ?? 0) + 1;
  return result;
}, {});
assert((contractCounts.lease ?? 0) >= economy.businesses.length, "business leases were not registered in kernel");
assert((contractCounts.license ?? 0) >= economy.businesses.length, "business licenses were not registered in kernel");

const initialStock = economy.businesses.reduce((sum, business) => sum + business.stockUnits, 0);
const month = progressLife(session, 30 * 24 * 60, { suppressTimeEvent: true });
assert(month.businessEconomy.integrity.healthy, month.businessEconomy.integrity.warnings.join(" | "));
assert(month.businessEconomy.markets.length > 10, "district/category markets were not created");
assert(month.businessEconomy.totals.revenue > 0 && month.businessEconomy.totals.expenses > 0, "business money flow did not advance");
assert(month.businessEconomy.totals.unitsSold > 0, "businesses sold no canonical products");
assert(month.businessEconomy.businesses.reduce((sum, business) => sum + business.stockUnits, 0) < initialStock, "market consumption did not reduce canonical stock");
assert(month.productInventory.transfers.some((transfer) => transfer.reason === "market-consumption"), "market sales did not preserve SKU/batch transfer history");
assert(month.businessEconomy.history.length >= 30, "daily business history is incomplete");
assert(month.businessEconomy.markets.some((market) => market.activeBusinessIds.length > 1 && market.concentration > 0), "competition metrics were not calculated");

const longRun = progressLife(session, 120 * 24 * 60, { suppressTimeEvent: true });
assert(longRun.businessEconomy.integrity.healthy, longRun.businessEconomy.integrity.warnings.join(" | "));
assert(longRun.businessEconomy.totals.openings > 0, "businesses never opened or reopened");
assert(longRun.businessEconomy.totals.bankruptcies > 0, "insolvent businesses never reached bankruptcy");
assert(longRun.businessEconomy.totals.acquisitions > 0, "healthy companies never acquired distressed businesses");
assert(longRun.businessEconomy.events.some((event) => event.kind === "bankrupt"), "bankruptcy lifecycle event is missing");
assert(longRun.businessEconomy.events.some((event) => event.kind === "acquired"), "acquisition lifecycle event is missing");

const longBusinessById = new Map(longRun.businessEconomy.businesses.map((business) => [business.id, business]));
for (const lease of longRun.businessEconomy.leases) {
  const business = longBusinessById.get(lease.businessId);
  assert(business, `${lease.id} references a missing business`);
  assert(lease.tenantCompanyId === business.companyId, `${lease.id} was not reassigned after ownership change`);
}
const accountByEntity = new Map(longRun.kernel.accounts.map((account) => [account.entityId, account]));
for (const business of longRun.businessEconomy.businesses.slice(0, 500)) {
  const balance = accountByEntity.get(business.id)?.balances.find((entry) => entry.resource === "credits")?.amount;
  assert(balance !== undefined && Math.abs(balance - business.cash) < .02, `${business.id} cash differs from kernel`);
}

console.log(JSON.stringify({
  businesses: economy.businesses.length,
  companies: economy.companies.length,
  materializedBusinesses: economy.totals.materializedBusinesses,
  companyKinds: Object.fromEntries([...companyKinds].map((kind) => [kind, economy.companies.filter((company) => company.kind === kind).length])),
  kernelContracts: contractCounts,
  monthRevenue: month.businessEconomy.totals.revenue,
  monthUnitsSold: month.businessEconomy.totals.unitsSold,
  markets: month.businessEconomy.markets.length,
  openings: longRun.businessEconomy.totals.openings,
  bankruptcies: longRun.businessEconomy.totals.bankruptcies,
  acquisitions: longRun.businessEconomy.totals.acquisitions,
  integrityWarnings: longRun.businessEconomy.integrity.warnings
}, null, 2));
