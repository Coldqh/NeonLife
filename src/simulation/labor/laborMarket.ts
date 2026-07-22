import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { BusinessKind, BusinessState } from "../../gameplay/economy/types";
import type { LocationState } from "../../world/state/types";
import type {
  BackgroundResident,
  EmploymentRecord,
  HouseholdState,
  PopulationNotice,
  ShiftType
} from "../population/types";
import type {
  CareerPreference,
  JobApplicationState,
  JobSearchStatus,
  LaborMarketState,
  ResidentSkillProfile,
  SkillDomain,
  VacancyReason,
  VacancyState
} from "./types";

const SKILL_DOMAINS: readonly SkillDomain[] = ["logistics", "technical", "medical", "service", "administration", "security"];

interface RoleTemplate {
  titles: readonly string[];
  skill: SkillDomain;
  minimumSkill: number;
  baseWage: number;
  preferredShift: ShiftType;
}

const ROLE_TEMPLATES: Record<BusinessKind, RoleTemplate> = {
  retail: { titles: ["STOCK CLERK", "COUNTER OPERATOR", "INVENTORY HAND"], skill: "service", minimumSkill: 24, baseWage: 46, preferredShift: "rotating" },
  "food-service": { titles: ["FOOD LINE OPERATOR", "PREP HAND", "SERVICE ATTENDANT"], skill: "service", minimumSkill: 22, baseWage: 44, preferredShift: "night" },
  medical: { titles: ["CLINIC TECH", "TRIAGE SUPPORT", "MEDICAL LOGISTICS"], skill: "medical", minimumSkill: 46, baseWage: 68, preferredShift: "day" },
  repair: { titles: ["SERVICE TECH", "BENCH MECHANIC", "FIELD REPAIR HAND"], skill: "technical", minimumSkill: 38, baseWage: 62, preferredShift: "rotating" },
  logistics: { titles: ["DISPATCH HANDLER", "ROUTE OPERATOR", "CARGO CONTROLLER"], skill: "logistics", minimumSkill: 30, baseWage: 54, preferredShift: "rotating" },
  corporate: { titles: ["DATA CLERK", "OPERATIONS ASSISTANT", "COMPLIANCE RUNNER"], skill: "administration", minimumSkill: 44, baseWage: 76, preferredShift: "day" }
};

