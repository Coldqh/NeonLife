import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { BusinessKind, BusinessState } from "../../gameplay/economy/types";
import type { OrganizationState } from "../../world/state/types";
import type { KernelTransactionDraft } from "../kernel/types";
import type { BackgroundResident, EmploymentRecord, HouseholdState } from "../population/types";
import type { ProductionShipmentState } from "../production/types";
import type {
  BusinessLicenseState,
  CrimeNetworkState,
  CrimeOperationKind,
  CriminalOperationState,
  DistrictLawState,
  EnforcementCaseKind,
  EnforcementCaseState,
  GovernmentAdvanceInput,
  GovernmentAdvanceResult,
  GovernmentCrimeState,
  GovernmentCrimeTotals,
  GovernmentDailySnapshot,
  GovernmentNotice,
  GovernmentPolicyState,
  LicenseKind,
  PublicBudgetState
} from "./types";

const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;
const MAX_CASES = 180;
const MAX_HISTORY = 180;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[], fallback = 0): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function authority(input: GovernmentAdvanceInput): OrganizationState {
  return input.organizations.find((item) => item.type === "government")
    ?? input.organizations.find((item) => item.type === "police")
    ?? input.organizations[0];
}

function policeOrganization(input: GovernmentAdvanceInput): OrganizationState {
  return input.organizations.find((item) => item.type === "police") ?? authority(input);
}

function criminalOrganizations(input: GovernmentAdvanceInput): OrganizationState[] {
  const gangs = input.organizations.filter((item) => item.type === "gang");
  return gangs.length ? gangs : input.organizations.filter((item) => item.type === "independent").slice(0, 1);
}

function licenseKindFor(kind: BusinessKind): LicenseKind {
  if (kind === "retail") return "retail";
  if (kind === "food-service") return "food";
  if (kind === "medical") return "medical";
  if (kind === "repair") return "industrial";
  if (kind === "logistics") return "logistics";
  return "data";
}

function licenseFee(kind: LicenseKind): number {
  if (kind === "medical") return 160;
  if (kind === "industrial") return 145;
  if (kind === "data") return 130;
  if (kind === "logistics") return 115;
  if (kind === "housing") return 105;
  if (kind === "security") return 180;
  return 75;
}

function defaultPolicy(seed: string): GovernmentPolicyState {
  const rng = new SeededRandom(`${seed}:government-policy`);
  return {
    householdIncomeTaxRate: rng.integer(5, 9),
    businessProfitTaxRate: rng.integer(11, 16),
    propertyTaxRate: rng.integer(2, 5),
    licenseStrictness: rng.integer(48, 68),
    laborInspection: rng.integer(38, 62),
    rentProtection: rng.integer(24, 48),
    socialSupport: rng.integer(30, 56),
    dataMonitoring: rng.integer(52, 76),
    contrabandEnforcement: rng.integer(46, 72),
    enforcementFocus: rng.pick(["property-crime", "contraband", "public-order", "corporate-compliance"] as const)
  };
}

function emptyTotals(): GovernmentCrimeTotals {
  return {
    taxesCollected: 0,
    licenseFeesCollected: 0,
    finesCollected: 0,
    socialTransfers: 0,
    publicGrants: 0,
    bribesPaid: 0,
    crimeRevenue: 0,
    cargoStolen: 0,
    arrests: 0,
    convictions: 0,
    casesOpened: 0,
    inspections: 0,
    licensesSuspended: 0
  };
}

function addTotals(target: GovernmentCrimeTotals, delta: Partial<GovernmentCrimeTotals>): void {
  for (const [key, value] of Object.entries(delta) as Array<[keyof GovernmentCrimeTotals, number | undefined]>) {
    if (typeof value === "number") target[key] += value;
  }
}

function createLicenses(input: GovernmentAdvanceInput, timestamp: number): BusinessLicenseState[] {
  return input.economy.businesses.map((business, index) => {
    const kind = licenseKindFor(business.kind);
    return {
      id: createStableEntityId("license", `${input.seed}:${business.id}:${kind}`),
      businessId: business.id,
      organizationId: business.organizationId,
      kind,
      status: "active",
      issuedAt: timestamp,
      expiresAt: timestamp + 180 * DAY_MS,
      feePerWeek: licenseFee(kind),
      violations: 0,
      inspectionRisk: clamp(25 + index * 3 + (business.status === "restricted" ? 22 : business.status === "closed" ? 35 : 0)),
      bribeExposure: kind === "industrial" || kind === "logistics" ? 48 : 24,
      nextReviewAt: timestamp + (4 + index % 5) * DAY_MS
    };
  });
}

function policeWorkers(input: GovernmentAdvanceInput, districtId: string): EmploymentRecord[] {
  const police = policeOrganization(input);
  const locations = new Set(input.locations.filter((item) => item.districtId === districtId).map((item) => item.id));
  return input.population.employments.filter((item) => item.organizationId === police.id && item.status !== "unemployed" && locations.has(item.locationId));
}

function createDistrictLaw(input: GovernmentAdvanceInput, timestamp: number): DistrictLawState[] {
  const police = policeOrganization(input);
  const policeBudgetFactor = clamp(Math.log10(Math.max(10, police.budget)) * 10, 20, 90);
  return input.districts.map((district) => {
    const officers = policeWorkers(input, district.id).length;
    const corporateBias = district.corporateInfluence * 0.22;
    const patrolCoverage = clamp(district.securityLevel * 0.52 + policeBudgetFactor * 0.25 + officers * 2 + corporateBias - district.gangInfluence * 0.18);
    return {
      districtId: district.id,
      patrolCoverage,
      policeReadiness: clamp(patrolCoverage + 8),
      corruption: clamp(18 + district.gangInfluence * 0.42 + district.corporateInfluence * 0.12 - district.governmentInfluence * 0.2),
      courtBacklog: Math.max(5, Math.round(38 + district.population / 20_000 - district.governmentInfluence * 0.25)),
      detentionLoad: clamp(20 + district.gangInfluence * 0.35),
      publicTrust: clamp(48 + district.governmentInfluence * 0.25 - district.gangInfluence * 0.32),
      violentCrime: clamp(district.gangInfluence * 0.62 + (100 - district.securityLevel) * 0.28),
      propertyCrime: clamp(district.gangInfluence * 0.45 + (100 - district.employmentRate) * 0.75),
      cyberCrime: clamp((100 - district.infrastructure) * 0.28 + district.corporateInfluence * 0.32),
      illegalMarketShare: clamp(district.gangInfluence * 0.72 + (100 - district.governmentInfluence) * 0.22),
      unresolvedCases: 0,
      arrests: 0,
      convictions: 0,
      bribesPaid: 0,
      lastUpdatedAt: timestamp
    };
  });
}

