import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { BusinessState } from "../../gameplay/economy/types";
import type { OrganizationState } from "../../world/state/types";
import type { BackgroundResident, HouseholdState, EmploymentRecord } from "../population/types";
import type { ProductionFacilityState } from "../production/types";
import type {
  CareLevel,
  ClinicalConditionState,
  ConditionKind,
  CyberwareInstallationState,
  CyberwareModelState,
  HealthAdvanceInput,
  HealthAdvanceResult,
  HealthCyberwareState,
  HealthCyberwareTotals,
  HealthFacilityState,
  HealthNotice,
  InsurancePlanKind,
  InsurancePolicyState,
  MedicalDebtState,
  PatientCaseState
} from "./types";

const DAY_MS = 24 * 60 * 60_000;
const HISTORY_LIMIT = 180;
const CASE_LIMIT = 500;
const CONDITION_LIMIT = 800;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyTotals(): HealthCyberwareTotals {
  return {
    conditionsCreated: 0,
    casesCreated: 0,
    casesTreated: 0,
    inpatientAdmissions: 0,
    procedures: 0,
    deathsLinkedToCareDelay: 0,
    insuranceClaimsPaid: 0,
    patientPayments: 0,
    debtCreated: 0,
    debtRepaid: 0,
    cyberwareInstalled: 0,
    cyberwareMaintained: 0,
    cyberwareFailures: 0,
    undergroundProcedures: 0,
    medicalUnitsConsumed: 0,
    partsUnitsConsumed: 0
  };
}

function addTotals(target: HealthCyberwareTotals, delta: Partial<HealthCyberwareTotals>): void {
  for (const [key, value] of Object.entries(delta) as Array<[keyof HealthCyberwareTotals, number | undefined]>) {
    if (typeof value === "number") target[key] += value;
  }
}

function careLevelFor(severity: number, kind: ConditionKind): CareLevel {
  if (kind === "implant-failure" || kind === "implant-rejection") return severity >= 70 ? "surgery" : "urgent";
  if (kind === "industrial-trauma") return severity >= 76 ? "surgery" : severity >= 52 ? "urgent" : "primary";
  if (severity >= 86) return "inpatient";
  if (severity >= 62) return "urgent";
  if (severity >= 34) return "primary";
  return "self-care";
}

function triageFor(condition: ClinicalConditionState): 1 | 2 | 3 | 4 | 5 {
  if (condition.careLevel === "surgery" || condition.severity >= 88) return 1;
  if (condition.careLevel === "inpatient" || condition.severity >= 72) return 2;
  if (condition.careLevel === "urgent" || condition.severity >= 56) return 3;
  if (condition.careLevel === "primary") return 4;
  return 5;
}

function conditionDefinition(kind: ConditionKind): { contagiousness: number; workRestriction: number; chronic: boolean; baseCost: number } {
  const definitions: Record<ConditionKind, { contagiousness: number; workRestriction: number; chronic: boolean; baseCost: number }> = {
    "respiratory-infection": { contagiousness: 46, workRestriction: 42, chronic: false, baseCost: 38 },
    "gastrointestinal-infection": { contagiousness: 38, workRestriction: 58, chronic: false, baseCost: 44 },
    "industrial-trauma": { contagiousness: 0, workRestriction: 78, chronic: false, baseCost: 160 },
    "repetitive-strain": { contagiousness: 0, workRestriction: 34, chronic: true, baseCost: 72 },
    "toxic-exposure": { contagiousness: 0, workRestriction: 66, chronic: false, baseCost: 120 },
    "chronic-respiratory": { contagiousness: 0, workRestriction: 32, chronic: true, baseCost: 86 },
    cardiovascular: { contagiousness: 0, workRestriction: 44, chronic: true, baseCost: 110 },
    "sleep-disorder": { contagiousness: 0, workRestriction: 22, chronic: true, baseCost: 54 },
    "trauma-disorder": { contagiousness: 0, workRestriction: 28, chronic: true, baseCost: 74 },
    "stimulant-dependence": { contagiousness: 0, workRestriction: 36, chronic: true, baseCost: 92 },
    "implant-rejection": { contagiousness: 0, workRestriction: 72, chronic: false, baseCost: 240 },
    "implant-failure": { contagiousness: 0, workRestriction: 84, chronic: false, baseCost: 310 }
  };
  return definitions[kind];
}

function condition(
  seed: string,
  residentId: string,
  dayIndex: number,
  kind: ConditionKind,
  severity: number,
  origin: ClinicalConditionState["origin"],
  sourceEntityId?: string
): ClinicalConditionState {
  const definition = conditionDefinition(kind);
  return {
    id: createStableEntityId("condition", `${seed}:${residentId}:${dayIndex}:${kind}:${sourceEntityId ?? "none"}`),
    residentId,
    kind,
    origin,
    stage: definition.chronic ? "chronic" : "acute",
    onsetDay: dayIndex,
    severity: clamp(severity),
    contagiousness: definition.contagiousness,
    workRestriction: definition.workRestriction,
    careLevel: careLevelFor(severity, kind),
    untreatedDays: 0,
    treatmentDays: 0,
    sourceEntityId
  };
}

function cyberwareCatalog(seed: string, organizations: OrganizationState[]): CyberwareModelState[] {
  const corporation = organizations.find((item) => item.type === "corporation") ?? organizations[0];
  const company = organizations.find((item) => item.type === "company") ?? corporation;
  const medical = organizations.find((item) => item.type === "medical") ?? corporation;
  const transport = organizations.find((item) => item.type === "transport") ?? company;
  const gang = organizations.find((item) => item.type === "gang") ?? company;
  if (!corporation || !company || !medical || !transport || !gang) return [];
  const rows: Array<Omit<CyberwareModelState, "id"> & { scope: string }> = [
    { scope: "lift-spine", name: "VECTRA LIFT-ASSIST SPINE R2", manufacturerOrganizationId: company.id, category: "industrial", licensed: true, quality: 72, basePrice: 1_850, installationMedicalUnits: 5, installationPartsUnits: 7, maintenanceIntervalDays: 120, expectedServiceDays: 1_900, baseFailureRisk: 0.0012, rejectionRisk: 0.018, minimumMedicalSkill: 56, workSkillBonus: 12 },
    { scope: "cardiac-regulator", name: "CMU CARDIAC REGULATOR C7", manufacturerOrganizationId: medical.id, category: "medical", licensed: true, quality: 88, basePrice: 3_400, installationMedicalUnits: 8, installationPartsUnits: 5, maintenanceIntervalDays: 180, expectedServiceDays: 2_800, baseFailureRisk: 0.0007, rejectionRisk: 0.012, minimumMedicalSkill: 70, workSkillBonus: 0 },
    { scope: "ocular-array", name: "AURELIAN OCULAR ARRAY A3", manufacturerOrganizationId: corporation.id, category: "sensory", licensed: true, quality: 84, basePrice: 2_600, installationMedicalUnits: 5, installationPartsUnits: 8, maintenanceIntervalDays: 150, expectedServiceDays: 2_200, baseFailureRisk: 0.0009, rejectionRisk: 0.014, minimumMedicalSkill: 64, workSkillBonus: 8 },
    { scope: "navlink", name: "MESHLINE NAVLINK N4", manufacturerOrganizationId: transport.id, category: "communications", licensed: true, quality: 69, basePrice: 1_150, installationMedicalUnits: 3, installationPartsUnits: 5, maintenanceIntervalDays: 100, expectedServiceDays: 1_500, baseFailureRisk: 0.0015, rejectionRisk: 0.009, minimumMedicalSkill: 48, workSkillBonus: 7 },
    { scope: "cortex-relay", name: "AURELIAN CORTEX RELAY AX", manufacturerOrganizationId: corporation.id, category: "neural", licensed: true, quality: 91, basePrice: 5_800, installationMedicalUnits: 9, installationPartsUnits: 11, maintenanceIntervalDays: 120, expectedServiceDays: 2_000, baseFailureRisk: 0.0008, rejectionRisk: 0.026, minimumMedicalSkill: 82, workSkillBonus: 14 },
    { scope: "gripdrive", name: "VECTRA GRIPDRIVE PAIR G5", manufacturerOrganizationId: company.id, category: "mobility", licensed: true, quality: 75, basePrice: 2_100, installationMedicalUnits: 6, installationPartsUnits: 8, maintenanceIntervalDays: 90, expectedServiceDays: 1_600, baseFailureRisk: 0.0018, rejectionRisk: 0.021, minimumMedicalSkill: 60, workSkillBonus: 10 },
    { scope: "dermal-seal", name: "CMU DERMAL SEAL D2", manufacturerOrganizationId: medical.id, category: "protective", licensed: true, quality: 79, basePrice: 1_700, installationMedicalUnits: 4, installationPartsUnits: 6, maintenanceIntervalDays: 160, expectedServiceDays: 2_300, baseFailureRisk: 0.0008, rejectionRisk: 0.011, minimumMedicalSkill: 58, workSkillBonus: 4 },
    { scope: "overclock", name: "CUTWIRE OVERCLOCK NODE", manufacturerOrganizationId: gang.id, category: "combat", licensed: false, quality: 43, basePrice: 900, installationMedicalUnits: 4, installationPartsUnits: 7, maintenanceIntervalDays: 45, expectedServiceDays: 620, baseFailureRisk: 0.0055, rejectionRisk: 0.061, minimumMedicalSkill: 44, workSkillBonus: 16 }
  ];
  return rows.map(({ scope, ...item }) => ({ id: createStableEntityId("cyberware-model", `${seed}:${scope}`), ...item }));
}

