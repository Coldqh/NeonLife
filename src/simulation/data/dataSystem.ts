import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { BackgroundResident, HouseholdState, PopulationState } from "../population/types";
import { kernelSystemEntityId } from "../kernel/simulationKernel";
import type { KernelTransactionDraft } from "../kernel/types";
import type { EnforcementCaseState, GovernmentCrimeState } from "../government/types";
import type {
  AccessOutcome,
  DataAccessEventState,
  DataAccessGrantState,
  DataAdvanceInput,
  DataAdvanceResult,
  DataBreachState,
  DataDailySnapshot,
  DataNotice,
  DataPurpose,
  DataRecordKind,
  DataRecordState,
  DataSensitivity,
  DataSurveillanceState,
  DataSurveillanceTotals,
  DigitalIdentityState,
  DigitalIdentityStatus,
  IdentityForgeryState,
  SurveillanceNodeKind,
  SurveillanceNodeState,
  SurveillanceObservationState
} from "./types";

const DAY_MS = 24 * 60 * 60_000;
const MAX_ACCESS_EVENTS = 2_500;
const MAX_OBSERVATIONS = 2_500;
const MAX_BREACHES = 180;
const MAX_FORGERIES = 240;
const ALIAS_FIRST = ["MARA", "IVO", "SENA", "REN", "KORA", "TAVI", "NEM", "LYS", "ARLO", "DARA"] as const;
const ALIAS_LAST = ["VOSS", "KELL", "RUSK", "NOLL", "VALE", "PELL", "MORR", "TELO", "CALDER", "SORR"] as const;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function emptyTotals(): DataSurveillanceTotals {
  return {
    recordsCreated: 0,
    accesses: 0,
    deniedAccesses: 0,
    surveillanceCaptures: 0,
    breaches: 0,
    recordsStolen: 0,
    breachesContained: 0,
    dataSales: 0,
    dataSaleRevenue: 0,
    forgeriesCreated: 0,
    forgeriesDetected: 0,
    identitiesSuspended: 0
  };
}

function organizationByType(input: DataAdvanceInput, type: string): string | undefined {
  return input.organizations.find((item) => item.type === type)?.id;
}

function authorityId(input: DataAdvanceInput): string {
  return input.government.budget.authorityOrganizationId;
}

function policeId(input: DataAdvanceInput): string {
  return organizationByType(input, "police") ?? authorityId(input);
}

function medicalId(input: DataAdvanceInput): string {
  return organizationByType(input, "medical") ?? authorityId(input);
}

function dataCorporationId(input: DataAdvanceInput): string {
  return input.organizations.filter((item) => item.type === "corporation").sort((a, b) => b.budget - a.budget)[0]?.id ?? authorityId(input);
}

function serviceLevel(input: DataAdvanceInput, districtId: string, kind: "power" | "data"): number {
  const services = input.infrastructure.services.filter((item) => item.districtId === districtId && item.kind === kind);
  if (!services.length) return 100;
  return Math.round(services.reduce((sum, item) => sum + item.serviceLevel, 0) / services.length);
}

function householdFor(resident: BackgroundResident, population: PopulationState): HouseholdState | undefined {
  return population.households.find((item) => item.id === resident.householdId);
}

function employmentFor(resident: BackgroundResident, population: PopulationState) {
  return population.employments.find((item) => item.residentId === resident.id && item.status !== "unemployed");
}

function medicalDebtFor(householdId: string, input: DataAdvanceInput): number {
  return input.health.debts
    .filter((item) => item.householdId === householdId && item.status !== "paid" && item.status !== "written-off")
    .reduce((sum, item) => sum + item.principal, 0);
}

function criminalPressureFor(residentId: string, input: DataAdvanceInput): number {
  const detained = input.government.cases.some((item) => item.detainedResidentIds.includes(residentId));
  const member = input.government.crimeNetworks.some((item) => item.memberResidentIds.includes(residentId));
  return (detained ? 90 : 0) + (member ? 55 : 0);
}

function creditScoreFor(resident: BackgroundResident, input: DataAdvanceInput): number {
  const household = householdFor(resident, input.population);
  const employment = employmentFor(resident, input.population);
  if (!household) return 420;
  const medicalDebt = medicalDebtFor(household.id, input);
  const income = household.dailyIncome;
  const balance = household.balance;
  const generalDebt = household.debt;
  const housingPenalty = household.consecutiveRentMisses * 5 + (household.status === "displaced" ? 100 : household.status === "arrears" ? 45 : 0);
  const employmentBonus = employment ? Math.min(90, 28 + (resident.experienceDays ?? 0) / 18) : -65;
  const healthPenalty = resident.health === "disabled" ? 28 : resident.health === "ill" ? 14 : 0;
  const criminalPenalty = criminalPressureFor(resident.id, input);
  return Math.round(clamp(
    585 + employmentBonus + Math.min(85, income * 0.6) + Math.min(70, balance / 18)
      - Math.min(180, generalDebt * 0.11) - Math.min(150, medicalDebt * 0.065)
      - housingPenalty - healthPenalty - criminalPenalty,
    300,
    850
  ));
}

function digitalAccessFor(resident: BackgroundResident, status: DigitalIdentityStatus, input: DataAdvanceInput): number {
  const household = householdFor(resident, input.population);
  const data = serviceLevel(input, resident.districtId, "data");
  const address = resident.homeLocationId ? 12 : -25;
  const statusPenalty = status === "suspended" ? 65 : status === "compromised" ? 28 : status === "forged" ? 18 : status === "limited" ? 22 : 0;
  const povertyPenalty = household && household.spendingMode === "survival" ? 18 : household?.status === "arrears" ? 10 : 0;
  return Math.round(clamp(data * 0.62 + resident.transportAccess * 0.15 + address + 25 - statusPenalty - povertyPenalty));
}

function initialIdentityStatus(resident: BackgroundResident): DigitalIdentityStatus {
  if (!resident.homeLocationId) return "limited";
  return "verified";
}