function crimeCandidates(input: GovernmentAdvanceInput): BackgroundResident[] {
  const employed = new Set(input.population.employments.filter((item) => item.status !== "unemployed").map((item) => item.residentId));
  const householdById = new Map(input.population.households.map((item) => [item.id, item]));
  return input.population.residents
    .filter((resident) => resident.lifeStage === "working-age" && resident.health !== "disabled")
    .filter((resident) => {
      const household = householdById.get(resident.householdId);
      return !employed.has(resident.id) || household?.status === "arrears" || household?.status === "displaced";
    })
    .sort((left, right) => {
      const leftHousehold = householdById.get(left.householdId);
      const rightHousehold = householdById.get(right.householdId);
      const leftPressure = (leftHousehold?.debt ?? 0) + (leftHousehold?.status === "displaced" ? 500 : 0);
      const rightPressure = (rightHousehold?.debt ?? 0) + (rightHousehold?.status === "displaced" ? 500 : 0);
      return rightPressure - leftPressure || left.id.localeCompare(right.id);
    });
}

function operationKindsForDistrict(input: GovernmentAdvanceInput, districtId: string): CrimeOperationKind[] {
  const district = input.districts.find((item) => item.id === districtId);
  if (!district) return ["cargo-diversion", "extortion"];
  if (district.corporateInfluence >= 70) return ["data-theft", "identity-fraud", "counterfeit-cyberware"];
  if (district.pollution >= 65) return ["cargo-diversion", "stim-market", "extortion"];
  return ["extortion", "identity-fraud", "stim-market"];
}

function createCrimeNetworks(input: GovernmentAdvanceInput, timestamp: number): CrimeNetworkState[] {
  const candidates = crimeCandidates(input);
  return criminalOrganizations(input).map((organization, orgIndex) => {
    const rng = new SeededRandom(`${input.seed}:crime-network:${organization.id}`);
    const members = candidates.filter((_, index) => index % Math.max(1, criminalOrganizations(input).length) === orgIndex).slice(0, rng.integer(8, 18));
    const influenceByDistrict = Object.fromEntries(input.districts.map((district) => [district.id, clamp(district.gangInfluence + rng.integer(-8, 12))]));
    const operations: CriminalOperationState[] = input.districts.flatMap((district, districtIndex) => operationKindsForDistrict(input, district.id).slice(0, districtIndex === 0 ? 3 : 2).map((kind, operationIndex) => ({
      id: createStableEntityId("crime-operation", `${input.seed}:${organization.id}:${district.id}:${kind}`),
      networkId: createStableEntityId("crime-network", `${input.seed}:${organization.id}`),
      districtId: district.id,
      kind,
      status: "active" as const,
      capacity: rng.integer(22, 58),
      demand: rng.integer(34, 74),
      risk: clamp(35 + district.securityLevel * 0.35 + operationIndex * 5),
      heat: rng.integer(8, 28),
      secrecy: rng.integer(52, 82),
      revenueToday: 0,
      costsToday: 0,
      contrabandUnits: kind === "counterfeit-cyberware" || kind === "stim-market" ? rng.integer(8, 28) : 0,
      lastUpdatedAt: timestamp
    })));
    return {
      id: createStableEntityId("crime-network", `${input.seed}:${organization.id}`),
      organizationId: organization.id,
      name: organization.name,
      leaderResidentId: members[0]?.id ?? null,
      memberResidentIds: members.map((item) => item.id),
      treasury: Math.max(12_000, Math.round(organization.budget * 0.16)),
      heat: rng.integer(12, 32),
      secrecy: rng.integer(58, 86),
      cohesion: rng.integer(46, 78),
      violence: organization.type === "gang" ? rng.integer(44, 72) : rng.integer(18, 38),
      corruptionBudget: rng.integer(2_000, 12_000),
      influenceByDistrict,
      operations,
      lastUpdatedAt: timestamp
    };
  });
}

export function createGovernmentCrimeState(input: GovernmentAdvanceInput): GovernmentCrimeState {
  const auth = authority(input);
  const dayIndex = Math.floor(input.timestamp / DAY_MS);
  return {
    version: 1,
    policy: defaultPolicy(input.seed),
    budget: {
      authorityOrganizationId: auth.id,
      treasury: Math.max(250_000, Math.round(auth.budget * 0.18)),
      reserveTarget: 400_000,
      debt: 0,
      incomeToday: 0,
      spendingToday: 0,
      taxIncome: 0,
      licenseIncome: 0,
      fineIncome: 0,
      socialSpending: 0,
      policingSpending: 0,
      infrastructureGrants: 0,
      medicalGrants: 0,
      courtSpending: 0,
      lastSettlementDay: dayIndex
    },
    licenses: createLicenses(input, input.timestamp),
    districts: createDistrictLaw(input, input.timestamp),
    crimeNetworks: createCrimeNetworks(input, input.timestamp),
    cases: [],
    history: [],
    totals: emptyTotals(),
    dayIndex,
    simulatedDays: 0,
    lastUpdatedAt: input.timestamp
  };
}

