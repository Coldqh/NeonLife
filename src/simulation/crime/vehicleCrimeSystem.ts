import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { DataSurveillanceState, SurveillanceObservationState } from "../data/types";
import type { EnforcementCaseState, GovernmentCrimeState } from "../government/types";
import type { KernelTransactionDraft } from "../kernel/types";
import type { PopulationState } from "../population/types";
import type { OrganizationState } from "../../world/state/types";
import type { LocalSceneState } from "../localScene/types";
import type { PhysicalVehicleEntityState, PhysicalVehiclesState } from "../vehicles/types";
import type {
  VehicleCrimeActionKind,
  VehicleCrimeActionResult,
  VehicleCrimeIncidentState,
  VehicleCrimeInspectionState,
  VehicleCrimeState,
  VehicleFenceOfferState,
  VehicleInsuranceClaimState,
  VehicleWantedStatus,
  VehicleWitnessObservation,
  VehicleWitnessReportState,
  WantedVehicleState
} from "./types";

const DAY_MS = 24 * 60 * 60_000;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function emptyTotals(): VehicleCrimeState["totals"] {
  return {
    inspections: 0,
    breakInAttempts: 0,
    forcedEntries: 0,
    hotwireAttempts: 0,
    vehiclesStolen: 0,
    alarmsTriggered: 0,
    witnessReports: 0,
    cameraCaptures: 0,
    casesOpened: 0,
    vehiclesReplated: 0,
    vehiclesStripped: 0,
    vehiclesFenced: 0,
    cabinLootTaken: 0,
    creditsEarned: 0,
    insuranceClaimsPaid: 0,
    insuranceCreditsPaid: 0
  };
}

export function createVehicleCrimeState(timestamp: number): VehicleCrimeState {
  return {
    version: 1,
    inspections: [],
    incidents: [],
    witnessReports: [],
    wantedVehicles: [],
    fenceOffers: [],
    insuranceClaims: [],
    stolenVehicleIds: [],
    playerHeat: 0,
    totals: emptyTotals(),
    lastUpdatedAt: timestamp
  };
}

export function normalizeVehicleCrimeState(value: unknown, timestamp: number): VehicleCrimeState {
  if (!value || typeof value !== "object") return createVehicleCrimeState(timestamp);
  const raw = value as Partial<VehicleCrimeState>;
  if (raw.version !== 1) return createVehicleCrimeState(timestamp);
  return {
    version: 1,
    inspections: Array.isArray(raw.inspections) ? raw.inspections : [],
    incidents: Array.isArray(raw.incidents) ? raw.incidents : [],
    witnessReports: Array.isArray(raw.witnessReports) ? raw.witnessReports : [],
    wantedVehicles: Array.isArray(raw.wantedVehicles) ? raw.wantedVehicles : [],
    fenceOffers: Array.isArray(raw.fenceOffers) ? raw.fenceOffers : [],
    insuranceClaims: Array.isArray(raw.insuranceClaims) ? raw.insuranceClaims : [],
    stolenVehicleIds: Array.isArray(raw.stolenVehicleIds) ? raw.stolenVehicleIds : [],
    playerHeat: typeof raw.playerHeat === "number" ? clamp(raw.playerHeat) : 0,
    totals: { ...emptyTotals(), ...(raw.totals ?? {}) },
    lastUpdatedAt: typeof raw.lastUpdatedAt === "number" ? raw.lastUpdatedAt : timestamp
  };
}

function parkingSecurity(vehicles: PhysicalVehiclesState, vehicle: PhysicalVehicleEntityState): number {
  return vehicles.parkingNodes.find((node) => node.id === vehicle.position.parkingNodeId)?.security ?? 38;
}

function nearbyCameraRisk(data: DataSurveillanceState, districtId: string): number {
  const nodes = data.nodes.filter((node) => node.districtId === districtId && node.kind === "camera" && node.status !== "offline");
  if (!nodes.length) return 0;
  return clamp(nodes.reduce((sum, node) => sum + node.coverage * node.quality * (node.status === "online" ? 1 : 0.55), 0) / nodes.length / 100);
}