function facilityKindFor(name: string): HealthFacilityState["kind"] {
  if (name.includes("BACKROOM")) return "underground";
  if (name.includes("TRAUMA")) return "trauma-center";
  if (name.includes("HOSPITAL")) return "hospital";
  if (name.includes("OCCUPATIONAL")) return "occupational";
  return "walk-in";
}

function createFacilities(seed: string, dayIndex: number, input: Pick<HealthAdvanceInput, "locations" | "organizations" | "economy">): HealthFacilityState[] {
  const fallbackOwner = input.organizations[0]?.id ?? createStableEntityId("org", `${seed}:medical-fallback`);
  return input.locations.filter((item) => item.type === "clinic").map((location) => {
    const kind = facilityKindFor(location.name);
    const business = input.economy.businesses.find((item) => item.locationId === location.id);
    const scale = kind === "hospital" ? 4 : kind === "trauma-center" ? 2 : kind === "occupational" ? 2 : 1;
    return {
      id: createStableEntityId("health-facility", `${seed}:${location.id}`),
      locationId: location.id,
      districtId: location.districtId,
      ownerOrganizationId: location.organizationId ?? fallbackOwner,
      kind,
      licensed: kind !== "underground",
      bedCapacity: kind === "hospital" ? 42 : kind === "trauma-center" ? 16 : kind === "underground" ? 3 : 6,
      treatmentRooms: 3 * scale,
      surgicalRooms: kind === "hospital" ? 4 : kind === "trauma-center" ? 2 : kind === "underground" ? 1 : 0,
      staffing: business?.staffing ?? (kind === "hospital" ? 78 : 58),
      serviceLevel: 82,
      medicalStock: Math.max(20, business?.stock ?? 60),
      implantParts: kind === "hospital" ? 48 : kind === "occupational" ? 34 : kind === "underground" ? 24 : 16,
      maintenanceKits: kind === "hospital" ? 42 : kind === "occupational" ? 30 : 12,
      cash: business?.cash ?? 8_000,
      queueLength: 0,
      occupiedBeds: 0,
      status: "stable",
      lastUpdatedDay: dayIndex
    };
  });
}

function insuranceKind(household: HouseholdState, residents: BackgroundResident[], employments: EmploymentRecord[], organizations: OrganizationState[]): { kind: InsurancePlanKind; sponsor?: string } {
  const members = residents.filter((item) => item.householdId === household.id);
  const activeJobs = employments.filter((item) => item.status === "active" && members.some((member) => member.id === item.residentId));
  const sponsored = activeJobs.find((job) => {
    const org = organizations.find((item) => item.id === job.organizationId);
    return org && ["corporation", "government", "police", "medical", "transport"].includes(org.type);
  });
  if (sponsored?.organizationId) return { kind: "employer", sponsor: sponsored.organizationId };
  if (members.some((item) => item.lifeStage !== "working-age" || item.health === "disabled") || household.status === "displaced" || household.balance < 120) return { kind: "public-basic" };
  if (household.spendingMode === "comfortable" && household.balance > 900) return { kind: "private" };
  return { kind: "uninsured" };
}

function createPolicyForHousehold(
  seed: string,
  dayIndex: number,
  input: Pick<HealthAdvanceInput, "population" | "organizations" | "government">,
  household: HouseholdState
): InsurancePolicyState {
  const medical = input.organizations.find((item) => item.type === "medical") ?? input.organizations[0];
  const authority = input.government.budget.authorityOrganizationId;
  const selected = insuranceKind(household, input.population.residents, input.population.employments, input.organizations);
  const kind = selected.kind;
  return {
    id: createStableEntityId("insurance-policy", `${seed}:${household.id}`),
    householdId: household.id,
    kind,
    status: "active",
    insurerEntityId: kind === "public-basic" ? authority : medical?.id ?? authority,
    sponsorOrganizationId: selected.sponsor,
    premiumPerWeek: kind === "private" ? 42 : kind === "employer" ? 26 : kind === "public-basic" ? 18 : 0,
    deductible: kind === "private" ? 40 : kind === "employer" ? 28 : kind === "public-basic" ? 8 : 999_999,
    coveragePercent: kind === "private" ? 82 : kind === "employer" ? 74 : kind === "public-basic" ? 62 : 0,
    annualLimit: kind === "private" ? 8_500 : kind === "employer" ? 5_500 : kind === "public-basic" ? 2_600 : 0,
    usedThisYear: 0,
    lastPremiumDay: dayIndex
  };
}

function createPolicies(seed: string, dayIndex: number, input: Pick<HealthAdvanceInput, "population" | "organizations" | "government">): InsurancePolicyState[] {
  return input.population.households.map((household) => createPolicyForHousehold(seed, dayIndex, input, household));
}

function synchronizePolicies(
  seed: string,
  dayIndex: number,
  policies: InsurancePolicyState[],
  input: Pick<HealthAdvanceInput, "population" | "organizations" | "government">
): InsurancePolicyState[] {
  const previous = new Map(policies.map((policy) => [policy.householdId, policy]));
  return input.population.households.map((household) => {
    const desired = createPolicyForHousehold(seed, dayIndex, input, household);
    const existing = previous.get(household.id);
    if (!existing) return desired;
    const samePlan = existing.kind === desired.kind
      && existing.sponsorOrganizationId === desired.sponsorOrganizationId
      && existing.insurerEntityId === desired.insurerEntityId;
    if (!samePlan) return { ...desired, usedThisYear: 0, lastPremiumDay: dayIndex };
    return {
      ...desired,
      status: existing.status,
      usedThisYear: existing.usedThisYear,
      lastPremiumDay: existing.lastPremiumDay
    };
  });
}

export function createHealthCyberwareState(input: HealthAdvanceInput): HealthCyberwareState {
  const dayIndex = Math.floor(input.timestamp / DAY_MS);
  const conditions: ClinicalConditionState[] = [];
  for (const resident of input.population.residents) {
    const district = input.districts.find((item) => item.id === resident.districtId);
    const rng = new SeededRandom(`${input.seed}:initial-health:${resident.id}`);
    if (resident.age >= 58 && rng.chance(0.18)) conditions.push(condition(input.seed, resident.id, dayIndex - rng.integer(40, 900), "cardiovascular", rng.integer(28, 58), "pollution"));
    if ((district?.pollution ?? 0) > 64 && rng.chance(0.16)) conditions.push(condition(input.seed, resident.id, dayIndex - rng.integer(30, 720), "chronic-respiratory", rng.integer(24, 54), "pollution"));
    if (resident.healthScore < 55 && rng.chance(0.12)) conditions.push(condition(input.seed, resident.id, dayIndex - rng.integer(7, 180), "sleep-disorder", rng.integer(20, 46), "housing"));
  }
  return {
    version: 1,
    facilities: createFacilities(input.seed, dayIndex, input),
    conditions,
    cases: [],
    policies: createPolicies(input.seed, dayIndex, input),
    debts: [],
    cyberwareModels: cyberwareCatalog(input.seed, input.organizations),
    installations: [],
    history: [],
    totals: emptyTotals(),
    dayIndex,
    simulatedDays: 0,
    lastUpdatedAt: input.timestamp
  };
}

function normalizeFacility(fresh: HealthFacilityState, raw?: Partial<HealthFacilityState>): HealthFacilityState {
  return { ...fresh, ...raw, medicalStock: Math.max(0, raw?.medicalStock ?? fresh.medicalStock), implantParts: Math.max(0, raw?.implantParts ?? fresh.implantParts), maintenanceKits: Math.max(0, raw?.maintenanceKits ?? fresh.maintenanceKits) };
}

export function normalizeHealthCyberwareState(value: unknown, input: HealthAdvanceInput): HealthCyberwareState {
  const fresh = createHealthCyberwareState(input);
  if (!value || typeof value !== "object") return fresh;
  const raw = value as Partial<HealthCyberwareState>;
  if (raw.version !== 1 || !Array.isArray(raw.facilities) || !Array.isArray(raw.conditions)) return fresh;
  const facilities = fresh.facilities.map((facility) => normalizeFacility(facility, raw.facilities?.find((item) => item.locationId === facility.locationId)));
  return {
    ...fresh,
    ...raw,
    facilities,
    conditions: raw.conditions ?? fresh.conditions,
    cases: Array.isArray(raw.cases) ? raw.cases : [],
    policies: fresh.policies.map((policy) => ({ ...policy, ...raw.policies?.find((item) => item.householdId === policy.householdId) })),
    debts: Array.isArray(raw.debts) ? raw.debts : [],
    cyberwareModels: fresh.cyberwareModels,
    installations: Array.isArray(raw.installations) ? raw.installations : [],
    history: Array.isArray(raw.history) ? raw.history.slice(-HISTORY_LIMIT) : [],
    totals: { ...fresh.totals, ...(raw.totals ?? {}) },
    dayIndex: typeof raw.dayIndex === "number" ? raw.dayIndex : fresh.dayIndex,
    simulatedDays: typeof raw.simulatedDays === "number" ? raw.simulatedDays : 0,
    lastUpdatedAt: typeof raw.lastUpdatedAt === "number" ? raw.lastUpdatedAt : input.timestamp
  };
}

