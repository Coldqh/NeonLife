import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import { createResidentSkills } from "../labor/laborMarket";
import type { ResidentSkillProfile, SkillDomain } from "../labor/types";
import { kernelSystemEntityId } from "../kernel/simulationKernel";
import type { KernelTransactionDraft } from "../kernel/types";
import type {
  BackgroundResident,
  EmploymentRecord,
  HouseholdState,
  HousingMarketState,
  OrganizationBudgetDelta,
  PopulationNotice,
  ResidentLifeStage
} from "../population/types";
import type {
  ArchivedResidentRecord,
  EducationInstitutionState,
  EducationLevel,
  EducationTrack,
  LifecycleAdvanceInput,
  LifecycleAdvanceResult,
  LifecycleEventState,
  PopulationLifecycleState,
  PopulationLifecycleTotals,
  ResidentSex
} from "./types";

const DAY_MS = 24 * 60 * 60_000;
const FIRST_NAMES = ["SENA", "TAVI", "RHEA", "ORIN", "KORA", "JUNO", "ELI", "VARA", "NEM", "CASS", "LYS", "DARA", "IVO", "MAREN", "TESS", "REN", "SOL", "NIKA", "ARLO", "VEI"] as const;
const LAST_NAMES = ["ORREL", "HALDEN", "MIREN", "ROTH", "SAYE", "KELL", "VOSS", "CALDER", "NOLL", "KORREN", "MORR", "TAREN", "VALE", "SORR", "KERN", "PELL", "DARO", "VENN", "RUSK", "TELO"] as const;
const SKILL_DOMAINS: readonly SkillDomain[] = ["logistics", "technical", "medical", "service", "administration", "security"];

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function lifeStageFor(age: number): ResidentLifeStage {
  if (age < 18) return "child";
  if (age >= 66) return "elderly";
  return "working-age";
}

function sexFor(seed: string, residentId: string): ResidentSex {
  return new SeededRandom(`${seed}:resident-sex:${residentId}`).chance(0.5) ? "female" : "male";
}

function educationForAge(age: number, skill: number, rng: SeededRandom): EducationLevel {
  if (age < 6) return "none";
  if (age < 13) return rng.chance(0.72) ? "basic" : "none";
  if (age < 18) return rng.chance(0.68) ? "secondary" : "basic";
  if (skill >= 78 && rng.chance(0.38)) return "higher";
  if (skill >= 48 && rng.chance(0.58)) return "vocational";
  return skill >= 28 ? "secondary" : "basic";
}

function normalizedResident(seed: string, dayIndex: number, resident: BackgroundResident): BackgroundResident {
  const rng = new SeededRandom(`${seed}:lifecycle-profile:${resident.id}`);
  const birthDay = typeof resident.birthDay === "number"
    ? resident.birthDay
    : dayIndex - Math.max(0, resident.age) * 365 - rng.integer(0, 364);
  const age = Math.max(0, Math.floor((dayIndex - birthDay) / 365));
  const educationLevel = resident.educationLevel ?? educationForAge(age, resident.skillLevel, rng);
  return {
    ...resident,
    birthDay,
    age,
    lifeStage: lifeStageFor(age),
    sex: resident.sex ?? sexFor(seed, resident.id),
    educationLevel,
    educationProgressDays: resident.educationProgressDays ?? rng.integer(0, 240),
    enrolledInstitutionId: resident.enrolledInstitutionId ?? null,
    partnerId: resident.partnerId ?? null,
    parentIds: resident.parentIds ?? [],
    childIds: resident.childIds ?? [],
    generation: resident.generation ?? 0,
    retired: resident.retired ?? resident.lifeStage === "elderly"
  };
}

function normalizedHousehold(dayIndex: number, household: HouseholdState): HouseholdState {
  return {
    ...household,
    foundedDay: household.foundedDay ?? dayIndex - Math.max(1, household.moveCount + 1) * 180,
    originHouseholdIds: household.originHouseholdIds ?? []
  };
}

function trackForLocation(name: string): EducationTrack {
  const upper = name.toUpperCase();
  if (upper.includes("TECH") || upper.includes("INSTITUTE")) return "technical";
  if (upper.includes("ACADEMY") || upper.includes("AURELIAN")) return "academy";
  return "comprehensive";
}

function createInstitutions(
  dayIndex: number,
  locations: LifecycleAdvanceInput["locations"],
  districts: LifecycleAdvanceInput["districts"]
): EducationInstitutionState[] {
  return locations.filter((location) => location.type === "education").map((location) => {
    const district = districts.find((item) => item.id === location.districtId);
    const track = trackForLocation(location.name);
    const quality = clamp(Math.round((district?.infrastructure ?? 50) * 0.72 + (track === "academy" ? 22 : track === "technical" ? 10 : 3)));
    return {
      id: createStableEntityId("education-institution", location.id),
      locationId: location.id,
      districtId: location.districtId,
      ownerOrganizationId: location.organizationId,
      track,
      capacity: track === "comprehensive" ? 150 : track === "technical" ? 110 : 80,
      enrolled: 0,
      quality,
      tuitionPerDay: track === "comprehensive" ? 0 : track === "technical" ? 3 : 11,
      publicCostPerStudentDay: track === "comprehensive" ? 4 : track === "technical" ? 2 : 0,
      waitlist: 0,
      status: "stable",
      lastUpdatedDay: dayIndex
    };
  });
}

function emptyTotals(): PopulationLifecycleTotals {
  return { births: 0, deaths: 0, immigrants: 0, emigrants: 0, partnerships: 0, separations: 0, householdsFormed: 0, graduates: 0, retirements: 0 };
}

function initialFamilyLinks(residents: BackgroundResident[], households: HouseholdState[]): BackgroundResident[] {
  const next: BackgroundResident[] = residents.map((resident) => ({ ...resident, parentIds: [...(resident.parentIds ?? [])], childIds: [...(resident.childIds ?? [])] }));
  const byId = new Map(next.map((resident) => [resident.id, resident]));
  for (const household of households) {
    const members: BackgroundResident[] = household.memberIds.flatMap((id) => {
      const resident = byId.get(id);
      return resident ? [resident] : [];
    });
    const adults = members.filter((item) => item.age >= 22 && item.age <= 66).sort((a, b) => b.age - a.age);
    const children = members.filter((item) => item.age < 22);
    if ((household.kind === "couple" || household.kind === "family") && adults.length >= 2) {
      const firstAdult = adults[0];
      const secondAdult = adults[1];
      if (firstAdult && secondAdult) {
        firstAdult.partnerId = secondAdult.id;
        secondAdult.partnerId = firstAdult.id;
      }
    }
    if (household.kind === "family" && adults.length >= 1) {
      const parents = adults.slice(0, 2);
      for (const child of children) {
        child.parentIds = parents.map((parent) => parent.id);
        for (const parent of parents) {
          const childIds = parent.childIds ?? [];
          if (!childIds.includes(child.id)) parent.childIds = [...childIds, child.id];
        }
        child.generation = Math.max(...parents.map((parent) => parent.generation ?? 0), 0) + 1;
      }
    }
  }
  return next;
}