export function inspectVehicleCrimeOpportunity(
  state: VehicleCrimeState,
  input: { timestamp: number; seed: string; vehicle: PhysicalVehicleEntityState; vehicles: PhysicalVehiclesState; localScene: LocalSceneState; data: DataSurveillanceState; districtId: string }
): { state: VehicleCrimeState; inspection: VehicleCrimeInspectionState } {
  const security = parkingSecurity(input.vehicles, input.vehicle);
  const cameraRisk = nearbyCameraRisk(input.data, input.districtId);
  const visibleWitnesses = input.localScene.actors.filter((actor) => actor.visible && actor.distanceToPlayerM <= 90 && actor.position.state === "outside").length;
  const rng = new SeededRandom(`${input.seed}:vehicle-inspection:${input.vehicle.id}:${Math.floor(input.timestamp / 60_000)}`);
  const inspection: VehicleCrimeInspectionState = {
    vehicleId: input.vehicle.id,
    inspectedAt: input.timestamp,
    lockDifficulty: Math.round(clamp(28 + security * 0.45 + input.vehicle.condition * 0.18 + (input.vehicle.alarmed ? 10 : 0))),
    ignitionDifficulty: Math.round(clamp(24 + input.vehicle.condition * 0.28 + (input.vehicle.vehicleClass === "police" || input.vehicle.vehicleClass === "medical" ? 25 : 0))),
    alarmRisk: Math.round(clamp((input.vehicle.alarmed ? 48 : 8) + security * 0.24 + rng.integer(-6, 8))),
    cameraRisk: Math.round(clamp(cameraRisk + security * 0.18)),
    witnessRisk: Math.round(clamp(visibleWitnesses * 11 + rng.integer(0, 12))),
    estimatedFenceValue: Math.max(90, Math.round((input.vehicle.condition * 8 + input.vehicle.fuelL * 2 + input.vehicle.cargoCapacityKg * 0.08) * (input.vehicle.vehicleClass === "truck" ? 1.8 : input.vehicle.vehicleClass === "police" ? 0.45 : 1))),
    cabinLootValue: Math.max(0, input.vehicle.cabinLootCredits ?? 0)
  };
  return {
    inspection,
    state: {
      ...state,
      inspections: [inspection, ...state.inspections.filter((item) => item.vehicleId !== input.vehicle.id)].slice(0, 120),
      totals: { ...state.totals, inspections: state.totals.inspections + 1 },
      lastUpdatedAt: input.timestamp
    }
  };
}

function witnessObservation(action: VehicleCrimeActionKind, alarm: boolean): VehicleWitnessObservation {
  if (alarm) return "alarm";
  if (action === "break-in") return "forced-entry";
  if (action === "hotwire") return "driver-departure";
  if (action === "replate") return "plate-change";
  if (action === "strip" || action === "fence") return "vehicle-strip";
  return "tampering";
}

function materializeWitnessReports(
  input: { timestamp: number; seed: string; playerId: string; localScene: LocalSceneState },
  incidentId: string,
  action: VehicleCrimeActionKind,
  alarm: boolean
): VehicleWitnessReportState[] {
  const candidates = input.localScene.actors
    .filter((actor) => actor.visible && actor.position.state === "outside" && actor.distanceToPlayerM <= (alarm ? 130 : 70))
    .sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM)
    .slice(0, 8);
  return candidates.flatMap((actor, index) => {
    const rng = new SeededRandom(`${input.seed}:vehicle-witness:${incidentId}:${actor.id}`);
    const noticeChance = clamp((alarm ? 70 : 24) + (100 - actor.distanceToPlayerM) * 0.45 + actor.representedWeight / 500, 8, 96) / 100;
    if (!rng.chance(noticeChance)) return [];
    const confidence = Math.round(clamp(88 - actor.distanceToPlayerM * 0.48 + rng.integer(-12, 10)));
    const recognizedPlayer = actor.knownToPlayer || confidence >= 74 && actor.distanceToPlayerM <= 28;
    return [{
      id: createStableEntityId("vehicle-witness-report", `${incidentId}:${actor.id}:${index}`),
      incidentId,
      witnessActorId: actor.id,
      residentId: actor.source === "detailed" ? actor.residentId : undefined,
      name: actor.name,
      observation: witnessObservation(action, alarm),
      confidence,
      recognizedPlayer,
      sawPlate: confidence >= 48,
      reported: false,
      reportDueAt: input.timestamp + rng.integer(alarm ? 1 : 4, alarm ? 8 : 30) * 60_000
    }];
  });
}