function serviceLevel(input: HealthAdvanceInput, locationId: string): number {
  const kinds = ["power", "water", "data", "transport", "waste"] as const;
  const levels = kinds.map((kind) => input.infrastructure.services.find((item) => item.locationId === locationId && item.kind === kind)?.serviceLevel ?? 100);
  return Math.round(levels.reduce((sum, value) => sum + value, 0) / levels.length);
}

function employmentRisk(employment: EmploymentRecord | undefined, input: HealthAdvanceInput): { injury: number; strain: number; toxic: number } {
  if (!employment || employment.status !== "active") return { injury: 0, strain: 0, toxic: 0 };
  const location = input.locations.find((item) => item.id === employment.locationId);
  if (!location) return { injury: 0, strain: 0, toxic: 0 };
  if (location.type === "workshop") return { injury: 0.006, strain: 0.004, toxic: 0.003 };
  if (location.type === "transport") return { injury: 0.003, strain: 0.004, toxic: 0.001 };
  if (location.type === "clinic") return { injury: 0.001, strain: 0.002, toxic: 0.0015 };
  if (location.type === "office" || location.type === "education") return { injury: 0.0003, strain: 0.0035, toxic: 0.0002 };
  return { injury: 0.001, strain: 0.0015, toxic: 0.0005 };
}

function createDailyConditions(
  dayIndex: number,
  seed: string,
  input: HealthAdvanceInput,
  residents: BackgroundResident[],
  households: HouseholdState[],
  employments: EmploymentRecord[],
  existing: ClinicalConditionState[]
): ClinicalConditionState[] {
  const created: ClinicalConditionState[] = [];
  const activeByResident = new Map<string, number>();
  for (const item of existing) if (item.stage !== "resolved") activeByResident.set(item.residentId, (activeByResident.get(item.residentId) ?? 0) + 1);
  for (const resident of residents) {
    if ((activeByResident.get(resident.id) ?? 0) >= 2) continue;
    const rng = new SeededRandom(`${seed}:health-incidence:${dayIndex}:${resident.id}`);
    const household = households.find((item) => item.id === resident.householdId);
    const district = input.districts.find((item) => item.id === resident.districtId);
    const employment = employments.find((item) => item.id === resident.employmentId && item.status !== "unemployed");
    const water = input.infrastructure.services.find((item) => item.locationId === resident.homeLocationId && item.kind === "water")?.serviceLevel ?? 70;
    const waste = input.infrastructure.services.find((item) => item.locationId === resident.homeLocationId && item.kind === "waste")?.serviceLevel ?? 70;
    const crowding = household ? Math.max(0, household.memberIds.length - 3) : 0;
    const foodDeficit = household?.lastLedger?.unmetFoodUnits ?? 0;
    const infectionRisk = 0.001 + (100 - water) / 25_000 + (100 - waste) / 28_000 + crowding / 6_000 + foodDeficit / 4_000;
    if (rng.chance(infectionRisk)) {
      const kind: ConditionKind = water < 48 || waste < 42 ? "gastrointestinal-infection" : "respiratory-infection";
      created.push(condition(seed, resident.id, dayIndex, kind, rng.integer(18, 48), "infection", resident.homeLocationId ?? undefined));
      continue;
    }
    const risk = employmentRisk(employment, input);
    if (rng.chance(risk.injury)) {
      created.push(condition(seed, resident.id, dayIndex, "industrial-trauma", rng.integer(26, 82), "workplace", employment?.locationId));
      continue;
    }
    if (rng.chance(risk.toxic + Math.max(0, (district?.pollution ?? 0) - 70) / 80_000)) {
      created.push(condition(seed, resident.id, dayIndex, "toxic-exposure", rng.integer(24, 68), employment ? "workplace" : "pollution", employment?.locationId));
      continue;
    }
    if (rng.chance(risk.strain)) {
      created.push(condition(seed, resident.id, dayIndex, "repetitive-strain", rng.integer(18, 46), "workplace", employment?.locationId));
      continue;
    }
    if (resident.age >= 48 && rng.chance(0.00035 + resident.age / 400_000)) {
      created.push(condition(seed, resident.id, dayIndex, "cardiovascular", rng.integer(22, 48), "pollution"));
      continue;
    }
    if ((district?.pollution ?? 0) >= 62 && rng.chance(0.00045 + (district?.pollution ?? 0) / 300_000)) {
      created.push(condition(seed, resident.id, dayIndex, "chronic-respiratory", rng.integer(18, 42), "pollution"));
      continue;
    }
    if ((household?.status === "arrears" || household?.status === "displaced") && rng.chance(0.0009)) {
      created.push(condition(seed, resident.id, dayIndex, "sleep-disorder", rng.integer(18, 38), "housing"));
      continue;
    }
    if (resident.lifeStage === "working-age" && household?.debt && household.debt > 500 && rng.chance(0.00045)) {
      created.push(condition(seed, resident.id, dayIndex, "stimulant-dependence", rng.integer(16, 36), "dependency"));
    }
  }
  return created;
}

function facilityForResident(resident: BackgroundResident, facilities: HealthFacilityState[], conditionState: ClinicalConditionState): HealthFacilityState | undefined {
  const local = facilities.filter((item) => item.districtId === resident.districtId && item.status !== "closed");
  const legal = local.filter((item) => item.licensed);
  if (conditionState.careLevel === "surgery" || conditionState.careLevel === "inpatient") return legal.find((item) => item.kind === "hospital" || item.kind === "trauma-center") ?? legal[0] ?? local[0];
  return legal.find((item) => item.kind === "walk-in" || item.kind === "occupational") ?? legal[0] ?? facilities.find((item) => item.licensed && item.status !== "closed") ?? local[0];
}

function syncFacility(facility: HealthFacilityState, dayIndex: number, input: HealthAdvanceInput, population: HealthAdvanceInput["population"], economy: HealthAdvanceInput["economy"]): HealthFacilityState {
  const jobs = population.employments.filter((item) => item.locationId === facility.locationId && item.status !== "unemployed");
  const active = jobs.filter((item) => item.status === "active").length;
  const business = economy.businesses.find((item) => item.locationId === facility.locationId);
  const staffing = jobs.length ? clamp(Math.round(active / Math.max(1, jobs.length) * 100)) : business?.staffing ?? facility.staffing;
  const services = serviceLevel(input, facility.locationId);
  const medicalStock = Math.max(0, facility.medicalStock);
  const status = services < 22 || staffing < 18 || medicalStock <= 1 ? "closed" : services < 45 || staffing < 36 || medicalStock < 12 ? "restricted" : services < 70 || staffing < 58 || medicalStock < 32 ? "strained" : "stable";
  return { ...facility, staffing, serviceLevel: services, medicalStock, cash: business?.cash ?? facility.cash, status, lastUpdatedDay: dayIndex };
}

function updateOrganizationBudget(organizations: OrganizationState[], organizationId: string | undefined, delta: number): OrganizationState[] {
  if (!organizationId || delta === 0) return organizations;
  return organizations.map((item) => item.id === organizationId ? { ...item, budget: Math.max(0, round(item.budget + delta)) } : item);
}

function inventoryAmount(facility: ProductionFacilityState, resource: "medical-units" | "parts-units"): number {
  return facility.inventory.find((item) => item.resource === resource)?.amount ?? 0;
}

function setInventory(facility: ProductionFacilityState, resource: "medical-units" | "parts-units", amount: number): ProductionFacilityState {
  return { ...facility, inventory: [...facility.inventory.filter((item) => item.resource !== resource), { resource, amount: Math.max(0, round(amount)) }] };
}