function civicIdentifier(seed: string, residentId: string): string {
  const token = createStableEntityId("civic", `${seed}:${residentId}`).replace(/[^a-z0-9]/gi, "").slice(-12).toUpperCase();
  return `US-NX-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}`;
}

function ownerForRecord(kind: DataRecordKind, resident: BackgroundResident, input: DataAdvanceInput): string {
  if (kind === "medical" || kind === "cyberware") return medicalId(input);
  if (kind === "insurance") return input.health.policies.find((item) => item.householdId === resident.householdId)?.insurerEntityId ?? medicalId(input);
  if (kind === "employment") return employmentFor(resident, input.population)?.organizationId ?? authorityId(input);
  if (kind === "credit") return dataCorporationId(input);
  if (kind === "criminal" || kind === "access-log") return policeId(input);
  return authorityId(input);
}

function sensitivityFor(kind: DataRecordKind): DataSensitivity {
  if (kind === "civil-identity" || kind === "education" || kind === "license") return "restricted";
  if (kind === "address" || kind === "employment" || kind === "tax" || kind === "credit" || kind === "insurance") return "confidential";
  if (kind === "medical" || kind === "criminal" || kind === "cyberware" || kind === "access-log") return "sealed";
  return "restricted";
}

function recordSummary(kind: DataRecordKind, resident: BackgroundResident, input: DataAdvanceInput, creditScore: number): string {
  const household = householdFor(resident, input.population);
  const employment = employmentFor(resident, input.population);
  if (kind === "civil-identity") return `${resident.name} · AGE ${resident.age} · ${resident.sex ?? "UNSPECIFIED"}`;
  if (kind === "address") return resident.homeLocationId ? `REGISTERED ${resident.homeLocationId}` : "NO VERIFIED ADDRESS";
  if (kind === "employment") return employment ? `${employment.title} · ${employment.status.toUpperCase()} · ₵${employment.wagePerDay}/DAY` : "NO ACTIVE EMPLOYMENT";
  if (kind === "education") return `${(resident.educationLevel ?? "basic").toUpperCase()} · SKILL ${resident.skillLevel}`;
  if (kind === "medical") {
    const active = input.health.conditions.filter((item) => item.residentId === resident.id && item.stage !== "resolved");
    return `${resident.health.toUpperCase()} · ${active.length} ACTIVE CONDITIONS`;
  }
  if (kind === "insurance") {
    const policy = input.health.policies.find((item) => item.householdId === resident.householdId);
    return policy ? `${policy.kind.toUpperCase()} · ${policy.status.toUpperCase()} · ${policy.coveragePercent}%` : "NO POLICY";
  }
  if (kind === "tax") return `HOUSEHOLD INCOME ₵${household?.dailyIncome ?? 0} · DEBT ₵${household?.debt ?? 0}`;
  if (kind === "credit") return `SCORE ${creditScore} · RENT MISSES ${household?.consecutiveRentMisses ?? 0}`;
  if (kind === "criminal") return `CRIMINAL PRESSURE ${criminalPressureFor(resident.id, input)}`;
  if (kind === "license") return "CIVIC SERVICE ELIGIBILITY RECORD";
  if (kind === "cyberware") return `${input.health.installations.filter((item) => item.residentId === resident.id && item.status !== "removed").length} REGISTERED INSTALLATIONS`;
  return "ACCESS HISTORY";
}

const CORE_RECORD_KINDS: DataRecordKind[] = [
  "civil-identity", "address", "employment", "education", "medical", "insurance", "tax", "credit", "criminal", "license", "cyberware"
];

function syncIdentitiesAndRecords(
  state: DataSurveillanceState,
  input: DataAdvanceInput,
  dayIndex: number
): { identities: DigitalIdentityState[]; records: DataRecordState[]; created: number } {
  const identityMap = new Map(state.identities.map((item) => [item.residentId, item]));
  const recordMap = new Map(state.records.map((item) => [`${item.subjectId}:${item.kind}:${item.forged ? "forged" : "core"}`, item]));
  const activeResidentIds = new Set(input.population.residents.map((item) => item.id));
  const identities: DigitalIdentityState[] = [];
  let created = 0;

  for (const resident of input.population.residents) {
    const prior = identityMap.get(resident.id);
    const activeForgery = state.forgeries.find((item) => item.residentId === resident.id && item.status === "active");
    let status: DigitalIdentityStatus = prior?.status ?? initialIdentityStatus(resident);
    if (activeForgery) status = "forged";
    else if (status === "forged") status = "limited";
    else if (status === "verified" && !resident.homeLocationId) status = "limited";
    const score = creditScoreFor(resident, input);
    const access = digitalAccessFor(resident, status, input);
    const identity: DigitalIdentityState = {
      id: prior?.id ?? createStableEntityId("digital-identity", `${input.seed}:${resident.id}`),
      residentId: resident.id,
      civicIdentifier: prior?.civicIdentifier ?? civicIdentifier(input.seed, resident.id),
      aliases: [...new Set([...(prior?.aliases ?? []), ...(activeForgery ? [activeForgery.alias] : [])])],
      status,
      creditScore: score,
      digitalAccess: access,
      fraudRisk: Math.round(clamp((prior?.fraudRisk ?? 8) + (status === "compromised" ? 12 : 0) + (activeForgery ? 25 : -1))),
      profileCompleteness: Math.round(clamp(65 + (resident.homeLocationId ? 12 : 0) + (employmentFor(resident, input.population) ? 10 : 0) + (resident.educationLevel ? 8 : 0))),
      registeredAddressId: resident.homeLocationId,
      lastVerifiedDay: status === "verified" ? dayIndex : prior?.lastVerifiedDay ?? dayIndex,
      compromiseCount: prior?.compromiseCount ?? 0
    };
    identities.push(identity);

    for (const kind of CORE_RECORD_KINDS) {
      const key = `${resident.id}:${kind}:core`;
      const priorRecord = recordMap.get(key);
      const owner = ownerForRecord(kind, resident, input);
      const summary = recordSummary(kind, resident, input, score);
      if (!priorRecord) created += 1;
      recordMap.set(key, {
        id: priorRecord?.id ?? createStableEntityId("data-record", `${input.seed}:${resident.id}:${kind}`),
        subjectId: resident.id,
        kind,
        ownerEntityId: owner,
        sourceEntityId: owner,
        districtId: resident.districtId,
        sensitivity: sensitivityFor(kind),
        truthScore: priorRecord?.truthScore ?? 98,
        createdDay: priorRecord?.createdDay ?? dayIndex,
        updatedDay: dayIndex,
        retentionUntilDay: dayIndex + (kind === "access-log" ? 180 : 3650),
        compromised: priorRecord?.compromised ?? false,
        forged: false,
        summary,
        value: kind === "medical" || kind === "criminal" || kind === "cyberware" ? 18 : kind === "credit" || kind === "tax" ? 12 : 6
      });
    }
  }

  for (const identity of state.identities) {
    if (activeResidentIds.has(identity.residentId)) continue;
    identities.push({ ...identity, status: "suspended", digitalAccess: 0 });
  }
  const records = [...recordMap.values()].filter((item) => item.retentionUntilDay >= dayIndex - 1).slice(-8_000);
  return { identities, records, created };
}