function cameraCaptures(
  input: { timestamp: number; seed: string; playerId: string; vehicle: PhysicalVehicleEntityState; data: DataSurveillanceState; districtId: string },
  incidentId: string
): SurveillanceObservationState[] {
  const dayIndex = Math.floor(input.timestamp / DAY_MS);
  return input.data.nodes
    .filter((node) => node.districtId === input.districtId && node.kind === "camera" && node.status !== "offline" && node.powerServiceLevel >= 20 && node.dataServiceLevel >= 20)
    .slice(0, 4)
    .flatMap((node, index) => {
      const rng = new SeededRandom(`${input.seed}:vehicle-camera:${incidentId}:${node.id}`);
      const chance = clamp(node.coverage * 0.48 + node.quality * 0.34 + node.powerServiceLevel * 0.08 - node.vulnerability * 0.18, 4, 92) / 100;
      if (!rng.chance(chance)) return [];
      return [{
        id: createStableEntityId("surveillance-observation", `${incidentId}:${node.id}:${index}`),
        dayIndex,
        nodeId: node.id,
        ownerEntityId: node.ownerEntityId,
        districtId: node.districtId,
        subjectIds: [input.playerId],
        vehicleIds: [input.vehicle.id],
        eventKind: "vehicle-theft" as const,
        observedPlate: input.vehicle.plate,
        quality: Math.round(clamp(node.quality + rng.integer(-8, 6))),
        retainedUntilDay: dayIndex + node.retentionDays,
        accessedByIds: [],
        compromised: node.status === "compromised"
      }];
    });
}