function procureImplantStock(
  dayIndex: number,
  seed: string,
  facility: HealthFacilityState,
  production: HealthAdvanceInput["production"],
  organizations: OrganizationState[],
  transactions: HealthAdvanceResult["transactions"]
): { facility: HealthFacilityState; production: HealthAdvanceInput["production"]; organizations: OrganizationState[] } {
  const source = facility.licensed
    ? production.facilities.find((item) => item.kind === "distribution-hub")
    : production.facilities.find((item) => item.kind === "black-market");
  if (!source) return { facility, production, organizations };

  let nextFacility = { ...facility };
  let nextSource = { ...source, inventory: source.inventory.map((item) => ({ ...item })) };
  let nextOrganizations = organizations;
  let sourceCash = source.cash;

  const buy = (resource: "medical-units" | "parts-units", requested: number, unitPrice: number, description: string): number => {
    const available = Math.floor(inventoryAmount(nextSource, resource));
    const units = Math.min(available, requested);
    if (units <= 0) return 0;
    const buyer = nextOrganizations.find((item) => item.id === facility.ownerOrganizationId);
    const affordable = Math.min(units, Math.floor((buyer?.budget ?? 0) / unitPrice));
    if (affordable <= 0) return 0;
    const price = affordable * unitPrice;
    nextSource = setInventory(nextSource, resource, available - affordable);
    sourceCash += price;
    nextOrganizations = updateOrganizationBudget(nextOrganizations, facility.ownerOrganizationId, -price);
    nextOrganizations = updateOrganizationBudget(nextOrganizations, source.ownerEntityId, price);
    transactions.push({
      idempotencyKey: `${seed}:health-procurement:${dayIndex}:${facility.id}:${source.id}:${resource}:${affordable}`,
      timestamp: dayIndex * DAY_MS,
      debitEntityId: facility.ownerOrganizationId,
      creditEntityId: source.ownerEntityId,
      resource: "credits",
      amount: price,
      reason: "medical-procurement",
      description
    }, {
      idempotencyKey: `${seed}:health-stock-transfer:${dayIndex}:${facility.id}:${source.id}:${resource}:${affordable}`,
      timestamp: dayIndex * DAY_MS,
      debitEntityId: source.id,
      creditEntityId: facility.id,
      resource,
      amount: affordable,
      reason: "inventory-transfer",
      description: `Physical ${resource} delivered to clinical storage.`
    });
    return affordable;
  };

  if (nextFacility.medicalStock < 28) {
    const medicalUnits = buy("medical-units", Math.max(18, 52 - Math.floor(nextFacility.medicalStock)), facility.licensed ? 16 : 27, `${facility.id} procured sterile drugs and clinical consumables.`);
    nextFacility.medicalStock += medicalUnits;
  }
  if (nextFacility.implantParts < 16 || nextFacility.maintenanceKits < 12) {
    const partUnits = buy("parts-units", nextFacility.implantParts < 16 ? 20 : 10, facility.licensed ? 24 : 38, `${facility.id} procured implant and maintenance components.`);
    nextFacility.implantParts += Math.ceil(partUnits * 0.65);
    nextFacility.maintenanceKits += Math.floor(partUnits * 0.35);
  }

  const nextProduction = {
    ...production,
    facilities: production.facilities.map((item) => item.id === source.id ? { ...nextSource, cash: sourceCash } : item)
  };
  return { facility: nextFacility, production: nextProduction, organizations: nextOrganizations };
}

function createCase(seed: string, dayIndex: number, resident: BackgroundResident, conditionState: ClinicalConditionState, facility: HealthFacilityState): PatientCaseState {
  const definition = conditionDefinition(conditionState.kind);
  const multiplier = conditionState.careLevel === "surgery" ? 3.8 : conditionState.careLevel === "inpatient" ? 2.6 : conditionState.careLevel === "urgent" ? 1.7 : 1;
  return {
    id: createStableEntityId("patient-case", `${seed}:${resident.id}:${conditionState.id}`),
    residentId: resident.id,
    conditionIds: [conditionState.id],
    facilityId: facility.id,
    triageLevel: triageFor(conditionState),
    status: "waiting",
    requestedDay: dayIndex,
    waitingDays: 0,
    estimatedCost: Math.round((definition.baseCost + conditionState.severity * 1.6) * multiplier),
    insurerPaid: 0,
    patientPaid: 0,
    debtCreated: 0
  };
}

function settleMedicalBill(
  seed: string,
  dayIndex: number,
  bill: number,
  household: HouseholdState,
  policy: InsurancePolicyState | undefined,
  provider: HealthFacilityState,
  organizations: OrganizationState[],
  government: HealthAdvanceInput["government"],
  debts: MedicalDebtState[],
  transactions: HealthAdvanceResult["transactions"]
): { household: HouseholdState; policy?: InsurancePolicyState; organizations: OrganizationState[]; government: HealthAdvanceInput["government"]; debts: MedicalDebtState[]; insurerPaid: number; patientPaid: number; debtCreated: number } {
  let insurerPaid = 0;
  let patientPaid = 0;
  let remaining = bill;
  let nextOrganizations = organizations;
  let nextGovernment = government;
  let nextPolicy = policy;
  if (policy && policy.status === "active" && policy.coveragePercent > 0 && policy.usedThisYear < policy.annualLimit) {
    const eligible = Math.max(0, bill - policy.deductible);
    const claim = Math.min(eligible * policy.coveragePercent / 100, policy.annualLimit - policy.usedThisYear);
    if (claim > 0) {
      if (policy.kind === "public-basic") {
        insurerPaid = Math.min(claim, nextGovernment.budget.treasury);
        nextGovernment = { ...nextGovernment, budget: { ...nextGovernment.budget, treasury: nextGovernment.budget.treasury - insurerPaid, medicalGrants: nextGovernment.budget.medicalGrants + insurerPaid, spendingToday: nextGovernment.budget.spendingToday + insurerPaid } };
      } else {
        const payerId = policy.sponsorOrganizationId ?? policy.insurerEntityId;
        const payer = nextOrganizations.find((item) => item.id === payerId);
        insurerPaid = Math.min(claim, payer?.budget ?? 0);
        nextOrganizations = updateOrganizationBudget(nextOrganizations, payerId, -insurerPaid);
      }
      nextOrganizations = updateOrganizationBudget(nextOrganizations, provider.ownerOrganizationId, insurerPaid);
      remaining -= insurerPaid;
      nextPolicy = { ...policy, usedThisYear: policy.usedThisYear + insurerPaid, status: policy.usedThisYear + insurerPaid >= policy.annualLimit ? "exhausted" : policy.status };
      transactions.push({ idempotencyKey: `${seed}:insurance-claim:${dayIndex}:${household.id}:${provider.id}:${bill}`, timestamp: dayIndex * DAY_MS, debitEntityId: policy.sponsorOrganizationId ?? policy.insurerEntityId, creditEntityId: provider.ownerOrganizationId, resource: "credits", amount: insurerPaid, reason: "insurance-claim", description: `Insurance claim for clinical care.` });
    }
  }
  // A household does not liquidate every last credit for a medical bill. Food, rent and
  // transport remain immediate survival expenses; the uncovered remainder becomes debt.
  const subsistenceReserve = Math.max(90, household.memberIds.length * 55 + Math.round(household.rentPerWeek * 0.3));
  patientPaid = Math.min(remaining, Math.max(0, household.balance - subsistenceReserve));
  let nextHousehold = { ...household, balance: household.balance - patientPaid };
  if (patientPaid > 0) {
    nextOrganizations = updateOrganizationBudget(nextOrganizations, provider.ownerOrganizationId, patientPaid);
    transactions.push({ idempotencyKey: `${seed}:patient-payment:${dayIndex}:${household.id}:${provider.id}:${bill}`, timestamp: dayIndex * DAY_MS, debitEntityId: household.id, creditEntityId: provider.ownerOrganizationId, resource: "credits", amount: patientPaid, reason: "medical-service", description: `Household payment for clinical care.` });
  }
  remaining -= patientPaid;
  let debtCreated = 0;
  let nextDebts = debts;
  if (remaining > 0.5) {
    debtCreated = round(remaining);
    const existing = debts.find((item) => item.householdId === household.id && item.providerEntityId === provider.ownerOrganizationId && item.status !== "paid" && item.status !== "written-off");
    if (existing) nextDebts = debts.map((item) => item.id === existing.id ? { ...item, principal: round(item.principal + debtCreated), status: "current" } : item);
    else nextDebts = [...debts, { id: createStableEntityId("medical-debt", `${seed}:${household.id}:${provider.ownerOrganizationId}:${dayIndex}`), householdId: household.id, providerEntityId: provider.ownerOrganizationId, principal: debtCreated, weeklyInterestRate: provider.licensed ? 0.003 : 0.012, status: "current", createdDay: dayIndex, lastPaymentDay: dayIndex }];
    nextHousehold = { ...nextHousehold, debt: nextHousehold.debt + debtCreated };
    transactions.push({ idempotencyKey: `${seed}:medical-debt:${dayIndex}:${household.id}:${provider.id}:${debtCreated}`, timestamp: dayIndex * DAY_MS, debitEntityId: household.id, creditEntityId: provider.ownerOrganizationId, resource: "credits", amount: debtCreated, reason: "medical-debt", description: `Unpaid clinical balance converted to medical debt.` });
  }
  return { household: nextHousehold, policy: nextPolicy, organizations: nextOrganizations, government: nextGovernment, debts: nextDebts, insurerPaid, patientPaid, debtCreated };
}

function treatmentSupply(conditionState: ClinicalConditionState): number {
  if (conditionState.careLevel === "surgery") return 9;
  if (conditionState.careLevel === "inpatient") return 6;
  if (conditionState.careLevel === "urgent") return 4;
  if (conditionState.careLevel === "primary") return 2;
  return 1;
}