function grantKindsForOrganization(type: string): { kinds: DataRecordKind[]; purpose: DataPurpose }[] {
  if (type === "government") return [
    { kinds: ["civil-identity", "address", "tax", "license", "credit"], purpose: "tax" },
    { kinds: ["civil-identity", "address", "license"], purpose: "service" }
  ];
  if (type === "police") return [
    { kinds: ["civil-identity", "address", "criminal", "license", "access-log", "cyberware"], purpose: "investigation" },
    { kinds: ["civil-identity", "address"], purpose: "security" }
  ];
  if (type === "medical") return [
    { kinds: ["civil-identity", "medical", "insurance", "cyberware", "address"], purpose: "care" },
    { kinds: ["medical", "insurance"], purpose: "insurance" }
  ];
  if (type === "corporation" || type === "company") return [
    { kinds: ["civil-identity", "employment", "education", "credit", "license"], purpose: "employment-screening" },
    { kinds: ["civil-identity", "credit"], purpose: "commercial-analysis" }
  ];
  if (type === "transport") return [{ kinds: ["civil-identity", "address", "access-log"], purpose: "security" }];
  return [{ kinds: ["civil-identity"], purpose: "service" }];
}

function createGrants(input: DataAdvanceInput, dayIndex: number): DataAccessGrantState[] {
  return input.organizations.flatMap((organization) => grantKindsForOrganization(organization.type).map((entry, index) => ({
    id: createStableEntityId("data-grant", `${input.seed}:${organization.id}:${entry.purpose}:${index}`),
    granteeEntityId: organization.id,
    recordKinds: entry.kinds,
    purpose: entry.purpose,
    scope: "city" as const,
    validFromDay: dayIndex,
    authorityEntityId: authorityId(input),
    active: organization.type !== "gang"
  })));
}

function nodeKindsForLocation(type: string): SurveillanceNodeKind[] {
  if (type === "transport") return ["transit-scanner", "camera"];
  if (type === "clinic") return ["medical-terminal", "implant-reader", "camera"];
  if (type === "office") return ["work-terminal", "identity-gate", "camera"];
  if (type === "government") return ["identity-gate", "network-sensor", "camera"];
  if (type === "education") return ["identity-gate", "camera"];
  if (type === "housing") return ["identity-gate", "camera"];
  return ["camera"];
}

function syncNodes(state: DataSurveillanceState, input: DataAdvanceInput, dayIndex: number): SurveillanceNodeState[] {
  const previous = new Map(state.nodes.map((item) => [item.id, item]));
  return input.locations.flatMap((location) => nodeKindsForLocation(location.type).map((kind, index) => {
    const id = createStableEntityId("surveillance-node", `${input.seed}:${location.id}:${kind}:${index}`);
    const prior = previous.get(id);
    const power = serviceLevel(input, location.districtId, "power");
    const data = serviceLevel(input, location.districtId, "data");
    const baseQuality = clamp(location.security * 0.72 + (kind === "network-sensor" || kind === "identity-gate" ? 18 : 8));
    const quality = Math.round(clamp(baseQuality * Math.min(power, data) / 100));
    const vulnerability = Math.round(clamp(100 - location.security * 0.58 + (100 - data) * 0.32 + (prior?.status === "compromised" ? 18 : 0), 8, 96));
    let status: SurveillanceNodeState["status"] = power < 18 || data < 14 ? "offline" : power < 52 || data < 48 ? "degraded" : "online";
    if (prior?.status === "compromised" && dayIndex - prior.lastUpdatedDay < 4) status = "compromised";
    return {
      id,
      locationId: location.id,
      districtId: location.districtId,
      ownerEntityId: location.organizationId ?? input.cityId,
      kind,
      coverage: Math.round(clamp(28 + location.security * 0.7 + (kind === "camera" ? 8 : 0))),
      quality,
      vulnerability,
      retentionDays: kind === "medical-terminal" ? 365 : kind === "network-sensor" ? 180 : 45,
      status,
      powerServiceLevel: power,
      dataServiceLevel: data,
      capturesToday: 0,
      recordsGenerated: prior?.recordsGenerated ?? 0,
      lastUpdatedDay: dayIndex
    };
  }));
}

function accessAllowed(grants: DataAccessGrantState[], actorId: string, record: DataRecordState, purpose: DataPurpose): boolean {
  if (record.ownerEntityId === actorId) return true;
  return grants.some((grant) => grant.active && grant.granteeEntityId === actorId && grant.purpose === purpose && grant.recordKinds.includes(record.kind)
    && (grant.scope === "city" || grant.subjectId === record.subjectId || grant.districtId === record.districtId));
}