export function attemptVehicleCrimeAction(
  state: VehicleCrimeState,
  input: {
    timestamp: number;
    seed: string;
    playerId: string;
    action: "break-in" | "hotwire";
    vehicle: PhysicalVehicleEntityState;
    vehicles: PhysicalVehiclesState;
    localScene: LocalSceneState;
    data: DataSurveillanceState;
    districtId: string;
  }
): VehicleCrimeActionResult & { observations: SurveillanceObservationState[] } {
  const inspection = state.inspections.find((item) => item.vehicleId === input.vehicle.id)
    ?? inspectVehicleCrimeOpportunity(state, input).inspection;
  const minute = Math.floor(input.timestamp / 60_000);
  const rng = new SeededRandom(`${input.seed}:vehicle-crime:${input.action}:${input.vehicle.id}:${minute}:${state.incidents.length}`);
  const difficulty = input.action === "break-in" ? inspection.lockDifficulty : inspection.ignitionDifficulty;
  const baseCapability = input.action === "break-in" ? 48 : 43;
  const success = rng.integer(1, 100) + baseCapability >= difficulty + 34;
  const alarmChance = clamp(inspection.alarmRisk + (success ? -10 : 18), 0, 96) / 100;
  const alarmTriggered = input.vehicle.alarmed && rng.chance(alarmChance);
  const incidentId = createStableEntityId("vehicle-crime-incident", `${input.seed}:${input.vehicle.id}:${input.action}:${input.timestamp}:${state.incidents.length}`);
  const witnesses = materializeWitnessReports(input, incidentId, input.action, alarmTriggered);
  const observations = cameraCaptures(input, incidentId);
  const evidence = Math.round(clamp(
    observations.reduce((sum, item) => sum + item.quality, 0) / Math.max(1, observations.length) * 0.55
    + witnesses.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, witnesses.length) * 0.35
    + (alarmTriggered ? 22 : 4)
  ));
  const heat = Math.round(clamp((input.action === "hotwire" ? 28 : 14) + evidence * 0.42 + (alarmTriggered ? 24 : 0)));
  const ownerReportDueAt = input.action === "hotwire" && success
    ? input.timestamp + rng.integer(12, 90) * 60_000
    : undefined;
  const incident: VehicleCrimeIncidentState = {
    id: incidentId,
    vehicleId: input.vehicle.id,
    districtId: input.districtId,
    sectorId: input.vehicle.position.sectorId,
    action: input.action,
    status: alarmTriggered || witnesses.length || observations.length ? "pending-report" : "observed",
    occurredAt: input.timestamp,
    success,
    alarmTriggered,
    ownerEntityId: input.vehicle.ownerEntityId,
    originalPlate: input.vehicle.originalPlate ?? input.vehicle.plate,
    observedPlate: input.vehicle.plate,
    evidence,
    heat,
    witnessReportIds: witnesses.map((item) => item.id),
    cameraObservationIds: observations.map((item) => item.id),
    ownerReportDueAt
  };
  let wanted = state.wantedVehicles;
  let stolenVehicleIds = state.stolenVehicleIds;
  let offers = state.fenceOffers;
  if (input.action === "hotwire" && success) {
    const wantedVehicle: WantedVehicleState = {
      vehicleId: input.vehicle.id,
      incidentId,
      originalPlate: input.vehicle.originalPlate ?? input.vehicle.plate,
      currentPlate: input.vehicle.plate,
      status: "unreported",
      heat,
      evidence,
      lastSeenDistrictId: input.districtId,
      lastSeenAt: input.timestamp
    };
    wanted = [wantedVehicle, ...wanted.filter((item) => item.vehicleId !== input.vehicle.id)];
    stolenVehicleIds = [...new Set([...stolenVehicleIds, input.vehicle.id])];
    const estimated = inspection.estimatedFenceValue;
    offers = [
      { id: createStableEntityId("vehicle-fence-offer", `${incidentId}:replate`), vehicleId: input.vehicle.id, kind: "replate", amount: Math.max(120, Math.round(estimated * 0.18)), risk: clamp(heat - 14), available: true, createdAt: input.timestamp },
      { id: createStableEntityId("vehicle-fence-offer", `${incidentId}:strip`), vehicleId: input.vehicle.id, kind: "strip", amount: Math.max(90, Math.round(estimated * 0.42)), risk: clamp(heat - 26), available: true, createdAt: input.timestamp },
      { id: createStableEntityId("vehicle-fence-offer", `${incidentId}:fence`), vehicleId: input.vehicle.id, kind: "fence", amount: Math.max(140, Math.round(estimated * 0.58)), risk: clamp(heat + 8), available: true, createdAt: input.timestamp },
      ...offers.filter((item) => item.vehicleId !== input.vehicle.id)
    ];
  }
  const totals = {
    ...state.totals,
    breakInAttempts: state.totals.breakInAttempts + (input.action === "break-in" ? 1 : 0),
    forcedEntries: state.totals.forcedEntries + (input.action === "break-in" && success ? 1 : 0),
    hotwireAttempts: state.totals.hotwireAttempts + (input.action === "hotwire" ? 1 : 0),
    vehiclesStolen: state.totals.vehiclesStolen + (input.action === "hotwire" && success ? 1 : 0),
    alarmsTriggered: state.totals.alarmsTriggered + (alarmTriggered ? 1 : 0),
    cameraCaptures: state.totals.cameraCaptures + observations.length
  };
  const nextState: VehicleCrimeState = {
    ...state,
    incidents: [incident, ...state.incidents].slice(0, 240),
    witnessReports: [...witnesses, ...state.witnessReports].slice(0, 480),
    wantedVehicles: wanted,
    fenceOffers: offers,
    stolenVehicleIds,
    playerHeat: clamp(state.playerHeat + heat * 0.28),
    totals,
    lastUpdatedAt: input.timestamp
  };
  return {
    state: nextState,
    success,
    alarmTriggered,
    evidence,
    heat,
    incidentId,
    witnessCount: witnesses.length,
    cameraCount: observations.length,
    ownerReportDueAt,
    observations,
    detail: `${success ? "SUCCESS" : "FAILED"} · alarm ${alarmTriggered ? "TRIGGERED" : "quiet"} · witnesses ${witnesses.length} · cameras ${observations.length}`
  };
}