function processCases(
  dayIndex: number,
  seed: string,
  facilities: HealthFacilityState[],
  cases: PatientCaseState[],
  conditions: ClinicalConditionState[],
  residents: BackgroundResident[],
  households: HouseholdState[],
  policies: InsurancePolicyState[],
  organizations: OrganizationState[],
  government: HealthAdvanceInput["government"],
  economy: HealthAdvanceInput["economy"],
  debts: MedicalDebtState[],
  transactions: HealthAdvanceResult["transactions"],
  totals: HealthCyberwareTotals
): { facilities: HealthFacilityState[]; cases: PatientCaseState[]; conditions: ClinicalConditionState[]; households: HouseholdState[]; policies: InsurancePolicyState[]; organizations: OrganizationState[]; government: HealthAdvanceInput["government"]; economy: HealthAdvanceInput["economy"]; debts: MedicalDebtState[]; treatedToday: number } {
  let nextFacilities = facilities.map((item) => ({ ...item, queueLength: 0, occupiedBeds: 0 }));
  let nextCases = cases.map((item) => ({ ...item, waitingDays: item.status === "waiting" ? item.waitingDays + 1 : item.waitingDays }));
  let nextConditions = conditions;
  let nextHouseholds = households;
  let nextPolicies = policies;
  let nextOrganizations = organizations;
  let nextGovernment = government;
  let nextEconomy = economy;
  let nextDebts = debts;
  let treatedToday = 0;
  for (const facility of nextFacilities) {
    const waiting = nextCases.filter((item) => item.facilityId === facility.id && item.status === "waiting").sort((a, b) => a.triageLevel - b.triageLevel || b.waitingDays - a.waitingDays || a.requestedDay - b.requestedDay);
    const slots = Math.max(0, Math.floor(facility.treatmentRooms * 2 * facility.staffing / 100 * facility.serviceLevel / 100));
    let stock = facility.medicalStock;
    let beds = 0;
    let treated = 0;
    for (const caseState of waiting) {
      if (treated >= slots || stock <= 0) break;
      const conditionState = nextConditions.find((item) => caseState.conditionIds.includes(item.id) && item.stage !== "resolved");
      const resident = residents.find((item) => item.id === caseState.residentId);
      const household = resident ? nextHouseholds.find((item) => item.id === resident.householdId) : undefined;
      if (!conditionState || !resident || !household) continue;
      const supply = treatmentSupply(conditionState);
      if (stock < supply) continue;
      const needsBed = conditionState.careLevel === "inpatient" || conditionState.careLevel === "surgery";
      if (needsBed && beds >= facility.bedCapacity) continue;
      stock -= supply;
      if (needsBed) beds += 1;
      treated += 1;
      treatedToday += 1;
      const policy = nextPolicies.find((item) => item.householdId === household.id);
      const settlement = settleMedicalBill(seed, dayIndex, caseState.estimatedCost, household, policy, facility, nextOrganizations, nextGovernment, nextDebts, transactions);
      nextHouseholds = nextHouseholds.map((item) => item.id === household.id ? { ...settlement.household, lastLedger: settlement.household.lastLedger ? { ...settlement.household.lastLedger, medicalSpent: settlement.household.lastLedger.medicalSpent + settlement.patientPaid } : settlement.household.lastLedger } : item);
      if (settlement.policy) nextPolicies = nextPolicies.map((item) => item.id === settlement.policy?.id ? settlement.policy : item);
      nextOrganizations = settlement.organizations;
      nextGovernment = settlement.government;
      nextDebts = settlement.debts;
      const improvement = conditionState.careLevel === "surgery" ? 42 : conditionState.careLevel === "inpatient" ? 30 : conditionState.careLevel === "urgent" ? 22 : 14;
      const nextSeverity = clamp(conditionState.severity - improvement - Math.round(facility.serviceLevel / 18));
      nextConditions = nextConditions.map((item) => item.id === conditionState.id ? { ...item, severity: nextSeverity, stage: nextSeverity <= 8 ? "resolved" : "recovering", treatmentDays: item.treatmentDays + 1, lastTreatedDay: dayIndex, resolvedDay: nextSeverity <= 8 ? dayIndex : undefined, careLevel: careLevelFor(nextSeverity, item.kind) } : item);
      nextCases = nextCases.map((item) => item.id === caseState.id ? { ...item, status: nextSeverity <= 8 ? "discharged" : "treated", admittedDay: dayIndex, dischargedDay: nextSeverity <= 8 ? dayIndex : undefined, insurerPaid: settlement.insurerPaid, patientPaid: settlement.patientPaid, debtCreated: settlement.debtCreated } : item);
      addTotals(totals, { casesTreated: 1, inpatientAdmissions: needsBed ? 1 : 0, procedures: conditionState.careLevel === "surgery" ? 1 : 0, insuranceClaimsPaid: settlement.insurerPaid, patientPayments: settlement.patientPaid, debtCreated: settlement.debtCreated, medicalUnitsConsumed: supply, undergroundProcedures: facility.licensed ? 0 : 1 });
    }
    const waitingCount = nextCases.filter((item) => item.facilityId === facility.id && item.status === "waiting").length;
    nextFacilities = nextFacilities.map((item) => item.id === facility.id ? { ...item, medicalStock: stock, queueLength: waitingCount, occupiedBeds: beds, cash: item.cash + nextCases.filter((entry) => entry.facilityId === facility.id && entry.admittedDay === dayIndex).reduce((sum, entry) => sum + entry.insurerPaid + entry.patientPaid, 0) } : item);
    const business = nextEconomy.businesses.find((item) => item.locationId === facility.locationId);
    if (business) nextEconomy = { ...nextEconomy, businesses: nextEconomy.businesses.map((item) => item.id === business.id ? { ...item, stock: stock, cash: Math.max(0, item.cash + treated * 8), demand: clamp(item.demand + waitingCount / 4), shortage: stock < 32 } : item) };
  }
  return { facilities: nextFacilities, cases: nextCases, conditions: nextConditions, households: nextHouseholds, policies: nextPolicies, organizations: nextOrganizations, government: nextGovernment, economy: nextEconomy, debts: nextDebts, treatedToday };
}

function progressConditions(dayIndex: number, conditions: ClinicalConditionState[]): ClinicalConditionState[] {
  return conditions.map((item) => {
    if (item.stage === "resolved") return item;
    const treatedYesterday = item.lastTreatedDay !== undefined && dayIndex - item.lastTreatedDay <= 1;
    const chronic = conditionDefinition(item.kind).chronic;
    const untreatedDays = treatedYesterday ? Math.max(0, item.untreatedDays - 1) : item.untreatedDays + 1;
    let severity = item.severity;
    if (treatedYesterday) severity -= chronic ? 1.5 : 5;
    else if (item.stage === "recovering") severity -= chronic ? 0.3 : 1.8;
    else severity += chronic ? 0.22 : 1.2 + Math.min(2.5, untreatedDays * 0.12);
    severity = clamp(severity);
    const resolved = severity <= 6 && !chronic;
    return { ...item, severity, untreatedDays, stage: resolved ? "resolved" : item.stage === "recovering" && severity > 24 ? "acute" : item.stage, resolvedDay: resolved ? dayIndex : item.resolvedDay, careLevel: careLevelFor(severity, item.kind) };
  });
}

function updateResidentHealth(residents: BackgroundResident[], employments: EmploymentRecord[], conditions: ClinicalConditionState[]): { residents: BackgroundResident[]; employments: EmploymentRecord[] } {
  const active = conditions.filter((item) => item.stage !== "resolved");
  const nextResidents = residents.map((resident) => {
    const own = active.filter((item) => item.residentId === resident.id);
    const burden = own.reduce((sum, item) => sum + item.severity * (conditionDefinition(item.kind).chronic ? 0.32 : 0.48), 0);
    const healthScore = clamp(92 - burden, 4, 100);
    return { ...resident, healthScore, health: healthScore <= 25 ? "disabled" as const : healthScore <= 48 ? "ill" as const : healthScore <= 68 ? "strained" as const : "healthy" as const };
  });
  const nextEmployments = employments.map((employment) => {
    if (employment.status === "unemployed") return employment;
    const restriction = active.filter((item) => item.residentId === employment.residentId).reduce((max, item) => Math.max(max, item.workRestriction * item.severity / 100), 0);
    if (restriction >= 30) return { ...employment, status: "absent" as const, absenceDays: employment.absenceDays + 1 };
    if (employment.status === "absent" && restriction < 15) return { ...employment, status: "active" as const, absenceDays: 0 };
    return employment;
  });
  return { residents: nextResidents, employments: nextEmployments };
}