function requestAccess(
  seed: string,
  dayIndex: number,
  grants: DataAccessGrantState[],
  actorId: string,
  record: DataRecordState | undefined,
  purpose: DataPurpose,
  sequence: number,
  nodeId?: string,
  caseId?: string
): DataAccessEventState | null {
  if (!record) return null;
  const allowed = accessAllowed(grants, actorId, record, purpose);
  const outcome: AccessOutcome = allowed ? "allowed" : purpose === "investigation" ? "overridden" : record.compromised ? "forged" : "denied";
  return {
    id: createStableEntityId("data-access", `${seed}:${dayIndex}:${actorId}:${record.id}:${purpose}:${sequence}`),
    dayIndex,
    actorEntityId: actorId,
    recordId: record.id,
    purpose,
    outcome,
    nodeId,
    caseId
  };
}

function generateAccesses(
  state: DataSurveillanceState,
  input: DataAdvanceInput,
  records: DataRecordState[],
  grants: DataAccessGrantState[],
  dayIndex: number
): DataAccessEventState[] {
  const events: DataAccessEventState[] = [];
  let sequence = 0;
  const recordFor = (residentId: string, kind: DataRecordKind) => records.find((item) => item.subjectId === residentId && item.kind === kind && !item.forged);

  for (const caseState of input.health.cases.filter((item) => item.status === "waiting" || item.status === "admitted").slice(0, 18)) {
    const facility = input.health.facilities.find((item) => item.id === caseState.facilityId);
    if (!facility) continue;
    for (const kind of ["civil-identity", "medical", "insurance"] as const) {
      const access = requestAccess(input.seed, dayIndex, grants, facility.ownerOrganizationId, recordFor(caseState.residentId, kind), kind === "insurance" ? "insurance" : "care", sequence++, undefined, caseState.id);
      if (access) events.push(access);
    }
  }

  for (const application of input.population.laborMarket.applications.filter((item) => item.submittedDay >= dayIndex - 1 && item.status === "submitted").slice(0, 20)) {
    const vacancy = input.population.laborMarket.vacancies.find((item) => item.id === application.vacancyId);
    const business = input.economy.businesses.find((item) => item.id === vacancy?.businessId);
    const actor = vacancy?.organizationId ?? business?.organizationId ?? business?.id;
    if (!actor) continue;
    for (const kind of ["civil-identity", "employment", "education", "credit"] as const) {
      const access = requestAccess(input.seed, dayIndex, grants, actor, recordFor(application.residentId, kind), "employment-screening", sequence++);
      if (access) events.push(access);
    }
  }

  const police = policeId(input);
  for (const caseState of input.government.cases.filter((item) => item.status === "open" || item.status === "investigating" || item.status === "charged").slice(0, 12)) {
    const network = input.government.crimeNetworks.find((item) => item.id === caseState.networkId);
    const subjectId = caseState.detainedResidentIds[0] ?? network?.memberResidentIds[0];
    if (!subjectId) continue;
    for (const kind of ["civil-identity", "address", "criminal", "access-log"] as const) {
      const access = requestAccess(input.seed, dayIndex, grants, police, recordFor(subjectId, kind), "investigation", sequence++, undefined, caseState.id);
      if (access) events.push(access);
    }
  }

  const authority = authorityId(input);
  const taxTargets = input.population.residents.filter((item) => item.lifeStage === "working-age").slice(dayIndex % 11, dayIndex % 11 + 8);
  for (const resident of taxTargets) {
    const access = requestAccess(input.seed, dayIndex, grants, authority, recordFor(resident.id, "tax"), "tax", sequence++);
    if (access) events.push(access);
  }

  const unauthorizedActors = input.organizations.filter((item) => item.type === "independent" || item.type === "gang").slice(0, 2);
  const unauthorizedTargets = input.population.residents.slice(dayIndex % 17, dayIndex % 17 + unauthorizedActors.length);
  for (let index = 0; index < unauthorizedActors.length; index += 1) {
    const actor = unauthorizedActors[index];
    const resident = unauthorizedTargets[index];
    if (!resident) continue;
    const kind: DataRecordKind = actor.type === "gang" ? "medical" : "credit";
    const purpose: DataPurpose = actor.type === "gang" ? "illegal-sale" : "commercial-analysis";
    const access = requestAccess(input.seed, dayIndex, grants, actor.id, recordFor(resident.id, kind), purpose, sequence++);
    if (access) events.push(access);
  }

  return events;
}

function generateObservations(
  state: DataSurveillanceState,
  input: DataAdvanceInput,
  nodes: SurveillanceNodeState[],
  dayIndex: number
): { nodes: SurveillanceNodeState[]; observations: SurveillanceObservationState[]; captures: number } {
  const observations: SurveillanceObservationState[] = [];
  let captures = 0;
  const nextNodes = nodes.map((node) => {
    if (node.status === "offline") return node;
    const local = input.population.residents.filter((item) => item.districtId === node.districtId);
    if (!local.length) return node;
    const rng = new SeededRandom(`${input.seed}:surveillance:${dayIndex}:${node.id}`);
    const captureCount = Math.max(0, Math.round(local.length * node.coverage / 100 * node.quality / 100 * (node.status === "degraded" ? 0.55 : 1)));
    const subjects: string[] = [];
    const pool = [...local];
    const sampleCount = Math.min(6, captureCount, pool.length);
    while (subjects.length < sampleCount && pool.length) {
      const picked = rng.pick(pool);
      subjects.push(picked.id);
      pool.splice(pool.indexOf(picked), 1);
    }
    if (captureCount > 0) observations.push({
      id: createStableEntityId("observation", `${input.seed}:${dayIndex}:${node.id}`),
      dayIndex,
      nodeId: node.id,
      ownerEntityId: node.ownerEntityId,
      districtId: node.districtId,
      subjectIds: subjects,
      quality: node.quality,
      retainedUntilDay: dayIndex + node.retentionDays,
      accessedByIds: [node.ownerEntityId],
      compromised: node.status === "compromised"
    });
    captures += captureCount;
    return { ...node, capturesToday: captureCount, recordsGenerated: node.recordsGenerated + (captureCount > 0 ? 1 : 0) };
  });
  return { nodes: nextNodes, observations, captures };
}