export function createPopulationLifecycleState(
  seed: string,
  dayIndex: number,
  residents: BackgroundResident[],
  households: HouseholdState[],
  districts: LifecycleAdvanceInput["districts"],
  locations: LifecycleAdvanceInput["locations"]
): { state: PopulationLifecycleState; residents: BackgroundResident[]; households: HouseholdState[] } {
  const normalizedResidents = initialFamilyLinks(residents.map((resident) => normalizedResident(seed, dayIndex, resident)), households);
  const normalizedHouseholds = households.map((household) => normalizedHousehold(dayIndex, household));
  return {
    residents: normalizedResidents,
    households: normalizedHouseholds,
    state: {
      version: 1,
      institutions: createInstitutions(dayIndex, locations, districts),
      archive: [],
      events: [],
      representedPopulationByDistrict: Object.fromEntries(districts.map((district) => [district.id, district.population])),
      totals: emptyTotals(),
      lastProcessedDay: dayIndex
    }
  };
}

export function normalizePopulationLifecycleState(
  value: PopulationLifecycleState | undefined,
  seed: string,
  dayIndex: number,
  residents: BackgroundResident[],
  households: HouseholdState[],
  districts: LifecycleAdvanceInput["districts"],
  locations: LifecycleAdvanceInput["locations"]
): { state: PopulationLifecycleState; residents: BackgroundResident[]; households: HouseholdState[] } {
  const fresh = createPopulationLifecycleState(seed, dayIndex, residents, households, districts, locations);
  if (!value || value.version !== 1) return fresh;
  const institutions = createInstitutions(dayIndex, locations, districts).map((institution) => {
    const existing = value.institutions?.find((item) => item.locationId === institution.locationId);
    return existing ? { ...institution, ...existing, lastUpdatedDay: dayIndex } : institution;
  });
  return {
    residents: initialFamilyLinks(residents.map((resident) => normalizedResident(seed, dayIndex, resident)), households),
    households: households.map((household) => normalizedHousehold(dayIndex, household)),
    state: {
      ...fresh.state,
      ...value,
      institutions,
      archive: Array.isArray(value.archive) ? value.archive.slice(-2_000) : [],
      events: Array.isArray(value.events) ? value.events.slice(-500) : [],
      representedPopulationByDistrict: { ...fresh.state.representedPopulationByDistrict, ...(value.representedPopulationByDistrict ?? {}) },
      totals: { ...fresh.state.totals, ...(value.totals ?? {}) },
      lastProcessedDay: Math.min(dayIndex, value.lastProcessedDay ?? dayIndex)
    }
  };
}

function event(
  seed: string,
  dayIndex: number,
  type: LifecycleEventState["type"],
  residentIds: string[],
  householdIds: string[],
  districtId: string,
  summary: string
): LifecycleEventState {
  return {
    id: createStableEntityId("lifecycle-event", `${seed}:${dayIndex}:${type}:${residentIds.join(":")}:${householdIds.join(":")}`),
    dayIndex,
    type,
    residentIds,
    householdIds,
    districtId,
    summary
  };
}

function educationTarget(resident: BackgroundResident): "basic" | "secondary" | "vocational" | "higher" | null {
  if (resident.age >= 6 && resident.age < 13 && resident.educationLevel === "none") return "basic";
  if (resident.age >= 12 && resident.age < 19 && (resident.educationLevel === "none" || resident.educationLevel === "basic")) return "secondary";
  if (resident.age >= 18 && resident.age <= 28 && resident.educationLevel === "secondary") {
    const technical = resident.skills?.technical ?? resident.skillLevel;
    const administration = resident.skills?.administration ?? resident.skillLevel;
    return administration >= technical + 12 ? "higher" : "vocational";
  }
  if (resident.age >= 19 && resident.age <= 30 && resident.educationLevel === "vocational" && (resident.skills?.administration ?? 0) >= 62) return "higher";
  return null;
}

function educationTrackForTarget(target: ReturnType<typeof educationTarget>): EducationTrack | null {
  if (target === "basic" || target === "secondary") return "comprehensive";
  if (target === "vocational") return "technical";
  if (target === "higher") return "academy";
  return null;
}

function educationThreshold(target: NonNullable<ReturnType<typeof educationTarget>>): number {
  if (target === "basic") return 720;
  if (target === "secondary") return 1_080;
  if (target === "vocational") return 540;
  return 1_080;
}

function improveSkills(resident: BackgroundResident, track: EducationTrack, quality: number): BackgroundResident {
  const current = resident.skills ?? createResidentSkills("lifecycle-fallback", resident.id, resident.skillLevel);
  const bonus = quality >= 80 ? 2 : 1;
  const next: ResidentSkillProfile = { ...current };
  const domains: SkillDomain[] = track === "technical"
    ? ["technical", "logistics"]
    : track === "academy"
      ? ["administration", "medical"]
      : ["service", "administration"];
  for (const domain of domains) next[domain] = clamp(next[domain] + bonus);
  return { ...resident, skills: next, skillLevel: Math.round((resident.skillLevel + Math.max(...SKILL_DOMAINS.map((domain) => next[domain]))) / 2) };
}

function pushBudgetDelta(deltas: OrganizationBudgetDelta[], organizationId: string | undefined, delta: number): void {
  if (!organizationId || delta === 0) return;
  const existing = deltas.find((item) => item.organizationId === organizationId);
  if (existing) existing.delta += delta;
  else deltas.push({ organizationId, delta });
}

function availableHousing(housing: HousingMarketState[], occupied: Map<string, number>, members: number, districtId?: string): HousingMarketState | null {
  return housing
    .filter((unit) => !districtId || unit.districtId === districtId)
    .filter((unit) => unit.status !== "critical" && unit.capacity - (occupied.get(unit.locationId) ?? unit.occupied) >= members)
    .sort((left, right) => left.baseRentPerBedWeek - right.baseRentPerBedWeek || right.quality - left.quality)[0]
    ?? housing
      .filter((unit) => unit.status !== "critical" && unit.capacity - (occupied.get(unit.locationId) ?? unit.occupied) >= members)
      .sort((left, right) => left.baseRentPerBedWeek - right.baseRentPerBedWeek)[0]
    ?? null;
}