function weeklyPremiums(
  dayIndex: number,
  seed: string,
  policies: InsurancePolicyState[],
  households: HouseholdState[],
  organizations: OrganizationState[],
  government: HealthAdvanceInput["government"],
  transactions: HealthAdvanceResult["transactions"]
): { policies: InsurancePolicyState[]; households: HouseholdState[]; organizations: OrganizationState[]; government: HealthAdvanceInput["government"] } {
  if (dayIndex % 7 !== 0) return { policies, households, organizations, government };
  let nextHouseholds = households;
  let nextOrganizations = organizations;
  let nextGovernment = government;
  const nextPolicies = policies.map((sourcePolicy) => {
    const policy = dayIndex % 365 === 0 ? { ...sourcePolicy, usedThisYear: 0, status: sourcePolicy.kind === "uninsured" ? "active" as const : sourcePolicy.status } : sourcePolicy;
    if (policy.kind === "uninsured" || policy.premiumPerWeek <= 0) return { ...policy, lastPremiumDay: dayIndex };
    if (policy.kind === "public-basic") {
      const paid = Math.min(policy.premiumPerWeek, nextGovernment.budget.treasury);
      nextGovernment = { ...nextGovernment, budget: { ...nextGovernment.budget, treasury: nextGovernment.budget.treasury - paid, medicalGrants: nextGovernment.budget.medicalGrants + paid, spendingToday: nextGovernment.budget.spendingToday + paid } };
      nextOrganizations = updateOrganizationBudget(nextOrganizations, policy.insurerEntityId, paid);
      transactions.push({ idempotencyKey: `${seed}:public-premium:${dayIndex}:${policy.id}`, timestamp: dayIndex * DAY_MS, debitEntityId: nextGovernment.budget.authorityOrganizationId, creditEntityId: policy.insurerEntityId, resource: "credits", amount: paid, reason: "insurance-premium", contractId: policy.id, description: `Public medical coverage contribution.` });
      return { ...policy, status: paid >= policy.premiumPerWeek ? "active" as const : "lapsed" as const, lastPremiumDay: dayIndex };
    }
    if (policy.kind === "employer" && policy.sponsorOrganizationId) {
      const sponsor = nextOrganizations.find((item) => item.id === policy.sponsorOrganizationId);
      const paid = Math.min(policy.premiumPerWeek, sponsor?.budget ?? 0);
      nextOrganizations = updateOrganizationBudget(nextOrganizations, policy.sponsorOrganizationId, -paid);
      nextOrganizations = updateOrganizationBudget(nextOrganizations, policy.insurerEntityId, paid);
      if (paid > 0) transactions.push({ idempotencyKey: `${seed}:employer-premium:${dayIndex}:${policy.id}`, timestamp: dayIndex * DAY_MS, debitEntityId: policy.sponsorOrganizationId, creditEntityId: policy.insurerEntityId, resource: "credits", amount: paid, reason: "insurance-premium", contractId: policy.id, description: `Employer medical coverage premium.` });
      return { ...policy, status: paid >= policy.premiumPerWeek ? "active" as const : "lapsed" as const, lastPremiumDay: dayIndex };
    }
    const household = nextHouseholds.find((item) => item.id === policy.householdId);
    const paid = Math.min(policy.premiumPerWeek, household?.balance ?? 0);
    nextHouseholds = nextHouseholds.map((item) => item.id === policy.householdId ? { ...item, balance: item.balance - paid } : item);
    nextOrganizations = updateOrganizationBudget(nextOrganizations, policy.insurerEntityId, paid);
    if (paid > 0) transactions.push({ idempotencyKey: `${seed}:private-premium:${dayIndex}:${policy.id}`, timestamp: dayIndex * DAY_MS, debitEntityId: policy.householdId, creditEntityId: policy.insurerEntityId, resource: "credits", amount: paid, reason: "insurance-premium", contractId: policy.id, description: `Private medical coverage premium.` });
    return { ...policy, status: paid >= policy.premiumPerWeek ? "active" as const : "lapsed" as const, lastPremiumDay: dayIndex };
  });
  return { policies: nextPolicies, households: nextHouseholds, organizations: nextOrganizations, government: nextGovernment };
}

function serviceCyberware(
  dayIndex: number,
  seed: string,
  installations: CyberwareInstallationState[],
  models: CyberwareModelState[],
  facilities: HealthFacilityState[],
  conditions: ClinicalConditionState[],
  residents: BackgroundResident[],
  transactions: HealthAdvanceResult["transactions"],
  totals: HealthCyberwareTotals
): { installations: CyberwareInstallationState[]; facilities: HealthFacilityState[]; conditions: ClinicalConditionState[] } {
  let nextFacilities = facilities;
  let nextConditions = conditions;
  const nextInstallations = installations.flatMap((installation) => {
    if (installation.status === "removed") return [installation];
    const model = models.find((item) => item.id === installation.modelId);
    const resident = residents.find((item) => item.id === installation.residentId);
    if (!model || !resident) return [];
    const overdue = Math.max(0, dayIndex - installation.maintenanceDueDay);
    const provider = nextFacilities.find((item) => item.id === installation.providerFacilityId)
      ?? nextFacilities.find((item) => item.maintenanceKits > 0 && item.staffing >= 20 && item.serviceLevel >= 40);
    const canService = Boolean(provider && provider.maintenanceKits > 0 && provider.staffing >= 20 && provider.serviceLevel >= 40);

    // Failed hardware remains failed until a real repair consumes parts and technician capacity.
    // It does not generate a new independent failure every day.
    if (installation.status === "failed") {
      if (dayIndex >= installation.maintenanceDueDay && canService && provider) {
        const requiredKits = provider.implantParts >= 1 ? 1 : 0;
        if (requiredKits) {
          nextFacilities = nextFacilities.map((item) => item.id === provider.id
            ? { ...item, maintenanceKits: item.maintenanceKits - 1, implantParts: item.implantParts - 1 }
            : item);
          addTotals(totals, { cyberwareMaintained: 1, partsUnitsConsumed: 2 });
          transactions.push({
            idempotencyKey: `${seed}:cyberware-repair:${dayIndex}:${installation.id}`,
            timestamp: dayIndex * DAY_MS,
            debitEntityId: provider.id,
            creditEntityId: installation.residentId,
            resource: "parts-units",
            amount: 2,
            reason: "cyberware-maintenance",
            assetId: installation.id,
            description: `${model.name} failure repaired with replacement components.`
          });
          return [{ ...installation, condition: 58, status: "active" as const, lastMaintenanceDay: dayIndex, maintenanceDueDay: dayIndex + model.maintenanceIntervalDays }];
        }
      }
      return [{ ...installation, condition: Math.max(0, installation.condition - 0.01) }];
    }

    let conditionValue = installation.condition - (0.012 + overdue * 0.006) * (100 / Math.max(30, model.quality));
    let lastMaintenanceDay = installation.lastMaintenanceDay;
    let maintenanceDueDay = installation.maintenanceDueDay;
    let status = installation.status;
    if (dayIndex >= installation.maintenanceDueDay && canService && provider) {
      nextFacilities = nextFacilities.map((item) => item.id === provider.id ? { ...item, maintenanceKits: item.maintenanceKits - 1 } : item);
      conditionValue = Math.min(100, conditionValue + 24);
      lastMaintenanceDay = dayIndex;
      maintenanceDueDay = dayIndex + model.maintenanceIntervalDays;
      status = "active";
      addTotals(totals, { cyberwareMaintained: 1, partsUnitsConsumed: 1 });
      transactions.push({
        idempotencyKey: `${seed}:cyberware-maintenance:${dayIndex}:${installation.id}`,
        timestamp: dayIndex * DAY_MS,
        debitEntityId: provider.id,
        creditEntityId: installation.residentId,
        resource: "parts-units",
        amount: 1,
        reason: "cyberware-maintenance",
        assetId: installation.id,
        description: `${model.name} maintenance kit consumed.`
      });
    }
    const rng = new SeededRandom(`${seed}:cyberware-failure:${dayIndex}:${installation.id}`);
    const failureRisk = model.baseFailureRisk * (1 + Math.max(0, 55 - conditionValue) / 18 + overdue / 120) * (installation.licensedSerial ? 1 : 2.1);
    if (rng.chance(failureRisk)) {
      const severity = rng.integer(42, 88);
      if (!nextConditions.some((item) => item.residentId === resident.id && item.kind === "implant-failure" && item.stage !== "resolved")) {
        nextConditions = [...nextConditions, condition(seed, resident.id, dayIndex, "implant-failure", severity, "cyberware", installation.id)];
      }
      addTotals(totals, { cyberwareFailures: 1 });
      return [{ ...installation, condition: clamp(conditionValue - rng.integer(18, 42)), status: "failed" as const, failures: installation.failures + 1, lastMaintenanceDay, maintenanceDueDay: Math.min(maintenanceDueDay, dayIndex + 7) }];
    }
    return [{ ...installation, condition: clamp(conditionValue), status: conditionValue < 30 ? "degraded" as const : status, lastMaintenanceDay, maintenanceDueDay }];
  });
  return { installations: nextInstallations, facilities: nextFacilities, conditions: nextConditions };
}