function caseForBreach(input: DataAdvanceInput, breach: DataBreachState, dayIndex: number): EnforcementCaseState {
  const network = input.government.crimeNetworks[0];
  return {
    id: createStableEntityId("enforcement-case", `${input.seed}:data-breach:${breach.id}`),
    districtId: breach.districtId,
    networkId: network?.id ?? breach.attackerEntityId ?? policeId(input),
    kind: "cybercrime",
    status: "open",
    evidence: breach.evidence,
    priority: Math.round(clamp(35 + breach.severity * 0.6)),
    openedAt: dayIndex * DAY_MS,
    updatedAt: dayIndex * DAY_MS,
    assignedOfficerIds: [],
    detainedResidentIds: [],
    seizedCredits: 0,
    arrests: 0
  };
}

function advanceBreaches(
  state: DataSurveillanceState,
  input: DataAdvanceInput,
  records: DataRecordState[],
  identities: DigitalIdentityState[],
  nodes: SurveillanceNodeState[],
  dayIndex: number,
  notices: DataNotice[],
  transactions: KernelTransactionDraft[]
): { breaches: DataBreachState[]; records: DataRecordState[]; identities: DigitalIdentityState[]; organizations: DataAdvanceInput["organizations"]; government: GovernmentCrimeState; nodes: SurveillanceNodeState[]; totals: Partial<DataSurveillanceTotals> } {
  let breaches = state.breaches.map((item) => ({ ...item, recordIds: [...item.recordIds] }));
  let nextRecords = records.map((item) => ({ ...item }));
  let nextIdentities = identities.map((item) => ({ ...item, aliases: [...item.aliases] }));
  let organizations = input.organizations.map((item) => ({ ...item }));
  let government: GovernmentCrimeState = { ...input.government, crimeNetworks: input.government.crimeNetworks.map((item) => ({ ...item, memberResidentIds: [...item.memberResidentIds], influenceByDistrict: { ...item.influenceByDistrict }, operations: item.operations.map((op) => ({ ...op })) })), cases: input.government.cases.map((item) => ({ ...item, assignedOfficerIds: [...item.assignedOfficerIds], detainedResidentIds: [...item.detainedResidentIds] })) };
  let nextNodes = nodes.map((item) => ({ ...item }));
  const totals: Partial<DataSurveillanceTotals> = { breaches: 0, recordsStolen: 0, breachesContained: 0, dataSales: 0, dataSaleRevenue: 0 };

  for (const breach of breaches) {
    if (breach.status === "active") {
      const law = government.districts.find((item) => item.districtId === breach.districtId);
      const discoveryChance = clamp((law?.policeReadiness ?? 40) * 0.004 + serviceLevel(input, breach.districtId, "data") * 0.0025 + breach.evidence * 0.002, 0.03, 0.72);
      const rng = new SeededRandom(`${input.seed}:breach-progress:${dayIndex}:${breach.id}`);
      if (!breach.discoveredDay && rng.chance(discoveryChance)) {
        breach.discoveredDay = dayIndex;
        breach.evidence = clamp(breach.evidence + 22);
        if (!government.cases.some((item) => item.id === createStableEntityId("enforcement-case", `${input.seed}:data-breach:${breach.id}`))) {
          government.cases.push(caseForBreach(input, breach, dayIndex));
        }
      }
      const network = government.crimeNetworks.find((item) => item.organizationId === breach.attackerEntityId) ?? government.crimeNetworks[0];
      if (network && dayIndex - breach.startedDay >= 2 && breach.status === "active" && rng.chance(0.38)) {
        breach.status = "sold";
        network.treasury += breach.marketValue;
        government = { ...government, crimeNetworks: government.crimeNetworks.map((item) => item.id === network.id ? { ...network } : item) };
        organizations = organizations.map((item) => item.id === network.organizationId ? { ...item, budget: item.budget + breach.marketValue } : item);
        transactions.push({
          idempotencyKey: `${input.seed}:data-sale:${dayIndex}:${breach.id}`,
          timestamp: dayIndex * DAY_MS,
          debitEntityId: kernelSystemEntityId(input.seed, "illegal-consumption"),
          creditEntityId: network.organizationId,
          resource: "credits",
          amount: breach.marketValue,
          reason: "data-sale",
          description: `Stolen data package sold through an unregistered market.`
        });
        totals.dataSales = (totals.dataSales ?? 0) + 1;
        totals.dataSaleRevenue = (totals.dataSaleRevenue ?? 0) + breach.marketValue;
      }
      if (breach.discoveredDay && dayIndex - breach.discoveredDay >= 2 && rng.chance(clamp((law?.policeReadiness ?? 40) / 125 + serviceLevel(input, breach.districtId, "data") / 180, 0.15, 0.86))) {
        breach.status = "contained";
        breach.containedDay = dayIndex;
        totals.breachesContained = (totals.breachesContained ?? 0) + 1;
      }
    }
  }

  const candidateNodes = nextNodes.filter((item) => item.status !== "offline" && item.vulnerability >= 34);
  for (const node of candidateNodes) {
    const law = government.districts.find((item) => item.districtId === node.districtId);
    const crime = (law?.cyberCrime ?? 35) / 100;
    const rng = new SeededRandom(`${input.seed}:breach-start:${dayIndex}:${node.id}`);
    const risk = clamp(node.vulnerability / 100 * crime * (node.status === "degraded" ? 0.015 : 0.006), 0, 0.035);
    if (!rng.chance(risk) || breaches.some((item) => item.sourceEntityId === node.ownerEntityId && item.status === "active")) continue;
    const available = nextRecords.filter((item) => item.ownerEntityId === node.ownerEntityId || item.districtId === node.districtId)
      .filter((item) => !item.forged)
      .slice()
      .sort((a, b) => b.value - a.value);
    if (!available.length) continue;
    const stolen = available.slice(0, Math.min(30, Math.max(4, Math.round(node.vulnerability / 4))));
    const network = government.crimeNetworks[0];
    const breach: DataBreachState = {
      id: createStableEntityId("data-breach", `${input.seed}:${dayIndex}:${node.id}`),
      sourceEntityId: node.ownerEntityId,
      attackerEntityId: network?.organizationId,
      districtId: node.districtId,
      recordIds: stolen.map((item) => item.id),
      status: "active",
      startedDay: dayIndex,
      severity: Math.round(clamp(node.vulnerability * 0.7 + stolen.length, 10, 100)),
      stolenRecords: stolen.length,
      marketValue: Math.max(40, stolen.reduce((sum, item) => sum + item.value, 0)),
      evidence: Math.round(clamp(node.quality * 0.35 - node.vulnerability * 0.12 + 18))
    };
    breaches.push(breach);
    nextRecords = nextRecords.map((item) => breach.recordIds.includes(item.id) ? { ...item, compromised: true } : item);
    const compromisedSubjects = new Set(stolen.map((item) => item.subjectId));
    nextIdentities = nextIdentities.map((identity) => compromisedSubjects.has(identity.residentId)
      ? { ...identity, status: identity.status === "suspended" ? identity.status : "compromised", fraudRisk: clamp(identity.fraudRisk + 20), compromiseCount: identity.compromiseCount + 1 }
      : identity);
    nextNodes = nextNodes.map((item) => item.id === node.id ? { ...item, status: "compromised" } : item);
    totals.breaches = (totals.breaches ?? 0) + 1;
    totals.recordsStolen = (totals.recordsStolen ?? 0) + stolen.length;
    notices.push({ districtId: node.districtId, title: "Обнаружен взлом городского узла данных.", detail: `${stolen.length} записей · владелец ${node.ownerEntityId} · уязвимость ${node.vulnerability}%.`, importance: breach.severity >= 70 ? 3 : 2 });
    if (totals.breaches && totals.breaches >= 2) break;
  }

  return { breaches: breaches.slice(-MAX_BREACHES), records: nextRecords, identities: nextIdentities, organizations, government, nodes: nextNodes, totals };
}