function ensureCase(government: GovernmentCrimeState, incident: VehicleCrimeIncidentState, playerId: string, timestamp: number): { government: GovernmentCrimeState; caseId: string; created: boolean } {
  const existing = government.cases.find((item) => item.subjectVehicleId === incident.vehicleId && item.status !== "closed" && item.status !== "cold");
  if (existing) return { government, caseId: existing.id, created: false };
  const networkId = government.crimeNetworks[0]?.id ?? createStableEntityId("crime-network", "unaffiliated-vehicle-crime");
  const officers = government.crimeNetworks.flatMap((network) => network.memberResidentIds).slice(0, 0);
  const caseState: EnforcementCaseState = {
    id: createStableEntityId("enforcement-case", `${incident.id}:vehicle-theft`),
    districtId: incident.districtId,
    networkId,
    kind: "vehicle-theft",
    status: incident.evidence >= 60 ? "investigating" : "open",
    evidence: incident.evidence,
    priority: clamp(incident.heat + incident.evidence * 0.4),
    openedAt: timestamp,
    updatedAt: timestamp,
    assignedOfficerIds: officers,
    detainedResidentIds: [],
    seizedCredits: 0,
    arrests: 0,
    subjectVehicleId: incident.vehicleId,
    suspectResidentIds: incident.evidence >= 72 ? [playerId] : []
  };
  const district = government.districts.find((item) => item.districtId === incident.districtId);
  return {
    caseId: caseState.id,
    created: true,
    government: {
      ...government,
      cases: [caseState, ...government.cases],
      districts: government.districts.map((item) => item.districtId === incident.districtId ? { ...item, propertyCrime: clamp(item.propertyCrime + 2), unresolvedCases: item.unresolvedCases + 1 } : item),
      totals: { ...government.totals, casesOpened: government.totals.casesOpened + 1 },
      lastUpdatedAt: timestamp
    }
  };
}