function modelForResident(resident: BackgroundResident, employment: EmploymentRecord | undefined, models: CyberwareModelState[], conditions: ClinicalConditionState[]): CyberwareModelState | undefined {
  const ownConditions = conditions.filter((item) => item.residentId === resident.id && item.stage !== "resolved");
  if (ownConditions.some((item) => item.kind === "cardiovascular" && item.severity >= 58)) return models.find((item) => item.category === "medical");
  if (resident.health === "disabled" && ownConditions.some((item) => item.kind === "industrial-trauma" || item.kind === "repetitive-strain")) return models.find((item) => item.category === "mobility");
  if (!employment || employment.status !== "active") return undefined;
  if (employment.skillDomain === "technical") return models.find((item) => item.category === "industrial");
  if (employment.skillDomain === "logistics") return models.find((item) => item.category === "communications");
  if (employment.skillDomain === "administration" && resident.skillLevel > 70) return models.find((item) => item.category === "neural");
  if (employment.skillDomain === "security") return models.find((item) => item.category === "protective");
  return undefined;
}

function installCyberware(
  dayIndex: number,
  seed: string,
  models: CyberwareModelState[],
  installations: CyberwareInstallationState[],
  facilities: HealthFacilityState[],
  conditions: ClinicalConditionState[],
  residents: BackgroundResident[],
  households: HouseholdState[],
  employments: EmploymentRecord[],
  organizations: OrganizationState[],
  debts: MedicalDebtState[],
  transactions: HealthAdvanceResult["transactions"],
  totals: HealthCyberwareTotals
): { installations: CyberwareInstallationState[]; facilities: HealthFacilityState[]; conditions: ClinicalConditionState[]; households: HouseholdState[]; organizations: OrganizationState[]; debts: MedicalDebtState[] } {
  if (dayIndex % 7 !== 0) return { installations, facilities, conditions, households, organizations, debts };
  let nextInstallations = installations;
  let nextFacilities = facilities;
  let nextConditions = conditions;
  let nextHouseholds = households;
  let nextOrganizations = organizations;
  let nextDebts = debts;
  let installedThisWeek = 0;
  for (const resident of residents) {
    if (installedThisWeek >= 3 || nextInstallations.some((item) => item.residentId === resident.id && item.status !== "removed")) continue;
    const employment = employments.find((item) => item.id === resident.employmentId && item.status === "active");
    const model = modelForResident(resident, employment, models, nextConditions);
    if (!model) continue;
    const rng = new SeededRandom(`${seed}:cyberware-demand:${dayIndex}:${resident.id}:${model.id}`);
    const medicalNeed = model.category === "medical" || model.category === "mobility";
    const chance = medicalNeed ? 0.18 : Math.max(0.005, (resident.skillLevel - 45) / 900);
    if (!rng.chance(chance)) continue;
    const facility = nextFacilities.find((item) => item.licensed === model.licensed && item.status !== "closed" && item.implantParts >= model.installationPartsUnits && item.medicalStock >= model.installationMedicalUnits && (item.surgicalRooms > 0 || model.installationPartsUnits <= 6));
    if (!facility) continue;
    const household = nextHouseholds.find((item) => item.id === resident.householdId);
    if (!household) continue;
    const employer = employment?.organizationId ? nextOrganizations.find((item) => item.id === employment.organizationId) : undefined;
    let financedBy: CyberwareInstallationState["financedBy"] = "medical-debt";
    let cashPaid = 0;
    if (medicalNeed && household.balance >= model.basePrice * 0.2) {
      financedBy = "insurance";
      cashPaid = Math.round(model.basePrice * 0.2);
    } else if (employer && model.workSkillBonus > 0 && employer.budget > model.basePrice * 2) {
      financedBy = "employer";
      nextOrganizations = updateOrganizationBudget(nextOrganizations, employer.id, -model.basePrice);
      nextOrganizations = updateOrganizationBudget(nextOrganizations, facility.ownerOrganizationId, model.basePrice);
      transactions.push({ idempotencyKey: `${seed}:employer-cyberware:${dayIndex}:${resident.id}:${model.id}`, timestamp: dayIndex * DAY_MS, debitEntityId: employer.id, creditEntityId: facility.ownerOrganizationId, resource: "credits", amount: model.basePrice, reason: "cyberware-installation", description: `Employer financed ${model.name}.` });
    } else if (household.balance >= model.basePrice) {
      financedBy = "cash";
      cashPaid = model.basePrice;
    } else if (!model.licensed) financedBy = "criminal-credit";
    if (cashPaid > 0) {
      nextHouseholds = nextHouseholds.map((item) => item.id === household.id ? { ...item, balance: item.balance - cashPaid } : item);
      nextOrganizations = updateOrganizationBudget(nextOrganizations, facility.ownerOrganizationId, cashPaid);
      transactions.push({ idempotencyKey: `${seed}:cash-cyberware:${dayIndex}:${resident.id}:${model.id}`, timestamp: dayIndex * DAY_MS, debitEntityId: household.id, creditEntityId: facility.ownerOrganizationId, resource: "credits", amount: cashPaid, reason: "cyberware-installation", description: `Household payment for ${model.name}.` });
    }
    let debtId: string | undefined;
    const unpaid = Math.max(0, model.basePrice - cashPaid - (financedBy === "employer" ? model.basePrice : 0));
    if (unpaid > 0) {
      debtId = createStableEntityId("medical-debt", `${seed}:cyberware:${resident.id}:${model.id}:${dayIndex}`);
      nextDebts = [...nextDebts, { id: debtId, householdId: household.id, providerEntityId: facility.ownerOrganizationId, principal: unpaid, weeklyInterestRate: model.licensed ? 0.004 : 0.016, status: "current", createdDay: dayIndex, lastPaymentDay: dayIndex }];
      nextHouseholds = nextHouseholds.map((item) => item.id === household.id ? { ...item, debt: item.debt + unpaid } : item);
      addTotals(totals, { debtCreated: unpaid });
    }
    nextFacilities = nextFacilities.map((item) => item.id === facility.id ? { ...item, medicalStock: item.medicalStock - model.installationMedicalUnits, implantParts: item.implantParts - model.installationPartsUnits } : item);
    const installation: CyberwareInstallationState = {
      id: createStableEntityId("cyberware-installation", `${seed}:${resident.id}:${model.id}:${dayIndex}`),
      residentId: resident.id,
      modelId: model.id,
      providerFacilityId: facility.id,
      installedDay: dayIndex,
      condition: model.licensed ? rng.integer(86, 98) : rng.integer(58, 82),
      maintenanceDueDay: dayIndex + model.maintenanceIntervalDays,
      lastMaintenanceDay: dayIndex,
      licensedSerial: model.licensed,
      financedBy,
      debtId,
      status: "active",
      failures: 0
    };
    nextInstallations = [...nextInstallations, installation];
    addTotals(totals, { cyberwareInstalled: 1, medicalUnitsConsumed: model.installationMedicalUnits, partsUnitsConsumed: model.installationPartsUnits, undergroundProcedures: facility.licensed ? 0 : 1 });
    transactions.push({ idempotencyKey: `${seed}:cyberware-parts:${dayIndex}:${installation.id}`, timestamp: dayIndex * DAY_MS, debitEntityId: facility.id, creditEntityId: resident.id, resource: "parts-units", amount: model.installationPartsUnits, reason: "cyberware-installation", assetId: installation.id, description: `${model.name} components installed.` }, { idempotencyKey: `${seed}:cyberware-medical:${dayIndex}:${installation.id}`, timestamp: dayIndex * DAY_MS, debitEntityId: facility.id, creditEntityId: resident.id, resource: "medical-units", amount: model.installationMedicalUnits, reason: "cyberware-installation", assetId: installation.id, description: `Sterile and surgical supplies consumed for ${model.name}.` });
    if (rng.chance(model.rejectionRisk * (facility.licensed ? 1 : 2.2))) nextConditions = [...nextConditions, condition(seed, resident.id, dayIndex, "implant-rejection", rng.integer(34, 76), "cyberware", installation.id)];
    installedThisWeek += 1;
  }
  return { installations: nextInstallations, facilities: nextFacilities, conditions: nextConditions, households: nextHouseholds, organizations: nextOrganizations, debts: nextDebts };
}