export interface LaborAdvanceResult {
  state: LaborMarketState;
  residents: BackgroundResident[];
  employments: EmploymentRecord[];
  businesses: BusinessState[];
  notices: PopulationNotice[];
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function locationDistrict(locations: LocationState[], locationId: string | null | undefined): string | null {
  if (!locationId) return null;
  return locations.find((location) => location.id === locationId)?.districtId ?? null;
}

function preferenceFor(seed: string, residentId: string): CareerPreference {
  return new SeededRandom(`${seed}:career-preference:${residentId}`).pick(["income", "stability", "distance", "day-shift", "advancement"] as const);
}

export function createResidentSkills(seed: string, residentId: string, baseSkill: number): ResidentSkillProfile {
  const rng = new SeededRandom(`${seed}:resident-skills:${residentId}`);
  const focus = rng.pick(SKILL_DOMAINS);
  const secondary = rng.pick(SKILL_DOMAINS.filter((domain) => domain !== focus));
  const profile = Object.fromEntries(SKILL_DOMAINS.map((domain) => {
    const focusBonus = domain === focus ? rng.integer(12, 24) : domain === secondary ? rng.integer(4, 13) : rng.integer(-15, 6);
    return [domain, clamp(Math.round(baseSkill * 0.72 + focusBonus))];
  })) as unknown as ResidentSkillProfile;
  return profile;
}

export function normalizeResidentLaborProfile(seed: string, resident: BackgroundResident): BackgroundResident {
  const skills = resident.skills ?? createResidentSkills(seed, resident.id, resident.skillLevel);
  const strongest = Math.max(...SKILL_DOMAINS.map((domain) => skills[domain]));
  const jobSearchStatus: JobSearchStatus = resident.jobSearchStatus
    ?? (resident.lifeStage === "working-age" && !resident.employmentId ? "urgent" : "inactive");
  return {
    ...resident,
    skillLevel: Math.round((resident.skillLevel + strongest) / 2),
    skills,
    careerPreference: resident.careerPreference ?? preferenceFor(seed, resident.id),
    jobSearchStatus,
    experienceDays: resident.experienceDays ?? 0,
    lastJobChangeDay: resident.lastJobChangeDay ?? null
  };
}

function templateForBusiness(business: BusinessState): RoleTemplate {
  return ROLE_TEMPLATES[business.kind];
}

function employmentDomain(employment: EmploymentRecord, business: BusinessState | undefined): SkillDomain {
  if (employment.skillDomain) return employment.skillDomain;
  if (business) return templateForBusiness(business).skill;
  const title = employment.title.toLowerCase();
  if (title.includes("clinic") || title.includes("medical")) return "medical";
  if (title.includes("repair") || title.includes("tech") || title.includes("mechanic")) return "technical";
  if (title.includes("dispatch") || title.includes("route") || title.includes("cargo")) return "logistics";
  if (title.includes("office") || title.includes("data") || title.includes("compliance")) return "administration";
  if (title.includes("security") || title.includes("guard")) return "security";
  return "service";
}

export function normalizeEmploymentLaborProfile(employment: EmploymentRecord, businesses: BusinessState[], dayIndex: number): EmploymentRecord {
  const business = businesses.find((item) => item.locationId === employment.locationId);
  const skillDomain = employmentDomain(employment, business);
  return {
    ...employment,
    roleId: employment.roleId ?? `${skillDomain}:${employment.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    skillDomain,
    minimumSkill: employment.minimumSkill ?? (business ? templateForBusiness(business).minimumSkill : 20),
    startedDay: employment.startedDay ?? dayIndex,
    satisfaction: employment.satisfaction ?? 58,
    performance: employment.performance ?? 55,
    quitPressure: employment.quitPressure ?? 0
  };
}

export function createLaborMarketState(dayIndex: number): LaborMarketState {
  return {
    vacancies: [],
    applications: [],
    history: [],
    lastUpdatedDay: dayIndex,
    totalHires: 0,
    totalQuits: 0,
    totalLayoffs: 0,
    totalJobChanges: 0,
    totalRejectedApplications: 0,
    wagePressureByDistrict: {}
  };
}

export function normalizeLaborMarketState(value: LaborMarketState | undefined, dayIndex: number): LaborMarketState {
  if (!value) return createLaborMarketState(dayIndex);
  return {
    vacancies: Array.isArray(value.vacancies) ? value.vacancies : [],
    applications: Array.isArray(value.applications) ? value.applications : [],
    history: Array.isArray(value.history) ? value.history.slice(-60) : [],
    lastUpdatedDay: typeof value.lastUpdatedDay === "number" ? value.lastUpdatedDay : dayIndex,
    totalHires: value.totalHires ?? 0,
    totalQuits: value.totalQuits ?? 0,
    totalLayoffs: value.totalLayoffs ?? 0,
    totalJobChanges: value.totalJobChanges ?? 0,
    totalRejectedApplications: value.totalRejectedApplications ?? 0,
    wagePressureByDistrict: value.wagePressureByDistrict ?? {}
  };
}

function commutePenalty(resident: BackgroundResident, locationId: string, locations: LocationState[]): number {
  const homeDistrict = locationDistrict(locations, resident.homeLocationId) ?? resident.districtId;
  const workDistrict = locationDistrict(locations, locationId);
  if (!workDistrict || workDistrict === homeDistrict) return 0;
  return resident.careerPreference === "distance" ? 12 : 7;
}

function wageExpectation(resident: BackgroundResident): number {
  const strongest = resident.skills ? Math.max(...SKILL_DOMAINS.map((domain) => resident.skills?.[domain] ?? 0)) : resident.skillLevel;
  return Math.round(34 + strongest * 0.58 + (resident.experienceDays ?? 0) / 90);
}

function currentEmploymentFor(resident: BackgroundResident, employments: EmploymentRecord[]): EmploymentRecord | undefined {
  return employments.find((employment) => employment.id === resident.employmentId && employment.status !== "unemployed")
    ?? employments.find((employment) => employment.residentId === resident.id && employment.status !== "unemployed");
}

function satisfactionFor(
  resident: BackgroundResident,
  employment: EmploymentRecord,
  business: BusinessState | undefined,
  locations: LocationState[]
): number {
  const expected = wageExpectation(resident);
  const wageScore = clamp(50 + (employment.wagePerDay - expected) * 1.8, 5, 88);
  const commute = commutePenalty(resident, employment.locationId, locations);
  const shiftPenalty = resident.careerPreference === "day-shift" && employment.shift !== "day" ? 8 : 0;
  const stabilityPenalty = employment.unpaidDays * 24 + (business?.status === "closed" ? 30 : business?.status === "restricted" ? 8 : 0);
  const advancementBonus = resident.careerPreference === "advancement" && (business?.capacityLevel ?? 1) >= 3 ? 9 : 0;
  return clamp(Math.round((employment.satisfaction ?? 58) * 0.65 + wageScore * 0.35 - commute - shiftPenalty - stabilityPenalty + advancementBonus));
}

function performanceFor(resident: BackgroundResident, employment: EmploymentRecord): number {
  const skill = resident.skills?.[employment.skillDomain ?? "service"] ?? resident.skillLevel;
  const health = resident.healthScore;
  const absencePenalty = employment.status === "absent" ? 20 : 0;
  return clamp(Math.round(skill * 0.65 + health * 0.35 - absencePenalty));
}

function vacancyReason(business: BusinessState, activeCount: number): VacancyReason {
  if (business.capacityLevel > 1 && activeCount >= business.targetStaff - 2) return "expansion";
  if (business.lossDays > 0 || business.status === "restricted") return "chronic-shortage";
  return activeCount === 0 ? "replacement" : "turnover";
}

function vacancyWage(business: BusinessState, template: RoleTemplate, minimumSkill: number, wagePressure: number, rng: SeededRandom): number {
  const statusPenalty = business.status === "strained" ? 3 : business.status === "restricted" ? 7 : 0;
  return Math.max(34, Math.round(template.baseWage + minimumSkill * 0.34 + (wagePressure - 100) * 0.24 - statusPenalty + rng.integer(-4, 5)));
}

function updateVacancyOffers(vacancies: VacancyState[], dayIndex: number): VacancyState[] {
  return vacancies.map((vacancy) => {
    if (vacancy.status !== "open") return vacancy;
    const age = Math.max(0, dayIndex - vacancy.openedDay);
    if (age <= 0) return vacancy;
    return {
      ...vacancy,
      wagePerDay: vacancy.wagePerDay + (age >= 3 ? Math.min(3, 1 + Math.floor(age / 4)) : 0),
      minimumSkill: Math.max(10, vacancy.minimumSkill - (age >= 7 ? 1 : 0)),
      status: dayIndex > vacancy.expiresDay ? "cancelled" : vacancy.status
    };
  });
}

function openVacancies(
  seed: string,
  dayIndex: number,
  vacancies: VacancyState[],
  businesses: BusinessState[],
  employments: EmploymentRecord[],
  locations: LocationState[],
  wagePressureByDistrict: Record<string, number>
): VacancyState[] {
  const next = [...vacancies];
  for (const business of businesses) {
    if (business.status === "closed" || business.targetStaff <= 0) continue;
    const activeCount = employments.filter((job) => job.locationId === business.locationId && job.status !== "unemployed").length;
    const openCount = next.filter((vacancy) => vacancy.businessId === business.id && vacancy.status === "open").length;
    const gap = Math.max(0, Math.min(3, business.targetStaff - activeCount - openCount));
    if (gap <= 0) continue;
    const template = templateForBusiness(business);
    const location = locations.find((item) => item.id === business.locationId);
    const districtPressure = location ? wagePressureByDistrict[location.districtId] ?? 100 : 100;
    for (let index = 0; index < gap; index += 1) {
      const rng = new SeededRandom(`${seed}:vacancy:${dayIndex}:${business.id}:${openCount + index}`);
      const minimumSkill = clamp(template.minimumSkill + rng.integer(-5, 7), 10, 82);
      const title = rng.pick(template.titles);
      next.push({
        id: createStableEntityId("vacancy", `${seed}:${business.id}:${dayIndex}:${openCount + index}:${title}`),
        businessId: business.id,
        organizationId: business.organizationId,
        locationId: business.locationId,
        title,
        requiredSkill: template.skill,
        minimumSkill,
        wagePerDay: vacancyWage(business, template, minimumSkill, districtPressure, rng),
        shift: template.preferredShift === "rotating" && rng.chance(0.35) ? rng.pick(["day", "night"] as const) : template.preferredShift,
        openedDay: dayIndex,
        expiresDay: dayIndex + 16,
        status: "open",
        reason: vacancyReason(business, activeCount),
        applicationIds: []
      });
    }
  }
  return next;
}

function reconcileVacancies(vacancies: VacancyState[], businesses: BusinessState[], employments: EmploymentRecord[]): VacancyState[] {
  return vacancies.map((vacancy) => {
    if (vacancy.status !== "open") return vacancy;
    const business = businesses.find((item) => item.id === vacancy.businessId);
    if (!business || business.status === "closed") return { ...vacancy, status: "cancelled" as const };
    const activeCount = employments.filter((job) => job.locationId === business.locationId && job.status !== "unemployed").length;
    const priorOpen = vacancies.filter((item) => item.businessId === business.id && item.status === "open" && item.openedDay < vacancy.openedDay).length;
    if (activeCount + priorOpen >= business.targetStaff) return { ...vacancy, status: "cancelled" as const };
    return vacancy;
  });
}

function applicationScore(
  resident: BackgroundResident,
  vacancy: VacancyState,
  currentEmployment: EmploymentRecord | undefined,
  locations: LocationState[]
): Omit<JobApplicationState, "id" | "vacancyId" | "residentId" | "submittedDay" | "status"> {
  const skill = resident.skills?.[vacancy.requiredSkill] ?? resident.skillLevel;
  const skillScore = skill - vacancy.minimumSkill;
  const wageGain = vacancy.wagePerDay - (currentEmployment?.wagePerDay ?? 0);
  const commute = commutePenalty(resident, vacancy.locationId, locations);
  const preferenceBonus = resident.careerPreference === "income" ? Math.max(0, wageGain) * 0.45
    : resident.careerPreference === "stability" && vacancy.reason !== "chronic-shortage" ? 10
      : resident.careerPreference === "distance" && commute === 0 ? 12
        : resident.careerPreference === "day-shift" && vacancy.shift === "day" ? 12
          : resident.careerPreference === "advancement" && vacancy.reason === "expansion" ? 12
            : 0;
  const healthBonus = (resident.healthScore - 50) * 0.16;
  const score = Math.round(56 + skillScore * 1.35 + wageGain * 0.58 - commute + preferenceBonus + healthBonus);
  return { score, skillScore, wageGain, commutePenalty: commute };
}

function submitApplications(
  seed: string,
  dayIndex: number,
  residents: BackgroundResident[],
  employments: EmploymentRecord[],
  vacancies: VacancyState[],
  existingApplications: JobApplicationState[],
  locations: LocationState[]
): { applications: JobApplicationState[]; vacancies: VacancyState[] } {
  const applications = [...existingApplications];
  let nextVacancies = vacancies.map((vacancy) => ({ ...vacancy, applicationIds: [...vacancy.applicationIds] }));
  const openVacanciesList = nextVacancies.filter((vacancy) => vacancy.status === "open");
  if (!openVacanciesList.length) return { applications, vacancies: nextVacancies };

  for (const resident of residents) {
    if (resident.lifeStage !== "working-age" || resident.healthScore <= 30) continue;
    const current = currentEmploymentFor(resident, employments);
    const searchStatus: JobSearchStatus = current
      ? (current.satisfaction ?? 58) < 43 || current.unpaidDays > 0 ? "open" : resident.jobSearchStatus ?? "inactive"
      : "urgent";
    if (searchStatus === "inactive") continue;
    const rng = new SeededRandom(`${seed}:job-search:${dayIndex}:${resident.id}`);
    const attemptChance = searchStatus === "urgent" ? 0.62 : 0.16;
    if (!rng.chance(attemptChance)) continue;

    const scored = openVacanciesList
      .filter((vacancy) => !applications.some((application) => application.vacancyId === vacancy.id && application.residentId === resident.id && application.status === "submitted"))
      .map((vacancy) => ({ vacancy, metrics: applicationScore(resident, vacancy, current, locations) }))
      .filter(({ vacancy, metrics }) => metrics.skillScore >= -14 && metrics.score >= 38 && (!current || metrics.wageGain >= -4))
      .sort((left, right) => right.metrics.score - left.metrics.score || right.vacancy.wagePerDay - left.vacancy.wagePerDay)
      .slice(0, 1);

    for (const { vacancy, metrics } of scored) {
      const id = createStableEntityId("application", `${seed}:${dayIndex}:${resident.id}:${vacancy.id}`);
      applications.push({ id, vacancyId: vacancy.id, residentId: resident.id, submittedDay: dayIndex, status: "submitted", ...metrics });
      nextVacancies = nextVacancies.map((item) => item.id === vacancy.id ? { ...item, applicationIds: [...item.applicationIds, id] } : item);
    }
  }
  return { applications, vacancies: nextVacancies };
}

function hireApplicants(
  seed: string,
  dayIndex: number,
  vacancies: VacancyState[],
  applications: JobApplicationState[],
  residents: BackgroundResident[],
  employments: EmploymentRecord[],
  businesses: BusinessState[],
  locations: LocationState[]
): {
  vacancies: VacancyState[];
  applications: JobApplicationState[];
  residents: BackgroundResident[];
  employments: EmploymentRecord[];
  hires: number;
  jobChanges: number;
  rejected: number;
  notices: PopulationNotice[];
} {
  let nextVacancies = vacancies.map((vacancy) => ({ ...vacancy, applicationIds: [...vacancy.applicationIds] }));
  let nextApplications = applications.map((application) => ({ ...application }));
  let nextResidents = residents.map((resident) => ({ ...resident }));
  let nextEmployments = employments.map((employment) => ({ ...employment }));
  const hiredResidents = new Set<string>();
  const notices: PopulationNotice[] = [];
  let hires = 0;
  let jobChanges = 0;
  let rejected = 0;

  const openVacanciesList = nextVacancies.filter((vacancy) => vacancy.status === "open").sort((left, right) => left.openedDay - right.openedDay || right.wagePerDay - left.wagePerDay);
  for (const vacancy of openVacanciesList) {
    const business = businesses.find((item) => item.id === vacancy.businessId);
    if (!business || business.status === "closed") continue;
    const candidates = nextApplications
      .filter((application) => application.vacancyId === vacancy.id && application.status === "submitted" && !hiredResidents.has(application.residentId))
      .sort((left, right) => right.score - left.score || left.submittedDay - right.submittedDay);
    if (!candidates.length) continue;
    const ageBonus = Math.min(14, (dayIndex - vacancy.openedDay) * 2);
    const winner = candidates.find((candidate) => candidate.score + ageBonus >= 56);
    if (!winner) continue;
    const resident = nextResidents.find((item) => item.id === winner.residentId);
    if (!resident) continue;
    const priorEmployment = currentEmploymentFor(resident, nextEmployments);
    const priorLocationId = priorEmployment?.locationId;
    const existingRecord = nextEmployments.find((employment) => employment.residentId === resident.id && employment.status === "unemployed") ?? priorEmployment;
    const roleId = `${vacancy.requiredSkill}:${vacancy.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    let employmentId = existingRecord?.id;
    if (existingRecord) {
      nextEmployments = nextEmployments.map((employment) => employment.id === existingRecord.id ? {
        ...employment,
        organizationId: vacancy.organizationId,
        locationId: vacancy.locationId,
        title: vacancy.title,
        wagePerDay: vacancy.wagePerDay,
        shift: vacancy.shift,
        status: "active" as const,
        absenceDays: 0,
        unpaidDays: 0,
        roleId,
        skillDomain: vacancy.requiredSkill,
        minimumSkill: vacancy.minimumSkill,
        startedDay: dayIndex,
        satisfaction: 62,
        performance: 50,
        quitPressure: 0,
        separationReason: undefined,
        endedDay: undefined
      } : employment);
    } else {
      employmentId = createStableEntityId("employment", `${seed}:hire:${dayIndex}:${resident.id}:${vacancy.id}`);
      nextEmployments.push({
        id: employmentId,
        residentId: resident.id,
        organizationId: vacancy.organizationId,
        locationId: vacancy.locationId,
        title: vacancy.title,
        wagePerDay: vacancy.wagePerDay,
        shift: vacancy.shift,
        status: "active",
        absenceDays: 0,
        unpaidDays: 0,
        roleId,
        skillDomain: vacancy.requiredSkill,
        minimumSkill: vacancy.minimumSkill,
        startedDay: dayIndex,
        satisfaction: 62,
        performance: 50,
        quitPressure: 0,
        separationReason: undefined,
        endedDay: undefined
      });
    }
    nextResidents = nextResidents.map((item) => item.id === resident.id ? {
      ...item,
      employmentId: employmentId ?? item.employmentId,
      jobSearchStatus: "inactive" as const,
      lastJobChangeDay: dayIndex
    } : item);
    nextVacancies = nextVacancies.map((item) => item.id === vacancy.id ? { ...item, status: "filled" as const, hiredResidentId: resident.id, filledDay: dayIndex } : item);
    nextApplications = nextApplications.map((application) => {
      if (application.id === winner.id) return { ...application, status: "accepted" as const };
      if (application.vacancyId === vacancy.id && application.status === "submitted") {
        rejected += 1;
        return { ...application, status: "rejected" as const };
      }
      return application;
    });
    hiredResidents.add(resident.id);
    hires += 1;
    const changed = Boolean(priorLocationId && priorLocationId !== vacancy.locationId);
    if (changed) jobChanges += 1;
    const location = locations.find((item) => item.id === vacancy.locationId);
    notices.push({
      districtId: location?.districtId ?? resident.districtId,
      title: changed ? `${resident.name} сменил работу.` : `${resident.name} получил работу.`,
      detail: `${vacancy.title} · ₵ ${vacancy.wagePerDay}/день · ${location?.name ?? "WORK NODE"}.`,
      importance: changed ? 2 : 1
    });
  }

  return { vacancies: nextVacancies, applications: nextApplications, residents: nextResidents, employments: nextEmployments, hires, jobChanges, rejected, notices };
}

function calculateWagePressure(vacancies: VacancyState[], locations: LocationState[], dayIndex: number): Record<string, number> {
  const grouped = new Map<string, VacancyState[]>();
  for (const vacancy of vacancies.filter((item) => item.status === "open")) {
    const districtId = locationDistrict(locations, vacancy.locationId);
    if (!districtId) continue;
    const list = grouped.get(districtId) ?? [];
    list.push(vacancy);
    grouped.set(districtId, list);
  }
  return Object.fromEntries([...grouped.entries()].map(([districtId, list]) => {
    const averageAge = list.reduce((sum, vacancy) => sum + Math.max(0, dayIndex - vacancy.openedDay), 0) / Math.max(1, list.length);
    return [districtId, clamp(Math.round(100 + list.length * 2.5 + averageAge * 1.8), 90, 145)];
  }));
}

export function advanceLaborMarketDay(
  source: LaborMarketState | undefined,
  dayIndex: number,
  seed: string,
  residentsInput: BackgroundResident[],
  employmentsInput: EmploymentRecord[],
  households: HouseholdState[],
  businessesInput: BusinessState[],
  locations: LocationState[]
): LaborAdvanceResult {
  let state = normalizeLaborMarketState(source, dayIndex);
  let residents = residentsInput.map((resident) => normalizeResidentLaborProfile(seed, resident));
  let employments = employmentsInput.map((employment) => normalizeEmploymentLaborProfile(employment, businessesInput, dayIndex));
  let businesses = businessesInput.map((business) => ({ ...business }));
  const notices: PopulationNotice[] = [];
  let quits = 0;
  const layoffs = employmentsInput.filter((employment) => employment.status === "unemployed" && employment.endedDay === dayIndex && employment.separationReason && employment.separationReason !== "quit").length;

  const householdById = new Map(households.map((household) => [household.id, household]));
  employments = employments.map((employment) => {
    if (employment.status === "unemployed") return employment;
    const resident = residents.find((item) => item.id === employment.residentId);
    if (!resident) return employment;
    const business = businesses.find((item) => item.locationId === employment.locationId);
    const satisfaction = satisfactionFor(resident, employment, business, locations);
    const performance = performanceFor(resident, employment);
    const household = householdById.get(resident.householdId);
    const householdRetention = household?.status === "displaced" ? 0.42 : household?.status === "arrears" ? 0.6 : household?.status === "strained" ? 0.78 : 1;
    const quitPressure = satisfaction < 18 ? (employment.quitPressure ?? 0) + 1 : Math.max(0, (employment.quitPressure ?? 0) - 2);
    const rng = new SeededRandom(`${seed}:retention:${dayIndex}:${employment.id}`);
    const tenureDays = Math.max(0, dayIndex - (employment.startedDay ?? dayIndex));
    const quitChance = (0.035 + Math.max(0, 18 - satisfaction) / 220) * householdRetention;
    const shouldQuit = tenureDays >= 21 && quitPressure >= 10 && rng.chance(quitChance);
    if (shouldQuit) {
      quits += 1;
      residents = residents.map((item) => item.id === resident.id ? { ...item, employmentId: employment.id, jobSearchStatus: "urgent" as const, lastJobChangeDay: dayIndex } : item);
      const location = locations.find((item) => item.id === employment.locationId);
      notices.push({ districtId: resident.districtId, title: `${resident.name} ушёл со смены.`, detail: `${employment.title} · удовлетворённость ${satisfaction}% · ${location?.name ?? "WORK NODE"}.`, importance: 2 });
      return { ...employment, status: "unemployed" as const, satisfaction, performance, quitPressure: 0, separationReason: "quit" as const, endedDay: dayIndex };
    }

    const skillDomain = employment.skillDomain ?? "service";
    const growth = employment.status === "active" && performance >= 45 && new SeededRandom(`${seed}:skill-growth:${dayIndex}:${resident.id}`).chance(0.22) ? 1 : 0;
    if (growth > 0) {
      residents = residents.map((item) => item.id === resident.id ? {
        ...item,
        skills: { ...(item.skills ?? createResidentSkills(seed, item.id, item.skillLevel)), [skillDomain]: clamp((item.skills?.[skillDomain] ?? item.skillLevel) + growth) },
        skillLevel: clamp(item.skillLevel + (dayIndex % 5 === 0 ? 1 : 0)),
        experienceDays: (item.experienceDays ?? 0) + 1,
        jobSearchStatus: satisfaction < 43 || employment.unpaidDays > 0 ? "open" as const : "inactive" as const
      } : item);
    } else {
      residents = residents.map((item) => item.id === resident.id ? {
        ...item,
        experienceDays: (item.experienceDays ?? 0) + (employment.status === "active" ? 1 : 0),
        jobSearchStatus: satisfaction < 43 || employment.unpaidDays > 0 ? "open" as const : "inactive" as const
      } : item);
    }
    return { ...employment, satisfaction, performance, quitPressure };
  });

  let vacancies = updateVacancyOffers(state.vacancies, dayIndex);
  vacancies = reconcileVacancies(vacancies, businesses, employments);
  const wagePressureBeforeOpen = calculateWagePressure(vacancies, locations, dayIndex);
  vacancies = openVacancies(seed, dayIndex, vacancies, businesses, employments, locations, wagePressureBeforeOpen);

  const submitted = submitApplications(seed, dayIndex, residents, employments, vacancies, state.applications, locations);
  vacancies = submitted.vacancies;
  let applications = submitted.applications;
  const hired = hireApplicants(seed, dayIndex, vacancies, applications, residents, employments, businesses, locations);
  vacancies = hired.vacancies;
  applications = hired.applications;
  residents = hired.residents;
  employments = hired.employments;
  notices.push(...hired.notices);

  const wagePressureByDistrict = calculateWagePressure(vacancies, locations, dayIndex);
  const openVacanciesList = vacancies.filter((vacancy) => vacancy.status === "open");
  const applicationsToday = applications.filter((application) => application.submittedDay === dayIndex).length;
  const averageOffer = openVacanciesList.length ? Math.round(openVacanciesList.reduce((sum, vacancy) => sum + vacancy.wagePerDay, 0) / openVacanciesList.length) : 0;
  const averageDaysOpen = openVacanciesList.length ? Math.round(openVacanciesList.reduce((sum, vacancy) => sum + Math.max(0, dayIndex - vacancy.openedDay), 0) / openVacanciesList.length) : 0;

  state = {
    ...state,
    vacancies: vacancies.filter((vacancy) => vacancy.status === "open" || dayIndex - (vacancy.filledDay ?? vacancy.openedDay) <= 30).slice(-320),
    applications: applications.filter((application) => dayIndex - application.submittedDay <= 45).slice(-400),
    history: [...state.history, { dayIndex, openVacancies: openVacanciesList.length, applications: applicationsToday, hires: hired.hires, quits, averageOffer, averageDaysOpen }].slice(-60),
    lastUpdatedDay: dayIndex,
    totalHires: state.totalHires + hired.hires,
    totalQuits: state.totalQuits + quits,
    totalLayoffs: state.totalLayoffs + layoffs,
    totalJobChanges: state.totalJobChanges + hired.jobChanges,
    totalRejectedApplications: state.totalRejectedApplications + hired.rejected,
    wagePressureByDistrict
  };

  return { state, residents, employments, businesses, notices };
}