export function advanceVehicleCrimeState(
  state: VehicleCrimeState,
  input: {
    timestamp: number;
    seed: string;
    playerId: string;
    data: DataSurveillanceState;
    government: GovernmentCrimeState;
    vehicles: PhysicalVehiclesState;
    population: PopulationState;
    organizations: OrganizationState[];
  }
): {
  state: VehicleCrimeState;
  data: DataSurveillanceState;
  government: GovernmentCrimeState;
  population: PopulationState;
  organizations: OrganizationState[];
  transactions: KernelTransactionDraft[];
  newlyReported: VehicleCrimeIncidentState[];
} {
  if (input.timestamp < state.lastUpdatedAt) return { state, data: input.data, government: input.government, population: input.population, organizations: input.organizations, transactions: [], newlyReported: [] };
  let government = input.government;
  let data = input.data;
  let population = input.population;
  let organizations = input.organizations;
  const transactions: KernelTransactionDraft[] = [];
  let insuranceClaims = state.insuranceClaims;
  let witnessReports = state.witnessReports;
  let incidents = state.incidents;
  let wantedVehicles = state.wantedVehicles;
  const newlyReported: VehicleCrimeIncidentState[] = [];
  let reportCount = 0;
  let casesOpened = 0;

  witnessReports = witnessReports.map((report) => {
    if (report.reported || report.reportDueAt > input.timestamp) return report;
    reportCount += 1;
    return { ...report, reported: true, reportedAt: input.timestamp };
  });

  incidents = incidents.map((incident) => {
    if (incident.status === "reported" || incident.status === "investigating" || incident.status === "closed") return incident;
    const reports = witnessReports.filter((report) => incident.witnessReportIds.includes(report.id) && report.reported);
    const ownerDue = incident.ownerReportDueAt !== undefined && incident.ownerReportDueAt <= input.timestamp;
    const alarmReport = incident.alarmTriggered && input.timestamp - incident.occurredAt >= 2 * 60_000;
    const cameraReport = incident.cameraObservationIds.length > 0 && input.timestamp - incident.occurredAt >= 8 * 60_000;
    if (!ownerDue && !alarmReport && !cameraReport && !reports.length) return incident;
    const caseResult = ensureCase(government, incident, input.playerId, input.timestamp);
    government = caseResult.government;
    if (caseResult.created) casesOpened += 1;
    const next = { ...incident, status: incident.evidence >= 55 ? "investigating" as const : "reported" as const, reportedAt: input.timestamp, caseId: caseResult.caseId };
    newlyReported.push(next);
    const vehicle = input.vehicles.vehicles.find((item) => item.id === incident.vehicleId);
    if (incident.action === "hotwire" && incident.success && vehicle?.insured && vehicle.ownerResidentId && state.stolenVehicleIds.includes(vehicle.id) && !insuranceClaims.some((claim) => claim.vehicleId === vehicle.id)) {
      const insurer = organizations.find((organization) => organization.type === "corporation" && organization.budget >= 300)
        ?? organizations.find((organization) => organization.type === "company" && organization.budget >= 300)
        ?? organizations.find((organization) => organization.budget >= 300);
      if (insurer) {
        const amount = Math.min(insurer.budget, Math.max(300, Math.round(vehicle.insuranceValue * 0.62)));
        const claim: VehicleInsuranceClaimState = {
          id: createStableEntityId("vehicle-insurance-claim", `${incident.id}:${vehicle.ownerResidentId}`),
          vehicleId: vehicle.id,
          incidentId: incident.id,
          ownerResidentId: vehicle.ownerResidentId,
          insurerEntityId: insurer.id,
          amount,
          status: "paid",
          filedAt: input.timestamp,
          paidAt: input.timestamp
        };
        insuranceClaims = [claim, ...insuranceClaims];
        population = {
          ...population,
          residents: population.residents.map((resident) => resident.id === vehicle.ownerResidentId ? { ...resident, savings: resident.savings + amount } : resident)
        };
        organizations = organizations.map((organization) => organization.id === insurer.id ? { ...organization, budget: organization.budget - amount } : organization);
        transactions.push({
          idempotencyKey: `${input.seed}:vehicle-insurance-claim:${claim.id}`,
          timestamp: input.timestamp,
          debitEntityId: insurer.id,
          creditEntityId: vehicle.ownerResidentId,
          resource: "credits",
          amount,
          reason: "insurance-claim",
          description: `Insurance settlement for reported theft of vehicle ${vehicle.plate}.`
        });
      }
    }
    wantedVehicles = wantedVehicles.map((wanted) => wanted.vehicleId === incident.vehicleId
      ? { ...wanted, status: wanted.status === "unreported" ? "wanted" as const : wanted.status, reportedAt: input.timestamp, caseId: caseResult.caseId, heat: clamp(wanted.heat + 12) }
      : wanted);
    return next;
  });

  const observationIds = new Set(incidents.flatMap((incident) => incident.cameraObservationIds));
  data = {
    ...data,
    observations: data.observations.map((observation) => observationIds.has(observation.id)
      ? { ...observation, accessedByIds: [...new Set([...observation.accessedByIds, government.budget.authorityOrganizationId])] }
      : observation),
    lastUpdatedAt: input.timestamp
  };

  const elapsedHours = Math.max(0, (input.timestamp - state.lastUpdatedAt) / (60 * 60_000));
  const playerHeat = clamp(state.playerHeat - elapsedHours * 0.18 + newlyReported.length * 6);
  return {
    data,
    government,
    population,
    organizations,
    transactions,
    newlyReported,
    state: {
      ...state,
      incidents,
      witnessReports,
      wantedVehicles,
      insuranceClaims,
      playerHeat,
      totals: {
        ...state.totals,
        witnessReports: state.totals.witnessReports + reportCount,
        casesOpened: state.totals.casesOpened + casesOpened,
        insuranceClaimsPaid: insuranceClaims.length,
        insuranceCreditsPaid: insuranceClaims.reduce((sum, claim) => sum + (claim.status === "paid" ? claim.amount : 0), 0)
      },
      lastUpdatedAt: input.timestamp
    }
  };
}