function settleDebts(
  dayIndex: number,
  seed: string,
  debts: MedicalDebtState[],
  households: HouseholdState[],
  organizations: OrganizationState[],
  transactions: HealthAdvanceResult["transactions"],
  totals: HealthCyberwareTotals
): { debts: MedicalDebtState[]; households: HouseholdState[]; organizations: OrganizationState[] } {
  if (dayIndex % 7 !== 0) return { debts, households, organizations };
  let nextHouseholds = households;
  let nextOrganizations = organizations;
  const nextDebts = debts.map((debt) => {
    if (debt.status === "paid" || debt.status === "written-off") return debt;
    const household = nextHouseholds.find((item) => item.id === debt.householdId);
    if (!household) return { ...debt, status: "written-off" as const };

    const underground = debt.weeklyInterestRate > 0.008;
    const interest = Math.min(debt.principal * debt.weeklyInterestRate, underground ? 35 : 12);
    const reserve = Math.max(120, household.memberIds.length * 60 + Math.round(household.rentPerWeek * 0.35));
    const available = Math.max(0, household.balance - reserve);
    const payment = Math.max(0, round(Math.min(debt.principal + interest, available * (underground ? 0.16 : 0.11))));
    const daysWithoutPayment = dayIndex - debt.lastPaymentDay;

    let principal = Math.min(underground ? 15_000 : 8_000, round(debt.principal + interest - payment));
    let status: MedicalDebtState["status"] = principal <= 0.5 ? "paid" : daysWithoutPayment > 28 ? "delinquent" : "current";

    // Providers eventually write off debts that cannot be collected. The family still carries
    // the social and credit consequences elsewhere, but the bill stops compounding forever.
    const shouldWriteOff = payment <= 0 && daysWithoutPayment >= (underground ? 540 : 365) && household.balance < reserve * 0.65;
    const writtenOff = shouldWriteOff ? principal : 0;
    if (shouldWriteOff) {
      principal = 0;
      status = "written-off";
    }

    nextHouseholds = nextHouseholds.map((item) => item.id === household.id ? {
      ...item,
      balance: item.balance - payment,
      debt: Math.max(0, item.debt + interest - payment - writtenOff)
    } : item);
    nextOrganizations = updateOrganizationBudget(nextOrganizations, debt.providerEntityId, payment);
    if (payment > 0) {
      transactions.push({
        idempotencyKey: `${seed}:medical-debt-payment:${dayIndex}:${debt.id}`,
        timestamp: dayIndex * DAY_MS,
        debitEntityId: household.id,
        creditEntityId: debt.providerEntityId,
        resource: "credits",
        amount: payment,
        reason: "medical-debt",
        description: `Medical debt installment.`
      });
      addTotals(totals, { debtRepaid: payment });
    }
    return {
      ...debt,
      principal,
      lastPaymentDay: payment > 0 ? dayIndex : debt.lastPaymentDay,
      status
    };
  });
  return { debts: nextDebts, households: nextHouseholds, organizations: nextOrganizations };
}

export function advanceHealthCyberware(state: HealthCyberwareState, input: HealthAdvanceInput): HealthAdvanceResult {
  if (input.timestamp <= state.lastUpdatedAt) return { state, organizations: input.organizations, population: input.population, economy: input.economy, production: input.production, government: input.government, notices: [], transactions: [] };
  const targetDay = Math.floor(input.timestamp / DAY_MS);
  let dayIndex = Math.max(state.dayIndex, Math.floor(state.lastUpdatedAt / DAY_MS));
  let facilities = state.facilities.map((item) => ({ ...item }));
  let conditions = state.conditions.map((item) => ({ ...item }));
  let cases = state.cases.map((item) => ({ ...item }));
  let policies = state.policies.map((item) => ({ ...item }));
  let debts = state.debts.map((item) => ({ ...item }));
  let installations = state.installations.map((item) => ({ ...item }));
  let residents = input.population.residents.map((item) => ({ ...item }));
  let households = input.population.households.map((item) => ({ ...item }));
  let employments = input.population.employments.map((item) => ({ ...item }));
  let economy = { ...input.economy, businesses: input.economy.businesses.map((item) => ({ ...item })) };
  let production = { ...input.production, facilities: input.production.facilities.map((item) => ({ ...item, inventory: item.inventory.map((entry) => ({ ...entry })) })) };
  let organizations = input.organizations.map((item) => ({ ...item }));
  let government = structuredClone(input.government);
  const totals = { ...state.totals };
  const transactions: HealthAdvanceResult["transactions"] = [];
  const notices: HealthNotice[] = [];
  const history = [...state.history];
  const models = state.cyberwareModels.length ? state.cyberwareModels : cyberwareCatalog(input.seed, organizations);
  while (dayIndex < targetDay) {
    dayIndex += 1;
    facilities = facilities.map((item) => syncFacility(item, dayIndex, { ...input, organizations, population: { ...input.population, residents, households, employments }, economy, production, government }, { ...input.population, residents, households, employments }, economy));
    for (const original of facilities) {
      const procurement = procureImplantStock(dayIndex, input.seed, original, production, organizations, transactions);
      facilities = facilities.map((item) => item.id === original.id ? procurement.facility : item);
      production = procurement.production;
      organizations = procurement.organizations;
    }
    const activeResidentIds = new Set(residents.map((item) => item.id));
    const activeHouseholdIds = new Set(households.map((item) => item.id));
    conditions = conditions.filter((item) => activeResidentIds.has(item.residentId));
    cases = cases.filter((item) => activeResidentIds.has(item.residentId));
    installations = installations.filter((item) => activeResidentIds.has(item.residentId));
    debts = debts.filter((item) => activeHouseholdIds.has(item.householdId));
    policies = synchronizePolicies(input.seed, dayIndex, policies, {
      population: { ...input.population, residents, households, employments },
      organizations,
      government
    });
    const premium = weeklyPremiums(dayIndex, input.seed, policies, households, organizations, government, transactions);
    policies = premium.policies;
    households = premium.households;
    organizations = premium.organizations;
    government = premium.government;
    const created = createDailyConditions(dayIndex, input.seed, { ...input, organizations, population: { ...input.population, residents, households, employments }, economy, production, government }, residents, households, employments, conditions);
    if (created.length) {
      conditions.push(...created);
      addTotals(totals, { conditionsCreated: created.length });
    }
    conditions = progressConditions(dayIndex, conditions);
    for (const conditionState of conditions.filter((item) => item.stage !== "resolved" && item.careLevel !== "self-care")) {
      if (cases.some((item) => item.conditionIds.includes(conditionState.id) && item.status !== "discharged" && item.status !== "abandoned")) continue;
      const resident = residents.find((item) => item.id === conditionState.residentId);
      if (!resident) continue;
      const facility = facilityForResident(resident, facilities, conditionState);
      if (!facility) continue;
      cases.push(createCase(input.seed, dayIndex, resident, conditionState, facility));
      addTotals(totals, { casesCreated: 1 });
    }
    const processed = processCases(dayIndex, input.seed, facilities, cases, conditions, residents, households, policies, organizations, government, economy, debts, transactions, totals);
    facilities = processed.facilities;
    cases = processed.cases;
    conditions = processed.conditions;
    households = processed.households;
    policies = processed.policies;
    organizations = processed.organizations;
    government = processed.government;
    economy = processed.economy;
    debts = processed.debts;
    const serviced = serviceCyberware(dayIndex, input.seed, installations, models, facilities, conditions, residents, transactions, totals);
    installations = serviced.installations;
    facilities = serviced.facilities;
    conditions = serviced.conditions;
    const installed = installCyberware(dayIndex, input.seed, models, installations, facilities, conditions, residents, households, employments, organizations, debts, transactions, totals);
    installations = installed.installations;
    facilities = installed.facilities;
    conditions = installed.conditions;
    households = installed.households;
    organizations = installed.organizations;
    debts = installed.debts;
    const debtSettlement = settleDebts(dayIndex, input.seed, debts, households, organizations, transactions, totals);
    debts = debtSettlement.debts;
    households = debtSettlement.households;
    organizations = debtSettlement.organizations;
    const healthUpdate = updateResidentHealth(residents, employments, conditions);
    residents = healthUpdate.residents;
    employments = healthUpdate.employments;
    const waiting = cases.filter((item) => item.status === "waiting");
    for (const item of waiting.filter((entry) => entry.waitingDays >= 4 && entry.triageLevel <= 2).slice(0, 2)) {
      const resident = residents.find((entry) => entry.id === item.residentId);
      if (resident && notices.length < 8) notices.push({ districtId: resident.districtId, residentId: resident.id, title: `${resident.name}: лечение задержано.`, detail: `Triage ${item.triageLevel} · ожидание ${item.waitingDays} дн. · очередь не закрыта.`, importance: 3 });
    }
    history.push({
      dayIndex,
      activeConditions: conditions.filter((item) => item.stage !== "resolved").length,
      waitingCases: waiting.length,
      treatedCases: processed.treatedToday,
      occupiedBeds: facilities.reduce((sum, item) => sum + item.occupiedBeds, 0),
      uninsuredResidents: policies.filter((item) => item.kind === "uninsured" || item.status !== "active").reduce((sum, policy) => sum + (households.find((item) => item.id === policy.householdId)?.memberIds.length ?? 0), 0),
      medicalDebt: Math.round(debts.filter((item) => item.status !== "paid" && item.status !== "written-off").reduce((sum, item) => sum + item.principal, 0)),
      installations: installations.filter((item) => item.status !== "removed").length,
      failedImplants: installations.filter((item) => item.status === "failed").length
    });
  }
  const population = { ...input.population, residents, households, employments };
  const nextState: HealthCyberwareState = {
    version: 1,
    facilities,
    conditions: conditions.slice(-CONDITION_LIMIT),
    cases: cases.slice(-CASE_LIMIT),
    policies,
    debts,
    cyberwareModels: models,
    installations,
    history: history.slice(-HISTORY_LIMIT),
    totals,
    dayIndex,
    simulatedDays: state.simulatedDays + Math.max(0, targetDay - state.dayIndex),
    lastUpdatedAt: input.timestamp
  };
  return { state: nextState, organizations, population, economy, production, government, notices, transactions };
}