function advanceForgeries(
  state: DataSurveillanceState,
  input: DataAdvanceInput,
  identities: DigitalIdentityState[],
  records: DataRecordState[],
  government: GovernmentCrimeState,
  dayIndex: number,
  notices: DataNotice[],
  transactions: KernelTransactionDraft[]
): { forgeries: IdentityForgeryState[]; identities: DigitalIdentityState[]; records: DataRecordState[]; organizations: DataAdvanceInput["organizations"]; population: PopulationState; government: GovernmentCrimeState; totals: Partial<DataSurveillanceTotals> } {
  let forgeries = state.forgeries.map((item) => ({ ...item, recordIds: [...item.recordIds] }));
  let nextIdentities = identities.map((item) => ({ ...item, aliases: [...item.aliases] }));
  let nextRecords = records.map((item) => ({ ...item }));
  let organizations = input.organizations.map((item) => ({ ...item }));
  let population: PopulationState = { ...input.population, residents: input.population.residents.map((item) => ({ ...item })), households: input.population.households.map((item) => ({ ...item, pantry: item.pantry.map((entry) => ({ ...entry })) })) };
  let nextGovernment = government;
  const totals: Partial<DataSurveillanceTotals> = { forgeriesCreated: 0, forgeriesDetected: 0, identitiesSuspended: 0 };
  const network = nextGovernment.crimeNetworks[0];
  if (!network) return { forgeries, identities: nextIdentities, records: nextRecords, organizations, population, government: nextGovernment, totals };

  for (const forgery of forgeries.filter((item) => item.status === "active")) {
    const resident = population.residents.find((item) => item.id === forgery.residentId);
    if (!resident) {
      forgery.status = "retired";
      continue;
    }
    const law = nextGovernment.districts.find((item) => item.districtId === resident.districtId);
    const scanLevel = serviceLevel(input, resident.districtId, "data") * 0.45 + (law?.patrolCoverage ?? 30) * 0.35 + (law?.policeReadiness ?? 30) * 0.2;
    const rng = new SeededRandom(`${input.seed}:forgery-detect:${dayIndex}:${forgery.id}`);
    const risk = clamp((scanLevel - forgery.quality) / 650 + 0.008, 0.003, 0.18);
    if (!rng.chance(risk)) continue;
    forgery.status = "detected";
    forgery.detectedDay = dayIndex;
    nextIdentities = nextIdentities.map((item) => item.residentId === forgery.residentId ? { ...item, status: "suspended", digitalAccess: 0, fraudRisk: clamp(item.fraudRisk + 30) } : item);
    population = { ...population, residents: population.residents.map((item) => item.id === forgery.residentId ? { ...item, identityStatus: "suspended", digitalAccess: 0 } : item) };
    totals.forgeriesDetected = (totals.forgeriesDetected ?? 0) + 1;
    totals.identitiesSuspended = (totals.identitiesSuspended ?? 0) + 1;
    const caseId = createStableEntityId("enforcement-case", `${input.seed}:forgery:${forgery.id}`);
    if (!nextGovernment.cases.some((item) => item.id === caseId)) {
      nextGovernment = { ...nextGovernment, cases: [...nextGovernment.cases, {
        id: caseId,
        districtId: resident.districtId,
        networkId: network.id,
        kind: "cybercrime",
        status: "open",
        evidence: Math.round(clamp(70 - forgery.quality * 0.3)),
        priority: 54,
        openedAt: dayIndex * DAY_MS,
        updatedAt: dayIndex * DAY_MS,
        assignedOfficerIds: [],
        detainedResidentIds: [],
        seizedCredits: 0,
        arrests: 0
      }] };
    }
    notices.push({ districtId: resident.districtId, residentId: resident.id, title: "Поддельная цифровая личность обнаружена.", detail: `${forgery.alias} · качество ${forgery.quality}% · профиль приостановлен.`, importance: 3 });
  }

  const candidates = nextIdentities.filter((identity) => identity.status !== "suspended" && identity.status !== "forged" && identity.creditScore < 510 && identity.digitalAccess < 55)
    .filter((identity) => !forgeries.some((item) => item.residentId === identity.residentId && item.status === "active"));
  for (const identity of candidates) {
    const resident = population.residents.find((item) => item.id === identity.residentId);
    const household = resident ? population.households.find((item) => item.id === resident.householdId) : undefined;
    if (!resident || !household || household.debt < 300) continue;
    const law = nextGovernment.districts.find((item) => item.districtId === resident.districtId);
    const rng = new SeededRandom(`${input.seed}:forgery-create:${dayIndex}:${resident.id}`);
    const risk = clamp(((law?.cyberCrime ?? 35) + (network.influenceByDistrict[resident.districtId] ?? 25)) / 45_000, 0.0004, 0.008);
    if (!rng.chance(risk)) continue;
    const alias = `${rng.pick(ALIAS_FIRST)} ${rng.pick(ALIAS_LAST)}`;
    const quality = rng.integer(42, 88);
    const price = Math.round(120 + quality * 4.2);
    const paid = Math.min(price, Math.max(0, household.balance - 80));
    population = { ...population, households: population.households.map((item) => item.id === household.id ? { ...item, balance: item.balance - paid, debt: item.debt + Math.max(0, price - paid) } : item) };
    nextGovernment = { ...nextGovernment, crimeNetworks: nextGovernment.crimeNetworks.map((item) => item.id === network.id ? { ...item, treasury: item.treasury + paid } : item) };
    organizations = organizations.map((item) => item.id === network.organizationId ? { ...item, budget: item.budget + paid } : item);
    if (paid > 0) transactions.push({
      idempotencyKey: `${input.seed}:identity-forgery:${dayIndex}:${resident.id}`,
      timestamp: dayIndex * DAY_MS,
      debitEntityId: household.id,
      creditEntityId: network.organizationId,
      resource: "credits",
      amount: paid,
      reason: "identity-forgery",
      description: `Payment for a forged digital identity.`
    });
    const forgeryId = createStableEntityId("identity-forgery", `${input.seed}:${dayIndex}:${resident.id}`);
    const forgedRecordKinds: DataRecordKind[] = ["civil-identity", "address", "credit"];
    const forgedRecords = forgedRecordKinds.map((kind) => ({
      id: createStableEntityId("data-record", `${forgeryId}:${kind}`),
      subjectId: resident.id,
      kind,
      ownerEntityId: network.organizationId,
      sourceEntityId: network.organizationId,
      districtId: resident.districtId,
      sensitivity: "confidential" as const,
      truthScore: quality,
      createdDay: dayIndex,
      updatedDay: dayIndex,
      retentionUntilDay: dayIndex + 730,
      compromised: false,
      forged: true,
      summary: `${alias} · FORGED ${kind.replace(/-/g, " ").toUpperCase()}`,
      value: Math.round(price / 3)
    }));
    nextRecords.push(...forgedRecords);
    forgeries.push({ id: forgeryId, residentId: resident.id, issuerEntityId: network.organizationId, alias, quality, createdDay: dayIndex, status: "active", recordIds: forgedRecords.map((item) => item.id), price });
    nextIdentities = nextIdentities.map((item) => item.residentId === resident.id ? { ...item, status: "forged", aliases: [...new Set([...item.aliases, alias])], fraudRisk: clamp(item.fraudRisk + 35) } : item);
    population = { ...population, residents: population.residents.map((item) => item.id === resident.id ? { ...item, identityStatus: "forged", digitalAccess: Math.max(item.digitalAccess ?? 0, Math.round(quality * 0.72)), creditScore: identity.creditScore } : item) };
    totals.forgeriesCreated = (totals.forgeriesCreated ?? 0) + 1;
    notices.push({ districtId: resident.districtId, residentId: resident.id, title: "На подпольном рынке создан новый цифровой профиль.", detail: `${alias} · качество ${quality}% · цена ₵${price}.`, importance: 2 });
    if ((totals.forgeriesCreated ?? 0) >= 2) break;
  }

  return { forgeries: forgeries.slice(-MAX_FORGERIES), identities: nextIdentities, records: nextRecords.slice(-8_000), organizations, population, government: nextGovernment, totals };
}