export function recordVehicleCabinTheft(
  state: VehicleCrimeState,
  input: { timestamp: number; seed: string; playerId: string; vehicle: PhysicalVehicleEntityState; localScene: LocalSceneState; data: DataSurveillanceState; districtId: string; credits: number }
): VehicleCrimeActionResult & { observations: SurveillanceObservationState[] } {
  const incidentId = createStableEntityId("vehicle-crime-incident", `${input.seed}:${input.vehicle.id}:cabin-theft:${input.timestamp}:${state.incidents.length}`);
  const witnesses = materializeWitnessReports(input, incidentId, "cabin-theft", false);
  const observations = cameraCaptures(input, incidentId);
  const evidence = Math.round(clamp(
    observations.reduce((sum, item) => sum + item.quality, 0) / Math.max(1, observations.length) * 0.48
    + witnesses.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, witnesses.length) * 0.34
    + 6
  ));
  const heat = Math.round(clamp(8 + evidence * 0.28 + Math.min(18, input.credits / 8)));
  const incident: VehicleCrimeIncidentState = {
    id: incidentId,
    vehicleId: input.vehicle.id,
    districtId: input.districtId,
    sectorId: input.vehicle.position.sectorId,
    action: "cabin-theft",
    status: witnesses.length || observations.length ? "pending-report" : "observed",
    occurredAt: input.timestamp,
    success: true,
    alarmTriggered: false,
    ownerEntityId: input.vehicle.ownerEntityId,
    originalPlate: input.vehicle.originalPlate ?? input.vehicle.plate,
    observedPlate: input.vehicle.plate,
    evidence,
    heat,
    witnessReportIds: witnesses.map((item) => item.id),
    cameraObservationIds: observations.map((item) => item.id)
  };
  const nextState: VehicleCrimeState = {
    ...state,
    incidents: [incident, ...state.incidents].slice(0, 240),
    witnessReports: [...witnesses, ...state.witnessReports].slice(0, 480),
    playerHeat: clamp(state.playerHeat + heat * 0.2),
    totals: {
      ...state.totals,
      cabinLootTaken: state.totals.cabinLootTaken + 1,
      creditsEarned: state.totals.creditsEarned + input.credits,
      cameraCaptures: state.totals.cameraCaptures + observations.length
    },
    lastUpdatedAt: input.timestamp
  };
  return {
    state: nextState,
    success: true,
    alarmTriggered: false,
    evidence,
    heat,
    incidentId,
    witnessCount: witnesses.length,
    cameraCount: observations.length,
    observations,
    detail: `LOOTED · witnesses ${witnesses.length} · cameras ${observations.length}`
  };
}