function normalizeLicense(value: BusinessLicenseState, fallback: BusinessLicenseState): BusinessLicenseState {
  return {
    ...fallback,
    ...value,
    violations: typeof value.violations === "number" ? value.violations : 0,
    inspectionRisk: typeof value.inspectionRisk === "number" ? value.inspectionRisk : fallback.inspectionRisk,
    bribeExposure: typeof value.bribeExposure === "number" ? value.bribeExposure : fallback.bribeExposure
  };
}

export function normalizeGovernmentCrimeState(value: unknown, input: GovernmentAdvanceInput): GovernmentCrimeState {
  const fresh = createGovernmentCrimeState(input);
  if (!value || typeof value !== "object") return fresh;
  const raw = value as Partial<GovernmentCrimeState>;
  if (raw.version !== 1 || !raw.budget || !Array.isArray(raw.districts)) return fresh;
  const licenseByBusiness = new Map((raw.licenses ?? []).map((item) => [item.businessId, item]));
  const districtById = new Map(raw.districts.map((item) => [item.districtId, item]));
  const networkByOrg = new Map((raw.crimeNetworks ?? []).map((item) => [item.organizationId, item]));
  return {
    ...fresh,
    ...raw,
    policy: { ...fresh.policy, ...(raw.policy ?? {}) },
    budget: { ...fresh.budget, ...raw.budget },
    licenses: fresh.licenses.map((item) => normalizeLicense(licenseByBusiness.get(item.businessId) ?? item, item)),
    districts: fresh.districts.map((item) => ({ ...item, ...(districtById.get(item.districtId) ?? {}) })),
    crimeNetworks: fresh.crimeNetworks.map((item) => ({ ...item, ...(networkByOrg.get(item.organizationId) ?? {}), operations: networkByOrg.get(item.organizationId)?.operations ?? item.operations })),
    cases: Array.isArray(raw.cases) ? raw.cases : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    totals: { ...fresh.totals, ...(raw.totals ?? {}) },
    dayIndex: typeof raw.dayIndex === "number" ? raw.dayIndex : fresh.dayIndex,
    simulatedDays: typeof raw.simulatedDays === "number" ? raw.simulatedDays : 0,
    lastUpdatedAt: typeof raw.lastUpdatedAt === "number" ? raw.lastUpdatedAt : input.timestamp
  };
}

function updateOrganizationBudget(organizations: OrganizationState[], organizationId: string, delta: number): OrganizationState[] {
  if (!delta) return organizations;
  return organizations.map((item) => item.id === organizationId ? { ...item, budget: Math.max(0, item.budget + delta) } : item);
}

function pushTransaction(transactions: KernelTransactionDraft[], draft: KernelTransactionDraft): void {
  if (draft.amount > 0) transactions.push(draft);
}

function householdTaxBase(household: HouseholdState): number {
  return Math.max(0, household.dailyIncome || household.lastLedger?.income || 0);
}

function districtForBusiness(input: GovernmentAdvanceInput, business: BusinessState): string | undefined {
  return input.locations.find((item) => item.id === business.locationId)?.districtId;
}

function caseKindFor(operation: CriminalOperationState): EnforcementCaseKind {
  if (operation.kind === "cargo-diversion") return "cargo-theft";
  if (operation.kind === "data-theft" || operation.kind === "identity-fraud") return "cybercrime";
  if (operation.kind === "extortion") return "extortion";
  if (operation.kind === "counterfeit-cyberware" || operation.kind === "stim-market") return "contraband";
  return "organized-crime";
}

function vulnerableShipment(shipments: ProductionShipmentState[], districtId: string): ProductionShipmentState | undefined {
  return shipments
    .filter((item) => item.status === "in-transit" && item.routeDistrictIds.includes(districtId) && item.units > 1)
    .sort((left, right) => right.units * right.unitPrice - left.units * left.unitPrice)[0];
}

function officerCandidates(input: GovernmentAdvanceInput, districtId: string): BackgroundResident[] {
  const police = policeOrganization(input);
  const employmentByResident = new Map(input.population.employments.filter((item) => item.organizationId === police.id && item.status !== "unemployed").map((item) => [item.residentId, item]));
  return input.population.residents
    .filter((resident) => employmentByResident.has(resident.id))
    .filter((resident) => resident.districtId === districtId || (resident.skills?.security ?? 0) >= 55)
    .sort((left, right) => (right.skills?.security ?? right.skillLevel) - (left.skills?.security ?? left.skillLevel));
}

function crimePressure(input: GovernmentAdvanceInput, law: DistrictLawState): number {
  const cohort = input.population.cohorts.find((item) => item.districtId === law.districtId);
  const employmentBase = Math.max(1, (cohort?.employed ?? 0) + (cohort?.unemployed ?? 0));
  const unemployment = (cohort?.unemployed ?? 0) / employmentBase * 100;
  const arrears = (cohort?.householdsInArrears ?? 0) / Math.max(1, cohort?.households ?? 1) * 100;
  const data = input.infrastructure.services.filter((item) => item.districtId === law.districtId && item.kind === "data");
  const dataWeakness = 100 - mean(data.map((item) => item.serviceLevel), 55);
  return clamp(unemployment * 0.42 + arrears * 0.3 + dataWeakness * 0.18 + law.illegalMarketShare * 0.28 + (100 - law.patrolCoverage) * 0.25);
}

function applyBusinessLicenseStatus(business: BusinessState, license: BusinessLicenseState): BusinessState {
  if (license.status === "revoked") return { ...business, status: "closed", staffing: Math.max(0, business.staffing - 15) };
  if (license.status === "suspended") return { ...business, status: business.kind === "medical" ? "restricted" : "closed", staffing: Math.max(0, business.staffing - 8) };
  if (license.status === "probation" && business.status === "stable") return { ...business, status: "strained" };
  return business;
}