function applyIdentityFields(population: PopulationState, identities: DigitalIdentityState[]): PopulationState {
  const byResident = new Map(identities.map((item) => [item.residentId, item]));
  return {
    ...population,
    residents: population.residents.map((resident) => {
      const identity = byResident.get(resident.id);
      return identity ? { ...resident, creditScore: identity.creditScore, digitalAccess: identity.digitalAccess, identityStatus: identity.status } : resident;
    })
  };
}

function addTotals(base: DataSurveillanceTotals, delta: Partial<DataSurveillanceTotals>): DataSurveillanceTotals {
  const result = { ...base };
  for (const [key, value] of Object.entries(delta) as [keyof DataSurveillanceTotals, number][]) result[key] += value ?? 0;
  return result;
}

function snapshot(dayIndex: number, state: Pick<DataSurveillanceState, "identities" | "nodes" | "accessEvents" | "breaches" | "forgeries">): DataDailySnapshot {
  const accesses = state.accessEvents.filter((item) => item.dayIndex === dayIndex);
  return {
    dayIndex,
    verifiedIdentities: state.identities.filter((item) => item.status === "verified").length,
    limitedIdentities: state.identities.filter((item) => item.status === "limited" || item.status === "suspended").length,
    compromisedIdentities: state.identities.filter((item) => item.status === "compromised" || item.status === "forged").length,
    activeNodes: state.nodes.filter((item) => item.status === "online" || item.status === "degraded").length,
    offlineNodes: state.nodes.filter((item) => item.status === "offline").length,
    accesses: accesses.length,
    deniedAccesses: accesses.filter((item) => item.outcome === "denied").length,
    activeBreaches: state.breaches.filter((item) => item.status === "active").length,
    activeForgeries: state.forgeries.filter((item) => item.status === "active").length,
    averageCreditScore: state.identities.length ? Math.round(state.identities.reduce((sum, item) => sum + item.creditScore, 0) / state.identities.length) : 0
  };
}