export function appendVehicleCrimeObservations(data: DataSurveillanceState, observations: SurveillanceObservationState[], timestamp: number): DataSurveillanceState {
  if (!observations.length) return data;
  const ids = new Set(observations.map((item) => item.id));
  const nodesTouched = new Set(observations.map((item) => item.nodeId));
  return {
    ...data,
    observations: [...observations, ...data.observations.filter((item) => !ids.has(item.id))].slice(0, 5_000),
    nodes: data.nodes.map((node) => nodesTouched.has(node.id) ? { ...node, capturesToday: node.capturesToday + 1, recordsGenerated: node.recordsGenerated + 1 } : node),
    totals: { ...data.totals, surveillanceCaptures: data.totals.surveillanceCaptures + observations.length },
    lastUpdatedAt: timestamp
  };
}

export function resolveVehicleFenceAction(
  state: VehicleCrimeState,
  vehicleId: string,
  kind: "replate" | "strip" | "fence",
  timestamp: number,
  newPlate?: string
): { state: VehicleCrimeState; amount: number; status: VehicleWantedStatus } | null {
  const offer = state.fenceOffers.find((item) => item.vehicleId === vehicleId && item.kind === kind && item.available);
  const wanted = state.wantedVehicles.find((item) => item.vehicleId === vehicleId);
  if (!offer || !wanted) return null;
  const status: VehicleWantedStatus = kind === "replate" ? "replated" : kind === "strip" ? "stripped" : "fenced";
  const amount = kind === "replate" ? -offer.amount : offer.amount;
  return {
    amount,
    status,
    state: {
      ...state,
      wantedVehicles: state.wantedVehicles.map((item) => item.vehicleId === vehicleId ? { ...item, status, currentPlate: newPlate ?? item.currentPlate, heat: kind === "replate" ? clamp(item.heat - 26) : item.heat } : item),
      fenceOffers: state.fenceOffers.map((item) => item.vehicleId === vehicleId && (item.kind === kind || kind !== "replate") ? { ...item, available: false } : item),
      stolenVehicleIds: kind === "replate" ? state.stolenVehicleIds : state.stolenVehicleIds.filter((id) => id !== vehicleId),
      playerHeat: kind === "replate" ? clamp(state.playerHeat - 8) : clamp(state.playerHeat + offer.risk * 0.08),
      totals: {
        ...state.totals,
        vehiclesReplated: state.totals.vehiclesReplated + (kind === "replate" ? 1 : 0),
        vehiclesStripped: state.totals.vehiclesStripped + (kind === "strip" ? 1 : 0),
        vehiclesFenced: state.totals.vehiclesFenced + (kind === "fence" ? 1 : 0),
        creditsEarned: state.totals.creditsEarned + Math.max(0, amount)
      },
      lastUpdatedAt: timestamp
    }
  };
}

export function isVehicleStolen(state: VehicleCrimeState, vehicleId: string): boolean {
  return state.stolenVehicleIds.includes(vehicleId);
}

export function getVehicleCrimeInspection(state: VehicleCrimeState, vehicleId: string): VehicleCrimeInspectionState | null {
  return state.inspections.find((item) => item.vehicleId === vehicleId) ?? null;
}

export function getVehicleWantedState(state: VehicleCrimeState, vehicleId: string): WantedVehicleState | null {
  return state.wantedVehicles.find((item) => item.vehicleId === vehicleId) ?? null;
}


export function synchronizeVehicleCrimeStatus(state: VehicleCrimeState, vehicles: PhysicalVehiclesState): PhysicalVehiclesState {
  const wantedById = new Map(state.wantedVehicles.map((item) => [item.vehicleId, item]));
  return {
    ...vehicles,
    vehicles: vehicles.vehicles.map((vehicle) => {
      const wanted = wantedById.get(vehicle.id);
      if (!wanted) return vehicle;
      const legalStatus = wanted.status === "wanted" ? "wanted" as const
        : wanted.status === "replated" ? "replated" as const
          : wanted.status === "stripped" ? "stripped" as const
            : wanted.status === "fenced" ? "stolen" as const
              : "stolen" as const;
      return { ...vehicle, legalStatus, plate: wanted.currentPlate, originalPlate: wanted.originalPlate };
    })
  };
}