export function advanceGovernmentCrime(state: GovernmentCrimeState, input: GovernmentAdvanceInput): GovernmentAdvanceResult {
  if (input.timestamp <= state.lastUpdatedAt) {
    return { state, organizations: input.organizations, population: input.population, economy: input.economy, infrastructure: input.infrastructure, production: input.production, notices: [], transactions: [] };
  }
  const targetDay = Math.floor(input.timestamp / DAY_MS);
  let dayIndex = Math.max(state.dayIndex, Math.floor(state.lastUpdatedAt / DAY_MS));
  let organizations = input.organizations.map((item) => ({ ...item }));
  let population = { ...input.population, households: input.population.households.map((item) => ({ ...item })), employments: input.population.employments.map((item) => ({ ...item })) };
  let economy = { ...input.economy, businesses: input.economy.businesses.map((item) => ({ ...item })) };
  let infrastructure = { ...input.infrastructure, networks: input.infrastructure.networks.map((item) => ({ ...item })) };
  let production = { ...input.production, facilities: input.production.facilities.map((item) => ({ ...item, inventory: item.inventory.map((entry) => ({ ...entry })) })), shipments: input.production.shipments.map((item) => ({ ...item })) };
  let policy = { ...state.policy };
  let budget: PublicBudgetState = { ...state.budget };
  let licenses = state.licenses.map((item) => ({ ...item }));
  let districts = state.districts.map((item) => ({ ...item }));
  let crimeNetworks = state.crimeNetworks.map((item) => ({ ...item, memberResidentIds: [...item.memberResidentIds], influenceByDistrict: { ...item.influenceByDistrict }, operations: item.operations.map((operation) => ({ ...operation })) }));
  let cases = state.cases.map((item) => ({ ...item, assignedOfficerIds: [...item.assignedOfficerIds], detainedResidentIds: [...item.detainedResidentIds] }));
  const history = [...state.history];
  const totals = { ...state.totals };
  const notices: GovernmentNotice[] = [];
  const transactions: KernelTransactionDraft[] = [];
  const authorityOrg = authority({ ...input, organizations });
  const policeOrg = policeOrganization({ ...input, organizations });

  while (dayIndex < targetDay) {
    dayIndex += 1;
    const timestamp = dayIndex * DAY_MS;
    const rng = new SeededRandom(`${input.seed}:government-day:${dayIndex}`);
    const dayTotals = emptyTotals();
    budget = {
      ...budget,
      incomeToday: 0,
      spendingToday: 0,
      taxIncome: 0,
      licenseIncome: 0,
      fineIncome: 0,
      socialSpending: 0,
      policingSpending: 0,
      infrastructureGrants: 0,
      medicalGrants: 0,
      courtSpending: 0,
      lastSettlementDay: dayIndex
    };

    population.households = population.households.map((household) => {
      const tax = Math.min(household.balance, Math.round(householdTaxBase(household) * policy.householdIncomeTaxRate / 100));
      if (tax <= 0) return household;
      budget.treasury += tax;
      budget.incomeToday += tax;
      budget.taxIncome += tax;
      addTotals(dayTotals, { taxesCollected: tax });
      pushTransaction(transactions, {
        idempotencyKey: `${input.seed}:tax:household:${dayIndex}:${household.id}`,
        timestamp,
        debitEntityId: household.id,
        creditEntityId: authorityOrg.id,
        resource: "credits",
        amount: tax,
        reason: "tax",
        description: "Daily household income levy."
      });
      return { ...household, balance: household.balance - tax };
    });

    economy.businesses = economy.businesses.map((business) => {
      const profitBase = Math.max(0, business.rollingProfit);
      const tax = Math.min(Math.max(0, business.cash), Math.round(profitBase * policy.businessProfitTaxRate / 100));
      if (tax <= 0) return business;
      budget.treasury += tax;
      budget.incomeToday += tax;
      budget.taxIncome += tax;
      addTotals(dayTotals, { taxesCollected: tax });
      pushTransaction(transactions, {
        idempotencyKey: `${input.seed}:tax:business:${dayIndex}:${business.id}`,
        timestamp,
        debitEntityId: business.id,
        creditEntityId: authorityOrg.id,
        resource: "credits",
        amount: tax,
        reason: "tax",
        description: "Business operating-profit levy."
      });
      return { ...business, cash: business.cash - tax };
    });

    if (dayIndex % 7 === 0) {
      licenses = licenses.map((license) => {
        const business = economy.businesses.find((item) => item.id === license.businessId);
        if (!business || license.status === "revoked") return license;
        const fee = Math.min(Math.max(0, business.cash), license.feePerWeek);
        economy.businesses = economy.businesses.map((item) => item.id === business.id ? { ...item, cash: item.cash - fee } : item);
        budget.treasury += fee;
        budget.incomeToday += fee;
        budget.licenseIncome += fee;
        addTotals(dayTotals, { licenseFeesCollected: fee });
        if (fee > 0) pushTransaction(transactions, {
          idempotencyKey: `${input.seed}:license-fee:${dayIndex}:${license.id}`,
          timestamp,
          debitEntityId: business.id,
          creditEntityId: authorityOrg.id,
          resource: "credits",
          amount: fee,
          reason: "license-fee",
          description: `${license.kind} operating license fee.`
        });
        const missed = fee < license.feePerWeek;
        const violations = license.violations + (missed ? 1 : 0);
        const status = violations >= 4 ? "revoked" : violations >= 2 ? "suspended" : missed ? "probation" : license.status === "probation" ? "active" : license.status;
        if ((status === "suspended" || status === "revoked") && status !== license.status) {
          addTotals(dayTotals, { licensesSuspended: 1 });
          notices.push({ organizationId: license.organizationId, districtId: districtForBusiness(input, business), title: `${input.locations.find((item) => item.id === business.locationId)?.name ?? "BUSINESS"}: лицензия ограничена.`, detail: `${license.kind.toUpperCase()} · нарушения ${violations}.`, importance: status === "revoked" ? 3 : 2 });
        }
        return { ...license, violations, status, nextReviewAt: timestamp + 7 * DAY_MS };
      });
    }

    licenses = licenses.map((license) => {
      if (timestamp < license.nextReviewAt || license.status === "revoked") return license;
      const business = economy.businesses.find((item) => item.id === license.businessId);
      if (!business) return license;
      const districtId = districtForBusiness(input, business);
      const law = districts.find((item) => item.districtId === districtId);
      const inspectionChance = clamp(policy.licenseStrictness * 0.35 + license.inspectionRisk * 0.45 + (business.shortage ? 12 : 0) - (law?.corruption ?? 0) * 0.25) / 100;
      if (!rng.chance(inspectionChance)) return { ...license, nextReviewAt: timestamp + rng.integer(3, 8) * DAY_MS };
      addTotals(dayTotals, { inspections: 1 });
      const violationRisk = clamp((100 - business.infrastructureServiceLevel) * 0.26 + business.lossDays * 6 + (business.status === "closed" ? 30 : 0) + rng.integer(-12, 18));
      const violation = violationRisk >= 52;
      const fine = violation ? Math.min(business.cash, Math.round(80 + violationRisk * 3.2)) : 0;
      if (fine > 0) {
        economy.businesses = economy.businesses.map((item) => item.id === business.id ? { ...item, cash: item.cash - fine } : item);
        budget.treasury += fine;
        budget.incomeToday += fine;
        budget.fineIncome += fine;
        addTotals(dayTotals, { finesCollected: fine });
        pushTransaction(transactions, {
          idempotencyKey: `${input.seed}:inspection-fine:${dayIndex}:${license.id}`,
          timestamp,
          debitEntityId: business.id,
          creditEntityId: authorityOrg.id,
          resource: "credits",
          amount: fine,
          reason: "fine",
          description: "Regulatory inspection fine."
        });
      }
      const violations = Math.max(0, license.violations + (violation ? 1 : -1));
      const status = violations >= 4 ? "revoked" : violations >= 2 ? "suspended" : violations === 1 ? "probation" : "active";
      return { ...license, violations, status, lastInspectionAt: timestamp, nextReviewAt: timestamp + rng.integer(4, 10) * DAY_MS };
    });

    economy.businesses = economy.businesses.map((business) => {
      const license = licenses.find((item) => item.businessId === business.id);
      return license ? applyBusinessLicenseStatus(business, license) : business;
    });

    const welfareCandidates = population.households
      .filter((item) => item.status === "arrears" || item.status === "displaced" || item.balance < 50)
      .sort((left, right) => left.balance - right.balance || right.debt - left.debt)
      .slice(0, Math.max(2, Math.round(policy.socialSupport / 12)));
    for (const household of welfareCandidates) {
      const grant = Math.min(budget.treasury, household.status === "displaced" ? 70 : 38);
      if (grant <= 0 || budget.treasury <= budget.reserveTarget * 0.25) break;
      population.households = population.households.map((item) => item.id === household.id ? { ...item, balance: item.balance + grant } : item);
      budget.treasury -= grant;
      budget.spendingToday += grant;
      budget.socialSpending += grant;
      addTotals(dayTotals, { socialTransfers: grant });
      pushTransaction(transactions, {
        idempotencyKey: `${input.seed}:social-transfer:${dayIndex}:${household.id}`,
        timestamp,
        debitEntityId: authorityOrg.id,
        creditEntityId: household.id,
        resource: "credits",
        amount: grant,
        reason: "social-transfer",
        description: "Means-tested household support."
      });
    }

    const policeAllocation = Math.min(budget.treasury, Math.max(800, Math.round(budget.incomeToday * 0.28)));
    if (policeAllocation > 0) {
      budget.treasury -= policeAllocation;
      budget.spendingToday += policeAllocation;
      budget.policingSpending += policeAllocation;
      organizations = updateOrganizationBudget(organizations, policeOrg.id, policeAllocation);
      pushTransaction(transactions, {
        idempotencyKey: `${input.seed}:police-budget:${dayIndex}`,
        timestamp,
        debitEntityId: authorityOrg.id,
        creditEntityId: policeOrg.id,
        resource: "credits",
        amount: policeAllocation,
        reason: "public-grant",
        description: "Daily district security allocation."
      });
      addTotals(dayTotals, { publicGrants: policeAllocation });
    }

    const courtAllocation = Math.min(budget.treasury, Math.max(180, Math.round(budget.incomeToday * 0.08)));
    if (courtAllocation > 0) {
      budget.treasury -= courtAllocation;
      budget.spendingToday += courtAllocation;
      budget.courtSpending += courtAllocation;
      pushTransaction(transactions, {
        idempotencyKey: `${input.seed}:court-budget:${dayIndex}`,
        timestamp,
        debitEntityId: authorityOrg.id,
        creditEntityId: createStableEntityId("kernel-system", `${input.seed}:city-courts`),
        resource: "credits",
        amount: courtAllocation,
        reason: "public-grant",
        description: "Court administration and case processing allocation."
      });
      addTotals(dayTotals, { publicGrants: courtAllocation });
    }

    if (dayIndex % 3 === 0) {
      const weakest = infrastructure.networks.slice().sort((left, right) => left.averageServiceLevel - right.averageServiceLevel)[0];
      if (weakest && weakest.averageServiceLevel < 72 && budget.treasury > budget.reserveTarget * 0.35) {
        const grant = Math.min(4_000, Math.max(0, budget.treasury - budget.reserveTarget * 0.35));
        infrastructure.networks = infrastructure.networks.map((item) => item.id === weakest.id ? { ...item, reserveFund: item.reserveFund + grant } : item);
        organizations = updateOrganizationBudget(organizations, weakest.providerEntityId, grant);
        budget.treasury -= grant;
        budget.spendingToday += grant;
        budget.infrastructureGrants += grant;
        addTotals(dayTotals, { publicGrants: grant });
        pushTransaction(transactions, {
          idempotencyKey: `${input.seed}:infrastructure-grant:${dayIndex}:${weakest.id}`,
          timestamp,
          debitEntityId: authorityOrg.id,
          creditEntityId: weakest.providerEntityId,
          resource: "credits",
          amount: grant,
          reason: "public-grant",
          description: `${weakest.kind} network stabilization grant.`
        });
      }
    }

    const policeBudget = organizations.find((item) => item.id === policeOrg.id)?.budget ?? policeOrg.budget;
    districts = districts.map((law) => {
      const district = input.districts.find((item) => item.id === law.districtId);
      const officers = policeWorkers({ ...input, organizations, population }, law.districtId).length;
      const priority = district ? district.corporateInfluence * 0.28 + district.governmentInfluence * 0.22 + law.propertyCrime * 0.2 + law.violentCrime * 0.3 : 50;
      const readiness = clamp(law.policeReadiness * 0.78 + Math.log10(Math.max(10, policeBudget)) * 3 + officers * 1.8 - law.corruption * 0.18);
      const coverage = clamp(law.patrolCoverage * 0.72 + readiness * 0.2 + priority * 0.08);
      return { ...law, policeReadiness: readiness, patrolCoverage: coverage, courtBacklog: Math.max(0, law.courtBacklog - Math.round(budget.courtSpending / 1_000)), lastUpdatedAt: timestamp };
    });

    const newCases: EnforcementCaseState[] = [];
    crimeNetworks = crimeNetworks.map((network) => {
      const memberTarget = Math.max(6, Math.round(mean(Object.values(network.influenceByDistrict), 20) / 4));
      if (network.memberResidentIds.length < memberTarget) {
        const candidates = crimeCandidates({ ...input, organizations, population, economy, infrastructure, production }).filter((item) => !crimeNetworks.some((other) => other.memberResidentIds.includes(item.id)));
        const recruit = candidates[0];
        if (recruit) network.memberResidentIds.push(recruit.id);
      }
      let dailyRevenue = 0;
      let dailyCosts = 0;
      const operations = network.operations.map((operation) => {
        const law = districts.find((item) => item.districtId === operation.districtId);
        if (!law) return operation;
        const pressure = crimePressure({ ...input, organizations, population, economy, infrastructure, production }, law);
        const enforcement = clamp(law.patrolCoverage * 0.55 + law.policeReadiness * 0.25 + policy.contrabandEnforcement * 0.2 - law.corruption * 0.42);
        const demand = clamp(operation.demand * 0.72 + pressure * 0.28);
        const effectiveCapacity = Math.max(0, operation.capacity * (operation.status === "disrupted" ? 0.3 : operation.status === "strained" ? 0.68 : operation.status === "dormant" ? 0.1 : 1));
        let revenue = Math.round(Math.min(demand, effectiveCapacity) * (operation.kind === "data-theft" || operation.kind === "identity-fraud" ? 5.2 : operation.kind === "counterfeit-cyberware" ? 8.5 : 4.1));
        let costs = Math.round(revenue * (0.18 + operation.risk / 500));
        let contrabandUnits = operation.contrabandUnits;
        let victimBusinessId = operation.victimBusinessId;
        let heatGain = 1;
        let revenueRecorded = false;

        if (operation.kind === "extortion") {
          const targets = economy.businesses.filter((business) => districtForBusiness(input, business) === operation.districtId && business.cash > 100 && business.organizationId !== network.organizationId);
          const target = targets.sort((left, right) => right.cash - left.cash)[0];
          if (target) {
            const payment = Math.min(target.cash, Math.max(12, Math.round(revenue * 0.52)));
            economy.businesses = economy.businesses.map((item) => item.id === target.id ? { ...item, cash: item.cash - payment, lossDays: item.lossDays + 1 } : item);
            revenue = payment;
            victimBusinessId = target.id;
            pushTransaction(transactions, {
              idempotencyKey: `${input.seed}:extortion:${dayIndex}:${operation.id}:${target.id}`,
              timestamp,
              debitEntityId: target.id,
              creditEntityId: network.organizationId,
              resource: "credits",
              amount: payment,
              reason: "extortion",
              description: "Protection payment extracted from local business."
            });
            revenueRecorded = true;
          }
        } else if (operation.kind === "cargo-diversion") {
          const shipment = vulnerableShipment(production.shipments, operation.districtId);
          if (shipment) {
            const stolen = Math.min(shipment.units - 1, Math.max(1, Math.round(shipment.units * (0.08 + pressure / 500))));
            production.shipments = production.shipments.map((item) => item.id === shipment.id ? { ...item, units: Math.max(1, item.units - stolen), condition: clamp(item.condition - stolen * 2) } : item);
            contrabandUnits += stolen;
            revenue = stolen * Math.max(1, shipment.unitPrice);
            addTotals(dayTotals, { cargoStolen: stolen });
            pushTransaction(transactions, {
              idempotencyKey: `${input.seed}:cargo-theft:${dayIndex}:${operation.id}:${shipment.id}`,
              timestamp,
              debitEntityId: createStableEntityId("kernel-system", `${input.seed}:logistics-clearing`),
              creditEntityId: network.organizationId,
              resource: shipment.resource === "food-units" ? "food-units" : shipment.resource === "medical-units" ? "medical-units" : shipment.resource === "parts-units" ? "parts-units" : shipment.resource === "document-units" ? "document-units" : "mixed-units",
              amount: stolen,
              unitValue: shipment.unitPrice,
              reason: "cargo-theft",
              description: "Shipment units diverted into the illegal market."
            });
            pushTransaction(transactions, {
              idempotencyKey: `${input.seed}:cargo-fencing:${dayIndex}:${operation.id}:${shipment.id}`,
              timestamp,
              debitEntityId: createStableEntityId("kernel-system", `${input.seed}:illegal-consumption`),
              creditEntityId: network.organizationId,
              resource: "credits",
              amount: stolen * Math.max(1, shipment.unitPrice),
              reason: "contraband-sale",
              description: "Diverted cargo fenced through the illegal market."
            });
            revenueRecorded = true;
            heatGain += 4;
          }
        } else if (operation.kind === "stim-market" || operation.kind === "counterfeit-cyberware") {
          const sold = Math.min(contrabandUnits, Math.max(0, Math.round(demand / 9)));
          contrabandUnits -= sold;
          revenue = sold * (operation.kind === "counterfeit-cyberware" ? 24 : 9);
          if (sold > 0) pushTransaction(transactions, {
            idempotencyKey: `${input.seed}:contraband-sale:${dayIndex}:${operation.id}`,
            timestamp,
            debitEntityId: createStableEntityId("kernel-system", `${input.seed}:illegal-consumption`),
            creditEntityId: network.organizationId,
            resource: "credits",
            amount: sold * (operation.kind === "counterfeit-cyberware" ? 24 : 9),
            reason: "contraband-sale",
            description: `${operation.kind} street-market turnover.`
          });
          if (sold > 0) revenueRecorded = true;
        }

        if (revenue > 0 && !revenueRecorded) {
          pushTransaction(transactions, {
            idempotencyKey: `${input.seed}:illegal-revenue:${dayIndex}:${operation.id}`,
            timestamp,
            debitEntityId: createStableEntityId("kernel-system", `${input.seed}:illegal-consumption`),
            creditEntityId: network.organizationId,
            resource: "credits",
            amount: revenue,
            reason: "contraband-sale",
            description: `${operation.kind} illegal-market revenue.`
          });
        }
        if (costs > 0) {
          pushTransaction(transactions, {
            idempotencyKey: `${input.seed}:crime-cost:${dayIndex}:${operation.id}`,
            timestamp,
            debitEntityId: network.organizationId,
            creditEntityId: createStableEntityId("kernel-system", `${input.seed}:unregistered-market`),
            resource: "credits",
            amount: costs,
            reason: "operating-settlement",
            description: `${operation.kind} operating costs.`
          });
        }

        const detection = clamp(enforcement + operation.heat * 0.35 - operation.secrecy * 0.32 + rng.integer(-12, 16));
        if (detection >= 58) {
          const existing = cases.find((item) => item.operationId === operation.id && item.status !== "closed" && item.status !== "cold");
          if (!existing) {
            const officers = officerCandidates({ ...input, organizations, population }, operation.districtId).slice(0, 3).map((item) => item.id);
            newCases.push({
              id: createStableEntityId("enforcement-case", `${input.seed}:${operation.id}:${dayIndex}`),
              districtId: operation.districtId,
              networkId: network.id,
              operationId: operation.id,
              kind: caseKindFor(operation),
              status: "open",
              evidence: clamp(detection - 35),
              priority: clamp(operation.heat + operation.capacity * 0.5),
              openedAt: timestamp,
              updatedAt: timestamp,
              assignedOfficerIds: officers,
              detainedResidentIds: [],
              seizedCredits: 0,
              arrests: 0
            });
            addTotals(dayTotals, { casesOpened: 1 });
          }
          heatGain += 3;
        }

        const heat = clamp(operation.heat + heatGain + revenue / 180 - enforcement / 35);
        const status: CriminalOperationState["status"] = enforcement > heat + 24 ? "disrupted" : heat > 82 ? "strained" : effectiveCapacity <= 3 ? "dormant" : "active";
        dailyRevenue += Math.max(0, revenue);
        dailyCosts += Math.max(0, costs);
        return { ...operation, status, demand, heat, contrabandUnits, victimBusinessId, revenueToday: Math.max(0, revenue), costsToday: Math.max(0, costs), lastUpdatedAt: timestamp };
      });

      let treasury = Math.max(0, network.treasury + dailyRevenue - dailyCosts);
      let corruptionBudget = network.corruptionBudget;
      let heat = clamp(network.heat * 0.76 + mean(operations.map((item) => item.heat), network.heat) * 0.24);
      let bribePaid = 0;
      const hottestDistrict = districts.slice().sort((left, right) => (network.influenceByDistrict[right.districtId] ?? 0) - (network.influenceByDistrict[left.districtId] ?? 0))[0];
      if (heat >= 58 && hottestDistrict && corruptionBudget > 0 && treasury > 500) {
        const bribe = Math.min(corruptionBudget, treasury, Math.round(120 + heat * 3));
        treasury -= bribe;
        corruptionBudget -= bribe;
        bribePaid = bribe;
        districts = districts.map((item) => item.districtId === hottestDistrict.districtId ? { ...item, corruption: clamp(item.corruption + bribe / 500), bribesPaid: item.bribesPaid + bribe, publicTrust: clamp(item.publicTrust - bribe / 900) } : item);
        addTotals(dayTotals, { bribesPaid: bribe });
        pushTransaction(transactions, {
          idempotencyKey: `${input.seed}:bribe:${dayIndex}:${network.id}`,
          timestamp,
          debitEntityId: network.organizationId,
          creditEntityId: createStableEntityId("kernel-system", `${input.seed}:corrupt-officials`),
          resource: "credits",
          amount: bribe,
          reason: "bribe",
          description: "Illegal payment used to reduce enforcement pressure."
        });
        heat = clamp(heat - 5);
      }
      organizations = updateOrganizationBudget(organizations, network.organizationId, dailyRevenue - dailyCosts - bribePaid);
      addTotals(dayTotals, { crimeRevenue: dailyRevenue });
      return { ...network, treasury, corruptionBudget, heat, operations, lastUpdatedAt: timestamp };
    });

    cases.push(...newCases);
    cases = cases.map((caseState) => {
      if (caseState.status === "closed" || caseState.status === "cold") return caseState;
      const law = districts.find((item) => item.districtId === caseState.districtId);
      const network = crimeNetworks.find((item) => item.id === caseState.networkId);
      if (!law || !network) return caseState;
      const operation = network.operations.find((item) => item.id === caseState.operationId);
      const evidenceGain = clamp(law.policeReadiness * 0.15 + policy.dataMonitoring * 0.12 + (operation?.heat ?? 20) * 0.1 - law.corruption * 0.18 + rng.integer(-5, 8), -8, 28);
      let evidence = clamp(caseState.evidence + evidenceGain);
      let status: EnforcementCaseState["status"] = evidence >= 72 ? "charged" : evidence >= 35 ? "investigating" : "open";
      let detainedResidentIds = caseState.detainedResidentIds;
      let seizedCredits = caseState.seizedCredits;
      let arrests = caseState.arrests;
      if (status === "charged" && network.memberResidentIds.length && law.detentionLoad < 94) {
        const arrestCount = Math.min(network.memberResidentIds.length, evidence >= 90 ? 2 : 1);
        const detained = network.memberResidentIds.slice(-arrestCount);
        network.memberResidentIds = network.memberResidentIds.filter((id) => !detained.includes(id));
        detainedResidentIds = [...new Set([...detainedResidentIds, ...detained])];
        arrests += detained.length;
        const seizure = Math.min(network.treasury, Math.round(100 + evidence * 6));
        network.treasury -= seizure;
        organizations = updateOrganizationBudget(organizations, network.organizationId, -seizure);
        seizedCredits += seizure;
        budget.treasury += seizure;
        budget.incomeToday += seizure;
        budget.fineIncome += seizure;
        law.detentionLoad = clamp(law.detentionLoad + detained.length * 3);
        law.arrests += detained.length;
        addTotals(dayTotals, { arrests: detained.length, finesCollected: seizure });
        if (seizure > 0) pushTransaction(transactions, {
          idempotencyKey: `${input.seed}:seizure:${dayIndex}:${caseState.id}`,
          timestamp,
          debitEntityId: network.organizationId,
          creditEntityId: authorityOrg.id,
          resource: "credits",
          amount: seizure,
          reason: "seizure",
          description: "Assets seized in an enforcement action."
        });
        if (caseState.assignedOfficerIds.length) {
          population.employments = population.employments.map((employment) => detained.includes(employment.residentId) ? { ...employment, status: "absent", absenceDays: Math.max(1, employment.absenceDays + 3) } : employment);
        }
        status = evidence >= 88 ? "closed" : "charged";
        if (status === "closed") {
          law.convictions += detained.length;
          addTotals(dayTotals, { convictions: detained.length });
        }
      } else if (timestamp - caseState.openedAt > 28 * DAY_MS && evidence < 30) {
        status = "cold";
      }
      return { ...caseState, evidence, status, detainedResidentIds, seizedCredits, arrests, updatedAt: timestamp };
    }).slice(-MAX_CASES);

    districts = districts.map((law) => {
      const localCases = cases.filter((item) => item.districtId === law.districtId && item.status !== "closed" && item.status !== "cold");
      const localOperations = crimeNetworks.flatMap((item) => item.operations).filter((item) => item.districtId === law.districtId);
      const violent = clamp(mean(localOperations.filter((item) => item.kind === "extortion" || item.kind === "cargo-diversion").map((item) => item.heat), law.violentCrime) * 0.55 + law.violentCrime * 0.45);
      const property = clamp(mean(localOperations.filter((item) => item.kind === "cargo-diversion" || item.kind === "identity-fraud").map((item) => item.demand), law.propertyCrime) * 0.45 + law.propertyCrime * 0.55);
      const cyber = clamp(mean(localOperations.filter((item) => item.kind === "data-theft" || item.kind === "identity-fraud").map((item) => item.heat), law.cyberCrime) * 0.58 + law.cyberCrime * 0.42);
      const illegal = clamp(mean(localOperations.map((item) => item.capacity), law.illegalMarketShare) * 0.42 + law.illegalMarketShare * 0.58);
      return { ...law, violentCrime: violent, propertyCrime: property, cyberCrime: cyber, illegalMarketShare: illegal, unresolvedCases: localCases.length, detentionLoad: clamp(law.detentionLoad - 1), corruption: clamp(law.corruption - 0.25), publicTrust: clamp(law.publicTrust + (localCases.length < law.unresolvedCases ? 0.4 : -0.15)), lastUpdatedAt: timestamp };
    });

    if (dayIndex % 14 === 0) {
      const focusScores: Array<[GovernmentPolicyState["enforcementFocus"], number]> = [
        ["violent-crime", mean(districts.map((item) => item.violentCrime))],
        ["property-crime", mean(districts.map((item) => item.propertyCrime))],
        ["contraband", mean(districts.map((item) => item.illegalMarketShare))],
        ["corporate-compliance", licenses.filter((item) => item.status !== "active").length * 8],
        ["public-order", 100 - mean(districts.map((item) => item.publicTrust))]
      ];
      policy = { ...policy, enforcementFocus: focusScores.sort((left, right) => right[1] - left[1])[0][0] };
    }

    organizations = organizations.map((item) => item.id === authorityOrg.id ? { ...item, budget: Math.max(0, item.budget + budget.incomeToday - budget.spendingToday) } : item);
    addTotals(totals, dayTotals);
    history.push({
      dayIndex,
      treasury: budget.treasury,
      taxIncome: budget.taxIncome,
      publicSpending: budget.spendingToday,
      crimeRevenue: dayTotals.crimeRevenue,
      arrests: dayTotals.arrests,
      openCases: cases.filter((item) => item.status === "open" || item.status === "investigating" || item.status === "charged").length,
      suspendedLicenses: licenses.filter((item) => item.status === "suspended" || item.status === "revoked").length,
      averagePatrolCoverage: mean(districts.map((item) => item.patrolCoverage)),
      averageCorruption: mean(districts.map((item) => item.corruption))
    });
  }

  const nextState: GovernmentCrimeState = {
    version: 1,
    policy,
    budget,
    licenses,
    districts,
    crimeNetworks,
    cases,
    history: history.slice(-MAX_HISTORY),
    totals,
    dayIndex,
    simulatedDays: state.simulatedDays + Math.max(0, targetDay - state.dayIndex),
    lastUpdatedAt: input.timestamp
  };

  return {
    state: nextState,
    organizations,
    population,
    economy,
    infrastructure,
    production,
    notices: notices.slice(0, 14),
    transactions
  };
}