export function createDataSurveillanceState(input: DataAdvanceInput): DataSurveillanceState {
  const dayIndex = Math.floor(input.timestamp / DAY_MS);
  const empty: DataSurveillanceState = {
    version: 1,
    identities: [],
    records: [],
    grants: [],
    accessEvents: [],
    nodes: [],
    observations: [],
    breaches: [],
    forgeries: [],
    history: [],
    totals: emptyTotals(),
    dayIndex,
    simulatedDays: 0,
    lastUpdatedAt: input.timestamp
  };
  const synced = syncIdentitiesAndRecords(empty, input, dayIndex);
  const nodes = syncNodes(empty, input, dayIndex);
  const grants = createGrants(input, dayIndex);
  const identities = synced.identities;
  const base = { ...empty, identities, records: synced.records, nodes, grants, totals: { ...empty.totals, recordsCreated: synced.created } };
  return { ...base, history: [snapshot(dayIndex, base)] };
}

export function normalizeDataSurveillanceState(value: unknown, input: DataAdvanceInput): DataSurveillanceState {
  if (!value || typeof value !== "object") return createDataSurveillanceState(input);
  const raw = value as Partial<DataSurveillanceState>;
  if (raw.version !== 1 || !Array.isArray(raw.identities) || !Array.isArray(raw.records)) return createDataSurveillanceState(input);
  return {
    version: 1,
    identities: raw.identities,
    records: raw.records,
    grants: Array.isArray(raw.grants) ? raw.grants : [],
    accessEvents: Array.isArray(raw.accessEvents) ? raw.accessEvents : [],
    nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
    observations: Array.isArray(raw.observations) ? raw.observations : [],
    breaches: Array.isArray(raw.breaches) ? raw.breaches : [],
    forgeries: Array.isArray(raw.forgeries) ? raw.forgeries : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    totals: raw.totals ?? emptyTotals(),
    dayIndex: typeof raw.dayIndex === "number" ? raw.dayIndex : Math.floor(input.timestamp / DAY_MS),
    simulatedDays: typeof raw.simulatedDays === "number" ? raw.simulatedDays : 0,
    lastUpdatedAt: typeof raw.lastUpdatedAt === "number" ? raw.lastUpdatedAt : input.timestamp
  };
}

export function advanceDataSurveillance(state: DataSurveillanceState, input: DataAdvanceInput): DataAdvanceResult {
  if (input.timestamp <= state.lastUpdatedAt) return { state, organizations: input.organizations, population: input.population, government: input.government, notices: [], transactions: [] };
  const targetDay = Math.floor(input.timestamp / DAY_MS);
  let dayIndex = Math.max(state.dayIndex, Math.floor(state.lastUpdatedAt / DAY_MS));
  let current = normalizeDataSurveillanceState(state, input);
  let organizations = input.organizations;
  let population = input.population;
  let government = input.government;
  const notices: DataNotice[] = [];
  const transactions: KernelTransactionDraft[] = [];

  while (dayIndex < targetDay) {
    dayIndex += 1;
    const dayInput: DataAdvanceInput = { ...input, organizations, population, government };
    const synced = syncIdentitiesAndRecords(current, dayInput, dayIndex);
    let identities = synced.identities;
    let records = synced.records;
    const grants = createGrants(dayInput, dayIndex);
    let nodes = syncNodes(current, dayInput, dayIndex);
    const generatedAccesses = generateAccesses(current, dayInput, records, grants, dayIndex);
    const observed = generateObservations(current, dayInput, nodes, dayIndex);
    nodes = observed.nodes;

    const breaches = advanceBreaches(current, dayInput, records, identities, nodes, dayIndex, notices, transactions);
    records = breaches.records;
    identities = breaches.identities;
    organizations = breaches.organizations;
    government = breaches.government;
    nodes = breaches.nodes;

    const forgeries = advanceForgeries(current, { ...dayInput, organizations, government }, identities, records, government, dayIndex, notices, transactions);
    identities = forgeries.identities;
    records = forgeries.records;
    organizations = forgeries.organizations;
    population = applyIdentityFields(forgeries.population, identities);
    government = forgeries.government;

    const accessEvents = [...current.accessEvents, ...generatedAccesses].slice(-MAX_ACCESS_EVENTS);
    const observations = [...current.observations.filter((item) => item.retainedUntilDay >= dayIndex), ...observed.observations].slice(-MAX_OBSERVATIONS);
    let totals = addTotals(current.totals, {
      recordsCreated: synced.created,
      accesses: generatedAccesses.length,
      deniedAccesses: generatedAccesses.filter((item) => item.outcome === "denied").length,
      surveillanceCaptures: observed.captures,
      ...breaches.totals,
      ...forgeries.totals
    });
    current = {
      ...current,
      identities,
      records,
      grants,
      accessEvents,
      nodes,
      observations,
      breaches: breaches.breaches,
      forgeries: forgeries.forgeries,
      totals,
      dayIndex,
      simulatedDays: current.simulatedDays + 1,
      lastUpdatedAt: dayIndex * DAY_MS
    };
    current = { ...current, history: [...current.history, snapshot(dayIndex, current)].slice(-180) };
  }

  return { state: { ...current, lastUpdatedAt: input.timestamp }, organizations, population, government, notices, transactions };
}