function pantryUnits(pantry: HouseholdState["pantry"]): number {
  return pantry.reduce((sum, item) => sum + Math.max(0, item.units), 0);
}

function mergePantries(...pantries: HouseholdState["pantry"][]): HouseholdState["pantry"] {
  const totals = new Map<string, number>();
  for (const pantry of pantries) {
    for (const item of pantry) totals.set(item.productId, (totals.get(item.productId) ?? 0) + Math.max(0, item.units));
  }
  return [...totals.entries()].filter(([, units]) => units > 0).map(([productId, units]) => ({ productId, units }));
}

function removeEmptyHouseholds(households: HouseholdState[]): HouseholdState[] {
  return households.filter((household) => household.memberIds.length > 0);
}

function archivedResident(resident: BackgroundResident, status: ArchivedResidentRecord["status"], dayIndex: number, cause: string, destination?: string): ArchivedResidentRecord {
  return {
    residentId: resident.id,
    activePersonId: resident.activePersonId,
    name: resident.name,
    age: resident.age,
    districtId: resident.districtId,
    householdId: resident.householdId,
    status,
    dayIndex,
    cause,
    destination,
    educationLevel: resident.educationLevel ?? "none",
    partnerId: resident.partnerId,
    parentIds: resident.parentIds ?? [],
    childIds: resident.childIds ?? []
  };
}

function annualDeathRate(resident: BackgroundResident, household: HouseholdState | undefined, pollution: number): number {
  let base = resident.age < 1 ? 0.004 : resident.age < 18 ? 0.00035 : resident.age < 45 ? 0.001 : resident.age < 66 ? 0.004 : resident.age < 76 ? 0.015 : resident.age < 86 ? 0.05 : 0.15;
  const healthFactor = 1 + Math.max(0, 65 - resident.healthScore) / 80;
  const housingFactor = household?.status === "displaced" ? 1.8 : household?.status === "arrears" ? 1.25 : 1;
  const pollutionFactor = 1 + pollution / 180;
  if (resident.healthScore <= 12) base = Math.max(base, 0.015);
  return Math.min(0.85, base * healthFactor * housingFactor * pollutionFactor);
}

function causeOfDeath(resident: BackgroundResident, household: HouseholdState | undefined): string {
  if (resident.healthScore <= 20) return "untreated critical condition";
  if (household?.status === "displaced" && resident.healthScore <= 45) return "exposure and untreated illness";
  if (resident.age >= 82) return "age-related organ failure";
  if (resident.health === "ill" || resident.health === "disabled") return "chronic condition complications";
  return "acute medical failure";
}

function lastName(name: string): string {
  return name.trim().split(/\s+/).slice(-1)[0] || "NOLL";
}

function monthlyMacroPopulation(
  current: number,
  district: LifecycleAdvanceInput["districts"][number],
  residents: BackgroundResident[],
  households: HouseholdState[],
  employments: EmploymentRecord[],
  housing: HousingMarketState[]
): number {
  const localResidents = residents.filter((resident) => resident.districtId === district.id);
  const localHouseholds = households.filter((household) => household.districtId === district.id);
  const activeJobs = new Set(employments.filter((job) => job.status === "active").map((job) => job.residentId));
  const working = localResidents.filter((resident) => resident.lifeStage === "working-age");
  const employedRate = working.length ? working.filter((resident) => activeJobs.has(resident.id)).length / working.length : district.employmentRate / 100;
  const stableRate = localHouseholds.length ? localHouseholds.filter((household) => household.status === "stable").length / localHouseholds.length : 0.5;
  const averageHealth = localResidents.length ? localResidents.reduce((sum, resident) => sum + resident.healthScore, 0) / localResidents.length : 65;
  const localHousing = housing.filter((unit) => unit.districtId === district.id);
  const capacity = localHousing.reduce((sum, unit) => sum + unit.capacity, 0);
  const occupied = localHousing.reduce((sum, unit) => sum + unit.occupied, 0);
  const spareHousing = capacity ? clamp((capacity - occupied) / capacity, 0, 0.4) : 0;
  const annualBirthRate = 0.007 + stableRate * 0.006;
  const annualDeath = 0.005 + Math.max(0, 62 - averageHealth) / 2_800 + district.pollution / 18_000;
  const annualMigration = clamp((employedRate - 0.62) * 0.045 + spareHousing * 0.04 - (1 - stableRate) * 0.02, -0.035, 0.035);
  return Math.max(1_000, current * (1 + (annualBirthRate - annualDeath + annualMigration) / 12));
}

export function advancePopulationLifecycleDay(input: LifecycleAdvanceInput): LifecycleAdvanceResult {
  const normalized = normalizePopulationLifecycleState(input.state, input.seed, input.dayIndex, input.residents, input.households, input.districts, input.locations);
  let state = normalized.state;
  let residents: BackgroundResident[] = normalized.residents.map((resident) => ({ ...resident, parentIds: [...(resident.parentIds ?? [])], childIds: [...(resident.childIds ?? [])] }));
  let households = normalized.households.map((household) => ({ ...household, memberIds: [...household.memberIds], pantry: household.pantry.map((item) => ({ ...item })) }));
  let employments = input.employments.map((employment) => ({ ...employment }));
  let housing = input.housing.map((unit) => ({ ...unit }));
  const notices: PopulationNotice[] = [];
  const transactions: KernelTransactionDraft[] = [];
  const budgetDeltas: OrganizationBudgetDelta[] = [];
  const events: LifecycleEventState[] = [];
  const archive: ArchivedResidentRecord[] = [...state.archive];
  const totals = { ...state.totals };
  const dayRng = new SeededRandom(`${input.seed}:lifecycle-day:${input.dayIndex}`);
  const householdById = () => new Map(households.map((household) => [household.id, household]));
  const residentById = () => new Map(residents.map((resident) => [resident.id, resident]));

  // Exact aging, adulthood and retirement.
  residents = residents.map((resident) => {
    const birthDay = resident.birthDay ?? input.dayIndex - resident.age * 365;
    const age = Math.max(0, Math.floor((input.dayIndex - birthDay) / 365));
    const previousAge = Math.max(0, Math.floor((input.dayIndex - 1 - birthDay) / 365));
    const previousStage = lifeStageFor(previousAge);
    let next = { ...resident, age, birthDay, lifeStage: lifeStageFor(age) };
    if (previousStage === "child" && next.lifeStage === "working-age") {
      next = { ...next, jobSearchStatus: "open" };
      totals.householdsFormed += 0;
      events.push(event(input.seed, input.dayIndex, "adulthood", [next.id], [next.householdId], next.districtId, `${next.name} reached working age.`));
      notices.push({ districtId: next.districtId, title: `${next.name} достиг совершеннолетия.`, detail: `Новый взрослый житель вошёл в рынок образования и труда.`, importance: 1 });
    }
    if (previousStage !== "elderly" && next.lifeStage === "elderly" && !next.retired) {
      next = { ...next, retired: true, jobSearchStatus: "inactive", employmentId: null };
      employments = employments.map((employment) => employment.residentId === next.id && employment.status !== "unemployed"
        ? { ...employment, status: "unemployed", separationReason: "retirement", endedDay: input.dayIndex }
        : employment);
      totals.retirements += 1;
      events.push(event(input.seed, input.dayIndex, "retirement", [next.id], [next.householdId], next.districtId, `${next.name} retired from the labor market.`));
    }
    return next;
  });

  // Education enrollment, funding and skill growth.
  const institutionUsage = new Map<string, number>();
  const waitlist = new Map<string, number>();
  const organizationBudget = new Map(input.organizations.map((organization) => [organization.id, organization.budget]));
  residents = residents.map((resident) => {
    const target = educationTarget(resident);
    if (!target) return { ...resident, enrolledInstitutionId: null };
    const track = educationTrackForTarget(target);
    if (!track) return resident;
    const household = households.find((item) => item.id === resident.householdId);
    const candidates = state.institutions
      .filter((institution) => institution.track === track)
      .sort((left, right) => Number(right.districtId === resident.districtId) - Number(left.districtId === resident.districtId) || right.quality - left.quality);
    const institution = candidates.find((item) => (institutionUsage.get(item.id) ?? 0) < item.capacity);
    if (!institution || !household) {
      if (candidates[0]) waitlist.set(candidates[0].id, (waitlist.get(candidates[0].id) ?? 0) + 1);
      return { ...resident, enrolledInstitutionId: null };
    }
    const tuition = institution.tuitionPerDay;
    if (tuition > 0 && household.balance < tuition) {
      waitlist.set(institution.id, (waitlist.get(institution.id) ?? 0) + 1);
      return { ...resident, enrolledInstitutionId: null };
    }
    institutionUsage.set(institution.id, (institutionUsage.get(institution.id) ?? 0) + 1);
    if (tuition > 0) {
      household.balance -= tuition;
      pushBudgetDelta(budgetDeltas, institution.ownerOrganizationId, tuition);
      transactions.push({
        idempotencyKey: `${input.seed}:day:${input.dayIndex}:education-tuition:${resident.id}:${institution.id}`,
        timestamp: input.dayIndex * DAY_MS,
        debitEntityId: household.id,
        creditEntityId: institution.ownerOrganizationId ?? institution.id,
        resource: "credits",
        amount: tuition,
        reason: "education-service",
        description: `${resident.name} education tuition.`
      });
    }
    const publicCost = institution.publicCostPerStudentDay;
    if (publicCost > 0 && institution.ownerOrganizationId) {
      const available = organizationBudget.get(institution.ownerOrganizationId) ?? 0;
      const funded = Math.min(publicCost, available);
      organizationBudget.set(institution.ownerOrganizationId, available - funded);
      pushBudgetDelta(budgetDeltas, institution.ownerOrganizationId, -funded);
      if (funded > 0) transactions.push({
        idempotencyKey: `${input.seed}:day:${input.dayIndex}:education-public:${resident.id}:${institution.id}`,
        timestamp: input.dayIndex * DAY_MS,
        debitEntityId: institution.ownerOrganizationId,
        creditEntityId: institution.id,
        resource: "credits",
        amount: funded,
        reason: "education-service",
        description: `${resident.name} public education funding.`
      });
    }
    const progressDays = (resident.educationProgressDays ?? 0) + 1;
    let next: BackgroundResident = { ...resident, enrolledInstitutionId: institution.id, educationProgressDays: progressDays };
    if (progressDays % 30 === 0) next = improveSkills(next, institution.track, institution.quality);
    if (progressDays >= educationThreshold(target)) {
      next = { ...next, educationLevel: target, educationProgressDays: 0, enrolledInstitutionId: null };
      totals.graduates += 1;
      events.push(event(input.seed, input.dayIndex, "graduation", [next.id], [next.householdId], next.districtId, `${next.name} completed ${target} education.`));
      notices.push({ districtId: next.districtId, title: `${next.name} завершил обучение.`, detail: `${target.toUpperCase()} · квалификация и доступ к работе изменились.`, importance: 1 });
    }
    return next;
  });
  state = {
    ...state,
    institutions: state.institutions.map((institution) => {
      const enrolled = institutionUsage.get(institution.id) ?? 0;
      const queued = waitlist.get(institution.id) ?? 0;
      const load = enrolled / Math.max(1, institution.capacity);
      return { ...institution, enrolled, waitlist: queued, status: load >= 1 ? "overloaded" : load >= 0.86 ? "strained" : "stable", lastUpdatedDay: input.dayIndex };
    })
  };

  // Partnerships and new households happen on a monthly cadence.
  const occupied = new Map<string, number>();
  for (const household of households) if (household.homeLocationId) occupied.set(household.homeLocationId, (occupied.get(household.homeLocationId) ?? 0) + household.memberIds.length);
  if (input.dayIndex % 30 === 0) {
    const singles = residents.filter((resident) => resident.age >= 21 && resident.age <= 46 && !resident.partnerId && resident.lifeStage === "working-age" && !resident.retired);
    const first = singles.length ? dayRng.pick(singles) : undefined;
    const secondCandidates = first
      ? singles.filter((candidate) => candidate.id !== first.id && candidate.householdId !== first.householdId && Math.abs(candidate.age - first.age) <= 12)
      : [];
    const second = secondCandidates.length ? dayRng.pick(secondCandidates) : undefined;
    if (first && second && dayRng.chance(0.36)) {
      const unit = availableHousing(housing, occupied, 2, first.districtId);
      if (unit) {
        const sourceA = households.find((item) => item.id === first.householdId);
        const sourceB = households.find((item) => item.id === second.householdId);
        const householdId = createStableEntityId("household", `${input.seed}:partnership:${input.dayIndex}:${first.id}:${second.id}`);
        let contributionA = 0;
        let contributionB = 0;
        let transferredPantryA: HouseholdState["pantry"] = [];
        let transferredPantryB: HouseholdState["pantry"] = [];
        if (sourceA) {
          sourceA.memberIds = sourceA.memberIds.filter((id) => id !== first.id);
          contributionA = sourceA.memberIds.length === 0 ? sourceA.balance : Math.min(450, Math.round(sourceA.balance * 0.28));
          sourceA.balance = Math.max(0, sourceA.balance - contributionA);
          if (sourceA.memberIds.length === 0) {
            transferredPantryA = sourceA.pantry.map((item) => ({ ...item }));
            sourceA.pantry = [];
            sourceA.foodUnits = 0;
          }
        }
        if (sourceB) {
          sourceB.memberIds = sourceB.memberIds.filter((id) => id !== second.id);
          contributionB = sourceB.memberIds.length === 0 ? sourceB.balance : Math.min(450, Math.round(sourceB.balance * 0.28));
          sourceB.balance = Math.max(0, sourceB.balance - contributionB);
          if (sourceB.memberIds.length === 0) {
            transferredPantryB = sourceB.pantry.map((item) => ({ ...item }));
            sourceB.pantry = [];
            sourceB.foodUnits = 0;
          }
        }
        const combinedPantry = mergePantries(transferredPantryA, transferredPantryB);
        if (sourceA && contributionA > 0) transactions.push({ idempotencyKey: `${input.seed}:household-transfer:${input.dayIndex}:${sourceA.id}:${householdId}:credits`, timestamp: input.dayIndex * DAY_MS, debitEntityId: sourceA.id, creditEntityId: householdId, resource: "credits", amount: contributionA, reason: "household-transfer", description: `Household assets transferred during partnership formation.` });
        if (sourceB && contributionB > 0) transactions.push({ idempotencyKey: `${input.seed}:household-transfer:${input.dayIndex}:${sourceB.id}:${householdId}:credits`, timestamp: input.dayIndex * DAY_MS, debitEntityId: sourceB.id, creditEntityId: householdId, resource: "credits", amount: contributionB, reason: "household-transfer", description: `Household assets transferred during partnership formation.` });
        const foodA = pantryUnits(transferredPantryA);
        const foodB = pantryUnits(transferredPantryB);
        if (sourceA && foodA > 0) transactions.push({ idempotencyKey: `${input.seed}:household-transfer:${input.dayIndex}:${sourceA.id}:${householdId}:food`, timestamp: input.dayIndex * DAY_MS, debitEntityId: sourceA.id, creditEntityId: householdId, resource: "food-units", amount: foodA, reason: "household-transfer", description: `Pantry transferred during partnership formation.` });
        if (sourceB && foodB > 0) transactions.push({ idempotencyKey: `${input.seed}:household-transfer:${input.dayIndex}:${sourceB.id}:${householdId}:food`, timestamp: input.dayIndex * DAY_MS, debitEntityId: sourceB.id, creditEntityId: householdId, resource: "food-units", amount: foodB, reason: "household-transfer", description: `Pantry transferred during partnership formation.` });
        households.push({
          id: householdId,
          districtId: unit.districtId,
          homeLocationId: unit.locationId,
          kind: "couple",
          memberIds: [first.id, second.id],
          balance: contributionA + contributionB,
          debt: 0,
          foodUnits: pantryUnits(combinedPantry),
          pantry: combinedPantry,
          rentPerWeek: Math.round(unit.baseRentPerBedWeek * 2),
          dailyIncome: 0,
          dailyExpenses: 0,
          housingSecurity: unit.condition,
          status: "stable",
          spendingMode: "restricted",
          consecutiveDeficitDays: 0,
          consecutiveRentMisses: 0,
          moveCount: 0,
          lastLedger: null,
          foundedDay: input.dayIndex,
          originHouseholdIds: [first.householdId, second.householdId]
        });
        residents = residents.map((resident) => resident.id === first.id
          ? { ...resident, partnerId: second.id, householdId, homeLocationId: unit.locationId, districtId: unit.districtId }
          : resident.id === second.id
            ? { ...resident, partnerId: first.id, householdId, homeLocationId: unit.locationId, districtId: unit.districtId }
            : resident);
        occupied.set(unit.locationId, (occupied.get(unit.locationId) ?? 0) + 2);
        totals.partnerships += 1;
        totals.householdsFormed += 1;
        events.push(event(input.seed, input.dayIndex, "partnership", [first.id, second.id], [householdId], unit.districtId, `${first.name} and ${second.name} formed a household.`));
      }
    }

    // A young adult may leave a family household even without a partner.
    const youngAdults = residents.filter((resident) => resident.age >= 18 && resident.age <= 30 && !resident.partnerId && households.find((household) => household.id === resident.householdId)?.kind === "family");
    const independent = youngAdults.length ? dayRng.pick(youngAdults) : null;
    if (independent && dayRng.chance(0.22)) {
      const source = households.find((item) => item.id === independent.householdId);
      const unit = availableHousing(housing, occupied, 1, independent.districtId);
      if (source && unit && source.memberIds.length > 1) {
        const contribution = Math.min(260, Math.round(source.balance * 0.18));
        source.balance -= contribution;
        source.memberIds = source.memberIds.filter((id) => id !== independent.id);
        const householdId = createStableEntityId("household", `${input.seed}:independence:${input.dayIndex}:${independent.id}`);
        if (contribution > 0) transactions.push({
          idempotencyKey: `${input.seed}:household-transfer:${input.dayIndex}:${source.id}:${householdId}:credits`,
          timestamp: input.dayIndex * DAY_MS,
          debitEntityId: source.id,
          creditEntityId: householdId,
          resource: "credits",
          amount: contribution,
          reason: "household-transfer",
          description: `Starter funds transferred to an independent household.`
        });
        households.push({
          id: householdId,
          districtId: unit.districtId,
          homeLocationId: unit.locationId,
          kind: "single",
          memberIds: [independent.id],
          balance: contribution,
          debt: 0,
          foodUnits: 0,
          pantry: [],
          rentPerWeek: unit.baseRentPerBedWeek,
          dailyIncome: 0,
          dailyExpenses: 0,
          housingSecurity: unit.condition,
          status: "strained",
          spendingMode: "restricted",
          consecutiveDeficitDays: 0,
          consecutiveRentMisses: 0,
          moveCount: 0,
          lastLedger: null,
          foundedDay: input.dayIndex,
          originHouseholdIds: [source.id]
        });
        residents = residents.map((resident) => resident.id === independent.id ? { ...resident, householdId, homeLocationId: unit.locationId, districtId: unit.districtId } : resident);
        occupied.set(unit.locationId, (occupied.get(unit.locationId) ?? 0) + 1);
        totals.householdsFormed += 1;
        events.push(event(input.seed, input.dayIndex, "household-formation", [independent.id], [householdId], unit.districtId, `${independent.name} left the previous household.`));
      }
    }

    // High pressure couples can separate.
    const stressedCouples = households.filter((household) => household.kind === "couple" && household.memberIds.length >= 2 && (household.status === "arrears" || household.consecutiveDeficitDays >= 6));
    const separating = stressedCouples.length ? dayRng.pick(stressedCouples) : null;
    if (separating && dayRng.chance(0.08)) {
      const partner = residents.find((resident) => resident.id === separating.memberIds[1]);
      const unit = partner ? availableHousing(housing, occupied, 1) : null;
      if (partner && unit) {
        separating.memberIds = separating.memberIds.filter((id) => id !== partner.id);
        const householdId = createStableEntityId("household", `${input.seed}:separation:${input.dayIndex}:${partner.id}`);
        const transferredBalance = Math.round(separating.balance * 0.35);
        households.push({ ...separating, id: householdId, districtId: unit.districtId, homeLocationId: unit.locationId, kind: "single", memberIds: [partner.id], balance: transferredBalance, debt: Math.round(separating.debt * 0.35), pantry: [], foodUnits: 0, rentPerWeek: unit.baseRentPerBedWeek, status: "strained", foundedDay: input.dayIndex, originHouseholdIds: [separating.id] });
        separating.balance = Math.max(0, separating.balance - transferredBalance);
        if (transferredBalance > 0) transactions.push({
          idempotencyKey: `${input.seed}:household-transfer:${input.dayIndex}:${separating.id}:${householdId}:credits`,
          timestamp: input.dayIndex * DAY_MS,
          debitEntityId: separating.id,
          creditEntityId: householdId,
          resource: "credits",
          amount: transferredBalance,
          reason: "household-transfer",
          description: `Household balance divided during separation.`
        });
        separating.debt = Math.max(0, separating.debt - households[households.length - 1].debt);
        const formerPartnerId = partner.partnerId;
        residents = residents.map((resident) => resident.id === partner.id
          ? { ...resident, partnerId: null, householdId, homeLocationId: unit.locationId, districtId: unit.districtId }
          : resident.id === formerPartnerId ? { ...resident, partnerId: null } : resident);
        totals.separations += 1;
        totals.householdsFormed += 1;
        events.push(event(input.seed, input.dayIndex, "separation", [partner.id, ...(formerPartnerId ? [formerPartnerId] : [])], [separating.id, householdId], separating.districtId, `A household separated under financial pressure.`));
      }
    }
  }

  households = removeEmptyHouseholds(households);

  // Births are caused by stable partnered households with capacity and resources.
  const currentResidents = residentById();
  for (const household of households) {
    if ((household.kind !== "couple" && household.kind !== "family") || household.status === "displaced" || household.memberIds.length >= 6) continue;
    const adults: BackgroundResident[] = household.memberIds.flatMap((id) => {
      const resident = currentResidents.get(id);
      return resident && resident.age >= 22 && resident.age <= 44 && Boolean(resident.partnerId) ? [resident] : [];
    });
    if (adults.length < 2 || (household.balance < 40 && household.dailyIncome <= 0)) continue;
    const district = input.districts.find((item) => item.id === household.districtId);
    const stability = household.status === "stable" ? 1.3 : 0.7;
    const pollutionPenalty = 1 - Math.min(0.45, (district?.pollution ?? 50) / 200);
    if (!dayRng.chance(0.0009 * stability * pollutionPenalty)) continue;
    const parentA = adults[0];
    const parentB = adults[1];
    if (!parentA || !parentB) continue;
    const parents: [BackgroundResident, BackgroundResident] = [parentA, parentB];
    const childId = createStableEntityId("resident", `${input.seed}:birth:${input.dayIndex}:${household.id}:${totals.births}`);
    const childRng = new SeededRandom(`${input.seed}:birth-profile:${childId}`);
    const childName = `${childRng.pick(FIRST_NAMES)} ${lastName(parents[0].name)}`;
    const healthScore = clamp(Math.round((parents[0].healthScore + parents[1].healthScore) / 2) - Math.round((district?.pollution ?? 40) / 20) + childRng.integer(-5, 7), 35, 98);
    const generation = Math.max(parents[0].generation ?? 0, parents[1].generation ?? 0) + 1;
    const child: BackgroundResident = {
      id: childId,
      name: childName,
      age: 0,
      birthDay: input.dayIndex,
      sex: childRng.chance(0.5) ? "female" : "male",
      lifeStage: "child",
      districtId: household.districtId,
      householdId: household.id,
      homeLocationId: household.homeLocationId,
      employmentId: null,
      health: healthScore <= 48 ? "ill" : healthScore <= 68 ? "strained" : "healthy",
      healthScore,
      skillLevel: 0,
      savings: 0,
      transportAccess: 100,
      skills: createResidentSkills(input.seed, childId, 0),
      careerPreference: childRng.pick(["income", "stability", "distance", "day-shift", "advancement"] as const),
      jobSearchStatus: "inactive",
      experienceDays: 0,
      lastJobChangeDay: null,
      educationLevel: "none",
      educationProgressDays: 0,
      enrolledInstitutionId: null,
      partnerId: null,
      parentIds: parents.map((parent) => parent.id),
      childIds: [],
      generation,
      retired: false
    };
    residents.push(child);
    household.memberIds.push(child.id);
    household.kind = "family";
    residents = residents.map((resident) => parents.some((parent) => parent.id === resident.id)
      ? { ...resident, childIds: [...new Set([...(resident.childIds ?? []), child.id])] }
      : resident);
    totals.births += 1;
    events.push(event(input.seed, input.dayIndex, "birth", [child.id, ...parents.map((parent) => parent.id)], [household.id], household.districtId, `${child.name} was born.`));
    notices.push({ districtId: household.districtId, title: `Родился новый житель: ${child.name}.`, detail: `${household.memberIds.length} человек теперь живут в одном домохозяйстве.`, importance: 1 });
  }

  // Mortality removes residents from active systems but keeps a permanent archive.
  const deceasedIds = new Set<string>();
  for (const resident of residents) {
    const household = households.find((item) => item.id === resident.householdId);
    const district = input.districts.find((item) => item.id === resident.districtId);
    const probability = annualDeathRate(resident, household, district?.pollution ?? 50) / 365;
    if (!dayRng.chance(probability)) continue;
    deceasedIds.add(resident.id);
    const cause = causeOfDeath(resident, household);
    archive.push(archivedResident(resident, "deceased", input.dayIndex, cause));
    if (household) {
      household.memberIds = household.memberIds.filter((id) => id !== resident.id);
      const inheritance = Math.max(0, resident.savings);
      if (household.memberIds.length > 0) {
        household.balance += inheritance;
        if (inheritance > 0) transactions.push({
          idempotencyKey: `${input.seed}:inheritance:${input.dayIndex}:${resident.id}:${household.id}`,
          timestamp: input.dayIndex * DAY_MS,
          debitEntityId: resident.id,
          creditEntityId: household.id,
          resource: "credits",
          amount: inheritance,
          reason: "household-transfer",
          description: `Personal savings transferred to the surviving household.`
        });
      } else {
        if (inheritance > 0) transactions.push({
          idempotencyKey: `${input.seed}:estate-resident:${input.dayIndex}:${resident.id}`,
          timestamp: input.dayIndex * DAY_MS,
          debitEntityId: resident.id,
          creditEntityId: kernelSystemEntityId(input.seed, "credit-bureau"),
          resource: "credits",
          amount: inheritance,
          reason: "household-transfer",
          description: `Unclaimed personal estate entered civic settlement.`
        });
        if (household.balance > 0) transactions.push({
          idempotencyKey: `${input.seed}:estate-household:${input.dayIndex}:${household.id}:credits`,
          timestamp: input.dayIndex * DAY_MS,
          debitEntityId: household.id,
          creditEntityId: kernelSystemEntityId(input.seed, "credit-bureau"),
          resource: "credits",
          amount: household.balance,
          reason: "household-transfer",
          description: `Unclaimed household balance entered civic settlement.`
        });
        const remainingFood = pantryUnits(household.pantry);
        if (remainingFood > 0) transactions.push({
          idempotencyKey: `${input.seed}:estate-household:${input.dayIndex}:${household.id}:food`,
          timestamp: input.dayIndex * DAY_MS,
          debitEntityId: household.id,
          creditEntityId: kernelSystemEntityId(input.seed, "consumption"),
          resource: "food-units",
          amount: remainingFood,
          reason: "household-transfer",
          description: `Perishable household stock cleared after the final resident died.`
        });
        household.balance = 0;
        household.pantry = [];
        household.foodUnits = 0;
      }
    }
    if (resident.partnerId) residents = residents.map((item) => item.id === resident.partnerId ? { ...item, partnerId: null } : item);
    employments = employments.map((employment) => employment.residentId === resident.id && employment.status !== "unemployed"
      ? { ...employment, status: "unemployed", separationReason: "death", endedDay: input.dayIndex }
      : employment);
    totals.deaths += 1;
    events.push(event(input.seed, input.dayIndex, "death", [resident.id], [resident.householdId], resident.districtId, `${resident.name} died: ${cause}.`));
    notices.push({ districtId: resident.districtId, title: `${resident.name} умер.`, detail: `${resident.age} лет · ${cause}.`, importance: 3 });
  }
  residents = residents.filter((resident) => !deceasedIds.has(resident.id));
  households = removeEmptyHouseholds(households);

  // Monthly outward and inward migration follows jobs and housing rather than random cards.
  if (input.dayIndex % 30 === 0) {
    const activeJobs = new Set(employments.filter((job) => job.status === "active").map((job) => job.residentId));
    const migrationCandidates = households.filter((household) => {
      const members = residents.filter((resident) => resident.householdId === household.id);
      const working = members.filter((resident) => resident.lifeStage === "working-age");
      const employed = working.filter((resident) => activeJobs.has(resident.id));
      return household.status === "displaced" || household.consecutiveRentMisses >= 8 || (working.length > 0 && employed.length === 0 && household.consecutiveDeficitDays >= 8);
    });
    const leavingHousehold = migrationCandidates.length ? dayRng.pick(migrationCandidates) : null;
    if (leavingHousehold && dayRng.chance(0.2)) {
      const leaving = residents.filter((resident) => resident.householdId === leavingHousehold.id);
      for (const resident of leaving) {
        archive.push(archivedResident(resident, "emigrated", input.dayIndex, "economic displacement", "EXTERNAL INDUSTRIAL REGION"));
        if (resident.savings > 0) transactions.push({
          idempotencyKey: `${input.seed}:migration-out:${input.dayIndex}:${resident.id}:credits`,
          timestamp: input.dayIndex * DAY_MS,
          debitEntityId: resident.id,
          creditEntityId: kernelSystemEntityId(input.seed, "external-trade"),
          resource: "credits",
          amount: resident.savings,
          reason: "migration-settlement",
          description: `Personal savings left the city with an emigrating resident.`
        });
      }
      if (leavingHousehold.balance > 0) transactions.push({
        idempotencyKey: `${input.seed}:migration-out:${input.dayIndex}:${leavingHousehold.id}:credits`,
        timestamp: input.dayIndex * DAY_MS,
        debitEntityId: leavingHousehold.id,
        creditEntityId: kernelSystemEntityId(input.seed, "external-trade"),
        resource: "credits",
        amount: leavingHousehold.balance,
        reason: "migration-settlement",
        description: `Household funds left the city during emigration.`
      });
      const leavingFood = pantryUnits(leavingHousehold.pantry);
      if (leavingFood > 0) transactions.push({
        idempotencyKey: `${input.seed}:migration-out:${input.dayIndex}:${leavingHousehold.id}:food`,
        timestamp: input.dayIndex * DAY_MS,
        debitEntityId: leavingHousehold.id,
        creditEntityId: kernelSystemEntityId(input.seed, "external-trade"),
        resource: "food-units",
        amount: leavingFood,
        reason: "migration-settlement",
        description: `Household provisions left the city during emigration.`
      });
      const leavingIds = new Set(leaving.map((resident) => resident.id));
      residents = residents.filter((resident) => !leavingIds.has(resident.id));
      employments = employments.map((employment) => leavingIds.has(employment.residentId) && employment.status !== "unemployed"
        ? { ...employment, status: "unemployed", separationReason: "migration", endedDay: input.dayIndex }
        : employment);
      households = households.filter((household) => household.id !== leavingHousehold.id);
      totals.emigrants += leaving.length;
      events.push(event(input.seed, input.dayIndex, "migration-out", [...leavingIds], [leavingHousehold.id], leavingHousehold.districtId, `${leaving.length} residents left the city after sustained economic pressure.`));
      notices.push({ districtId: leavingHousehold.districtId, title: `Домохозяйство покинуло город.`, detail: `${leaving.length} человек · причиной стала потеря дохода и жилья.`, importance: 2 });
    }

    const available = housing.reduce((sum, unit) => sum + Math.max(0, unit.capacity - unit.occupied), 0);
    const working = residents.filter((resident) => resident.lifeStage === "working-age");
    const unemployed = working.filter((resident) => !activeJobs.has(resident.id)).length;
    const employmentPull = working.length ? 1 - unemployed / working.length : 0;
    const sampleGap = Math.max(0, 240 - residents.length);
    const representedCityPopulation = input.districts.reduce((sum, district) => sum + district.population, 0);
    const baseArrivals = available > 2 && employmentPull > 0.46 && dayRng.chance(0.68) ? 1 : 0;
    const replacementArrivals = available > 2 && sampleGap > 0 ? Math.min(2, Math.ceil(sampleGap / 55)) : 0;
    const metropolitanChurn = representedCityPopulation >= 1_000_000 && available > 2 && residents.length < 300 && input.dayIndex % 360 === 0 ? 1 : 0;
    const arrivals = Math.min(3, baseArrivals + replacementArrivals + metropolitanChurn);
    for (let index = 0; index < arrivals; index += 1) {
      const district = dayRng.pick(input.districts.slice().sort((left, right) => right.employmentRate - left.employmentRate).slice(0, 2));
      const unit = availableHousing(housing, occupied, 1, district.id);
      if (!unit) continue;
      const residentId = createStableEntityId("resident", `${input.seed}:immigrant:${input.dayIndex}:${index}`);
      const rng = new SeededRandom(`${input.seed}:immigrant-profile:${residentId}`);
      const age = rng.integer(18, 46);
      const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
      const educationLevel: EducationLevel = rng.chance(0.18) ? "higher" : rng.chance(0.46) ? "vocational" : "secondary";
      const skill = educationLevel === "higher" ? rng.integer(58, 88) : educationLevel === "vocational" ? rng.integer(42, 76) : rng.integer(24, 58);
      const householdId = createStableEntityId("household", `${input.seed}:immigrant-household:${input.dayIndex}:${index}`);
      const startingSavings = rng.integer(30, 280);
      const resident: BackgroundResident = {
        id: residentId,
        name,
        age,
        birthDay: input.dayIndex - age * 365 - rng.integer(0, 364),
        sex: rng.chance(0.5) ? "female" : "male",
        lifeStage: "working-age",
        districtId: unit.districtId,
        householdId,
        homeLocationId: unit.locationId,
        employmentId: null,
        health: "healthy",
        healthScore: rng.integer(64, 92),
        skillLevel: skill,
        savings: startingSavings,
        transportAccess: 100,
        skills: createResidentSkills(input.seed, residentId, skill),
        careerPreference: rng.pick(["income", "stability", "distance", "day-shift", "advancement"] as const),
        jobSearchStatus: "urgent",
        experienceDays: rng.integer(0, 1_400),
        lastJobChangeDay: null,
        educationLevel,
        educationProgressDays: 0,
        enrolledInstitutionId: null,
        partnerId: null,
        parentIds: [],
        childIds: [],
        generation: 0,
        retired: false
      };
      const startingBalance = rng.integer(80, 360);
      const startingFoodUnits = 2;
      residents.push(resident);
      households.push({
        id: householdId,
        districtId: unit.districtId,
        homeLocationId: unit.locationId,
        kind: "temporary",
        memberIds: [residentId],
        balance: startingBalance,
        debt: rng.integer(0, 80),
        foodUnits: startingFoodUnits,
        pantry: [{ productId: "kernel-9-brick", units: startingFoodUnits }],
        rentPerWeek: unit.baseRentPerBedWeek,
        dailyIncome: 0,
        dailyExpenses: 0,
        housingSecurity: unit.condition,
        status: "strained",
        spendingMode: "restricted",
        consecutiveDeficitDays: 0,
        consecutiveRentMisses: 0,
        moveCount: 0,
        lastLedger: null,
        foundedDay: input.dayIndex,
        originHouseholdIds: []
      });
      transactions.push({
        idempotencyKey: `${input.seed}:migration-settlement:${input.dayIndex}:${householdId}:credits`,
        timestamp: input.dayIndex * DAY_MS,
        debitEntityId: kernelSystemEntityId(input.seed, "external-trade"),
        creditEntityId: householdId,
        resource: "credits",
        amount: startingBalance,
        reason: "migration-settlement",
        description: `Declared funds entered the city with a new household.`
      });
      transactions.push({
        idempotencyKey: `${input.seed}:migration-settlement:${input.dayIndex}:${householdId}:food`,
        timestamp: input.dayIndex * DAY_MS,
        debitEntityId: kernelSystemEntityId(input.seed, "external-trade"),
        creditEntityId: householdId,
        resource: "food-units",
        amount: startingFoodUnits,
        reason: "migration-settlement",
        description: `Travel provisions entered the city with a new household.`
      });
      if (startingSavings > 0) transactions.push({
        idempotencyKey: `${input.seed}:migration-settlement:${input.dayIndex}:${residentId}:credits`,
        timestamp: input.dayIndex * DAY_MS,
        debitEntityId: kernelSystemEntityId(input.seed, "external-trade"),
        creditEntityId: residentId,
        resource: "credits",
        amount: startingSavings,
        reason: "migration-settlement",
        description: `Declared personal savings entered the city with a new resident.`
      });
      occupied.set(unit.locationId, (occupied.get(unit.locationId) ?? 0) + 1);
      totals.immigrants += 1;
      events.push(event(input.seed, input.dayIndex, "migration-in", [residentId], [householdId], unit.districtId, `${name} migrated into the city for work.`));
    }
  }

  // Smooth represented population changes independently from the detailed sample records.
  const representedPopulationByDistrict = { ...state.representedPopulationByDistrict };
  if (input.dayIndex % 30 === 0) {
    for (const district of input.districts) {
      representedPopulationByDistrict[district.id] = monthlyMacroPopulation(
        representedPopulationByDistrict[district.id] ?? district.population,
        district,
        residents,
        households,
        employments,
        housing
      );
    }
  }

  households = removeEmptyHouseholds(households);
  const finalOccupied = new Map<string, number>();
  for (const household of households) if (household.homeLocationId) finalOccupied.set(household.homeLocationId, (finalOccupied.get(household.homeLocationId) ?? 0) + household.memberIds.length);
  housing = housing.map((unit) => ({ ...unit, occupied: finalOccupied.get(unit.locationId) ?? 0 }));

  return {
    state: {
      ...state,
      archive: archive.slice(-2_000),
      events: [...state.events, ...events].slice(-500),
      representedPopulationByDistrict,
      totals,
      lastProcessedDay: input.dayIndex
    },
    residents,
    households,
    employments,
    housing,
    notices,
    organizationBudgetDeltas: budgetDeltas,
    transactions
  };
}
