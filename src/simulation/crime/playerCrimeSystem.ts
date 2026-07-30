import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { OrganizationState } from "../../world/state/types";
import type {
  CrimeEvidenceKind,
  GangFactionState,
  PlayerCrimeActionInput,
  PlayerCrimeAdvanceResult,
  PlayerCrimeEvidenceState,
  PlayerCrimeIncidentState,
  PlayerCrimeInput,
  PlayerCrimeState,
  PlayerCrimeTotalsState,
  PlayerWarrantState,
  PoliceResponseState,
  StolenPropertyState
} from "./playerCrimeTypes";

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function emptyTotals(): PlayerCrimeTotalsState {
  return {
    crimesCommitted: 0,
    shoplifting: 0,
    registerRobberies: 0,
    vehicleThefts: 0,
    assaults: 0,
    evidenceCreated: 0,
    reportsFiled: 0,
    policeResponses: 0,
    arrests: 0,
    finesPaid: 0,
    stolenCredits: 0
  };
}

function gangSeeds(seed: string, timestamp: number, organizations: OrganizationState[], districtIds: string[]): GangFactionState[] {
  const existing = organizations.filter((item) => item.type === "gang");
  const names = ["CUTWIRE", "RED STATIC", "MOURNING SONS"];
  return names.map((name, index) => {
    const organization = existing[index];
    const rng = new SeededRandom(`${seed}:gang-faction:${index}`);
    return {
      id: organization?.id ?? createStableEntityId("gang-faction", `${seed}:${name}`),
      organizationId: organization?.id,
      name: organization?.name ?? name,
      code: organization?.code ?? `G/${index + 1}`,
      homeDistrictId: districtIds[index % Math.max(1, districtIds.length)] ?? "district-missing",
      influence: rng.integer(24, 68),
      cash: organization?.budget ?? rng.integer(90_000, 520_000),
      hostilityToPlayer: 0,
      controlledVenueIds: [],
      rivalIds: [],
      activeMembers: organization?.employeeCount ?? rng.integer(45, 180),
      lastUpdatedAt: timestamp
    };
  }).map((gang, _index, gangs) => ({ ...gang, rivalIds: gangs.filter((item) => item.id !== gang.id).map((item) => item.id) }));
}

export function createPlayerCrimeState(input: PlayerCrimeInput): PlayerCrimeState {
  return {
    version: 1,
    incidents: [],
    evidence: [],
    warrants: [],
    stolenProperty: [],
    policeResponses: [],
    gangs: gangSeeds(input.seed, input.timestamp, input.organizations, input.districts.map((item) => item.id)),
    custody: null,
    heat: 0,
    totals: emptyTotals(),
    lastUpdatedAt: input.timestamp
  };
}

export function normalizePlayerCrimeState(value: unknown, input: PlayerCrimeInput): PlayerCrimeState {
  if (!value || typeof value !== "object") return createPlayerCrimeState(input);
  const raw = value as Partial<PlayerCrimeState>;
  if (raw.version !== 1) return createPlayerCrimeState(input);
  const fresh = createPlayerCrimeState(input);
  return {
    version: 1,
    incidents: Array.isArray(raw.incidents) ? raw.incidents : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    warrants: Array.isArray(raw.warrants) ? raw.warrants : [],
    stolenProperty: Array.isArray(raw.stolenProperty) ? raw.stolenProperty : [],
    policeResponses: Array.isArray(raw.policeResponses) ? raw.policeResponses : [],
    gangs: Array.isArray(raw.gangs) && raw.gangs.length ? raw.gangs : fresh.gangs,
    custody: raw.custody ?? null,
    heat: typeof raw.heat === "number" ? clamp(raw.heat) : 0,
    totals: { ...emptyTotals(), ...(raw.totals ?? {}) },
    lastUpdatedAt: typeof raw.lastUpdatedAt === "number" ? raw.lastUpdatedAt : input.timestamp
  };
}

function visibleWitnesses(input: PlayerCrimeActionInput): PlayerCrimeActionInput["localScene"]["actors"] {
  return input.localScene.actors.filter((actor) => {
    if (!actor.visible || actor.id === input.playerId) return false;
    if (input.playerPosition.state === "inside") {
      if (actor.position.buildingId !== input.playerPosition.buildingId) return false;
      if (input.playerPosition.unitId && actor.position.unitId !== input.playerPosition.unitId) return false;
      if (input.playerPosition.roomId && actor.position.roomId !== input.playerPosition.roomId) return false;
      return actor.distanceToPlayerM <= 28;
    }
    return actor.position.state === "outside" && actor.distanceToPlayerM <= 42;
  }).sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM).slice(0, 8);
}

function cameraEvidence(input: PlayerCrimeActionInput, incidentId: string, policeEntityId: string): PlayerCrimeEvidenceState[] {
  const nodes = input.data.nodes.filter((node) => node.districtId === input.districtId && node.kind === "camera" && node.status !== "offline");
  if (!nodes.length) return [];
  const strongest = nodes.slice().sort((left, right) => right.coverage * right.quality - left.coverage * left.quality)[0];
  const security = input.venueId ? input.urban.venues.find((item) => item.id === input.venueId)?.security ?? 35 : 32;
  const rng = new SeededRandom(`${input.seed}:crime-camera:${incidentId}`);
  const captureChance = clamp(strongest.coverage * .55 + strongest.quality * .35 + security * .2 - 28);
  if (!rng.chance(captureChance / 100)) return [];
  const strength = clamp(Math.round(strongest.quality * .72 + strongest.coverage * .28 + rng.integer(-8, 8)));
  return [{
    id: createStableEntityId("crime-evidence", `${incidentId}:camera:${strongest.id}`),
    incidentId,
    kind: "camera",
    strength,
    ownerEntityId: strongest.ownerEntityId ?? policeEntityId,
    subjectIdentified: strength >= 62,
    description: strength >= 62 ? "Камера сохранила лицо и одежду подозреваемого." : "Камера сохранила силуэт и направление ухода.",
    createdAt: input.timestamp,
    expiresAt: input.timestamp + Math.max(1, strongest.retentionDays) * DAY_MS
  }];
}

function witnessEvidence(input: PlayerCrimeActionInput, incidentId: string, policeEntityId: string): { evidence: PlayerCrimeEvidenceState[]; actorIds: string[]; recognized: boolean } {
  const witnesses = visibleWitnesses(input);
  const evidence = witnesses.map((actor, index) => {
    const recognized = actor.knownToPlayer || actor.distanceToPlayerM <= 12;
    const strength = clamp(Math.round(38 + (42 - actor.distanceToPlayerM) * 1.15 + (recognized ? 24 : 0) - index * 4));
    return {
      id: createStableEntityId("crime-evidence", `${incidentId}:witness:${actor.id}`),
      incidentId,
      kind: "witness" as const,
      strength,
      ownerEntityId: policeEntityId,
      subjectIdentified: recognized && strength >= 55,
      description: recognized ? `${actor.name} узнал игрока.` : `${actor.name} запомнил внешность и направление ухода.`,
      createdAt: input.timestamp,
      expiresAt: input.timestamp + 30 * DAY_MS
    };
  });
  return { evidence, actorIds: witnesses.map((item) => item.id), recognized: evidence.some((item) => item.subjectIdentified) };
}

function physicalEvidence(input: PlayerCrimeActionInput, incidentId: string, policeEntityId: string): PlayerCrimeEvidenceState[] {
  const result: PlayerCrimeEvidenceState[] = [];
  if (input.kind === "vehicle-theft" && input.vehicleId) {
    result.push({
      id: createStableEntityId("crime-evidence", `${incidentId}:plate:${input.vehicleId}`),
      incidentId,
      kind: "vehicle-plate",
      strength: input.alarmTriggered ? 76 : 58,
      ownerEntityId: policeEntityId,
      subjectIdentified: false,
      description: "Номер и описание угнанной машины внесены в ориентировку.",
      createdAt: input.timestamp,
      expiresAt: input.timestamp + 120 * DAY_MS
    });
  }
  if (input.kind === "assault") {
    result.push({
      id: createStableEntityId("crime-evidence", `${incidentId}:blood`),
      incidentId,
      kind: "blood",
      strength: clamp(40 + input.violence * .45),
      ownerEntityId: policeEntityId,
      subjectIdentified: false,
      description: "На месте остались биологические следы и следы борьбы.",
      createdAt: input.timestamp,
      expiresAt: input.timestamp + 21 * DAY_MS
    });
  }
  return result;
}

function reportDelayMinutes(input: PlayerCrimeActionInput, evidenceCount: number): number {
  if (input.alarmTriggered || input.kind === "register-robbery") return 1;
  if (input.kind === "assault") return evidenceCount ? 3 : 18;
  if (input.kind === "vehicle-theft") return evidenceCount ? 7 : 28;
  return evidenceCount ? 12 : 45;
}

export function recordPlayerCrimeAction(state: PlayerCrimeState, input: PlayerCrimeActionInput): PlayerCrimeState {
  if (state.custody?.status === "detained") return state;
  const police = input.organizations.find((item) => item.type === "police")?.id ?? createStableEntityId("org", `${input.seed}:police`);
  const incidentId = createStableEntityId("player-crime", `${input.seed}:${input.kind}:${input.timestamp}:${input.venueId ?? input.vehicleId ?? input.victimActorId ?? "street"}`);
  const witness = witnessEvidence(input, incidentId, police);
  const camera = cameraEvidence(input, incidentId, police);
  const physical = physicalEvidence(input, incidentId, police);
  const evidence = [...witness.evidence, ...camera, ...physical];
  const evidenceStrength = evidence.reduce((sum, item) => sum + item.strength, 0) / Math.max(1, evidence.length);
  const heatBase = input.kind === "shoplifting" ? 10 : input.kind === "vehicle-theft" ? 28 : input.kind === "assault" ? 34 : 42;
  const heat = clamp(Math.round(heatBase + evidenceStrength * .34 + input.violence * .2));
  const identityConfidence = clamp(Math.max(0, ...evidence.map((item) => item.subjectIdentified ? item.strength : item.strength * .42)));
  const reportDelay = reportDelayMinutes(input, evidence.length);
  const incident: PlayerCrimeIncidentState = {
    id: incidentId,
    kind: input.kind,
    status: "unreported",
    districtId: input.districtId,
    sectorId: input.sectorId,
    xM: input.xM,
    yM: input.yM,
    venueId: input.venueId,
    vehicleId: input.vehicleId,
    victimActorId: input.victimActorId,
    victimResidentId: input.victimResidentId,
    occurredAt: input.timestamp,
    reportDueAt: input.timestamp + reportDelay * 60_000,
    success: input.success,
    violence: clamp(input.violence),
    stolenValue: Math.max(0, Math.round(input.stolenValue)),
    evidenceIds: evidence.map((item) => item.id),
    witnessActorIds: witness.actorIds,
    recognizedPlayer: witness.recognized || camera.some((item) => item.subjectIdentified),
    identityConfidence,
    heat,
    outcome: input.success ? undefined : "Попытка сорвалась, но следы остались."
  };
  const stolenProperty: StolenPropertyState[] = input.success && input.stolenProperty ? [{
    ...input.stolenProperty,
    id: createStableEntityId("stolen-property", `${incidentId}:${input.stolenProperty.offerId ?? input.stolenProperty.name}`),
    incidentId,
    acquiredAt: input.timestamp
  }] : [];
  const totals = {
    ...state.totals,
    crimesCommitted: state.totals.crimesCommitted + 1,
    shoplifting: state.totals.shoplifting + (input.kind === "shoplifting" ? 1 : 0),
    registerRobberies: state.totals.registerRobberies + (input.kind === "register-robbery" ? 1 : 0),
    vehicleThefts: state.totals.vehicleThefts + (input.kind === "vehicle-theft" ? 1 : 0),
    assaults: state.totals.assaults + (input.kind === "assault" ? 1 : 0),
    evidenceCreated: state.totals.evidenceCreated + evidence.length,
    stolenCredits: state.totals.stolenCredits + (input.success ? input.stolenValue : 0)
  };
  return {
    ...state,
    incidents: [incident, ...state.incidents].slice(0, 180),
    evidence: [...evidence, ...state.evidence].filter((item) => item.expiresAt > input.timestamp).slice(0, 500),
    stolenProperty: [...stolenProperty, ...state.stolenProperty].slice(0, 120),
    heat: clamp(state.heat + heat * .45),
    totals,
    lastUpdatedAt: input.timestamp
  };
}

function policeOrigin(input: PlayerCrimeInput, incident: PlayerCrimeIncidentState): { x: number; y: number } {
  const sector = input.urban.buildings.find((building) => building.sectorId === incident.sectorId && building.use === "civic");
  if (sector) return { x: sector.bounds.xM + sector.bounds.widthM / 2, y: sector.bounds.yM + sector.bounds.heightM / 2 };
  return { x: incident.xM - 620, y: incident.yM - 420 };
}

function createResponse(input: PlayerCrimeInput, incident: PlayerCrimeIncidentState): PoliceResponseState {
  const district = input.districts.find((item) => item.id === incident.districtId);
  const origin = policeOrigin(input, incident);
  const distance = Math.hypot(incident.xM - origin.x, incident.yM - origin.y);
  const security = district?.securityLevel ?? 45;
  const travelMinutes = Math.max(2, Math.min(14, Math.round(distance / 240 + (100 - security) / 18)));
  return {
    id: createStableEntityId("police-response", `${incident.id}:response`),
    incidentId: incident.id,
    unitCode: `DSB-${createStableEntityId("patrol", incident.id).replace(/[^0-9a-z]/gi, "").slice(-4).toUpperCase()}`,
    status: "dispatched",
    sectorId: incident.sectorId,
    fromX: origin.x,
    fromY: origin.y,
    targetX: incident.xM,
    targetY: incident.yM,
    currentX: origin.x,
    currentY: origin.y,
    dispatchedAt: input.timestamp,
    arrivesAt: input.timestamp + travelMinutes * 60_000
  };
}

function warrantForIncident(state: PlayerCrimeState, incident: PlayerCrimeIncidentState, timestamp: number): PlayerWarrantState {
  const existing = state.warrants.find((item) => item.status !== "closed" && item.status !== "arrested" && item.districtId === incident.districtId);
  const confidence = clamp(Math.max(existing?.identityConfidence ?? 0, incident.identityConfidence));
  const charges = Array.from(new Set([...(existing?.charges ?? []), incident.kind]));
  const incidentIds = Array.from(new Set([...(existing?.incidentIds ?? []), incident.id]));
  return {
    id: existing?.id ?? createStableEntityId("player-warrant", `${incident.districtId}:${timestamp}`),
    incidentIds,
    status: confidence >= 55 || incident.recognizedPlayer ? "identified" : "unknown-suspect",
    scope: incident.heat >= 62 || charges.length >= 3 ? "city" : "district",
    districtId: incident.districtId,
    charges,
    identityConfidence: confidence,
    heat: clamp((existing?.heat ?? 0) + incident.heat * .55),
    issuedAt: existing?.issuedAt ?? timestamp,
    lastSeenSectorId: incident.sectorId,
    lastSeenAt: timestamp
  };
}

function advanceGangs(state: PlayerCrimeState, input: PlayerCrimeInput): GangFactionState[] {
  const elapsedDays = Math.floor((input.timestamp - state.lastUpdatedAt) / DAY_MS);
  if (elapsedDays <= 0) return state.gangs;
  const venuesByDistrict = new Map<string, string[]>();
  for (const entry of input.urban.venueOperations.registry) {
    const local = venuesByDistrict.get(entry.venue.districtId) ?? [];
    if (entry.venue.operatingStatus === "operating") local.push(entry.venue.id);
    venuesByDistrict.set(entry.venue.districtId, local);
  }
  return state.gangs.map((gang) => {
    const rng = new SeededRandom(`${input.seed}:gang-advance:${gang.id}:${Math.floor(input.timestamp / DAY_MS)}`);
    const localVenues = venuesByDistrict.get(gang.homeDistrictId) ?? [];
    const controlled = localVenues.filter((_, index) => index % Math.max(3, 9 - Math.round(gang.influence / 15)) === 0).slice(0, 12);
    return {
      ...gang,
      influence: clamp(gang.influence + rng.integer(-2, 3) * elapsedDays),
      cash: Math.max(0, gang.cash + controlled.length * rng.integer(180, 520) * elapsedDays - gang.activeMembers * 9 * elapsedDays),
      controlledVenueIds: controlled,
      hostilityToPlayer: clamp(gang.hostilityToPlayer - elapsedDays),
      lastUpdatedAt: input.timestamp
    };
  });
}

function shouldDetain(state: PlayerCrimeState, input: PlayerCrimeInput, response: PoliceResponseState, incident: PlayerCrimeIncidentState): boolean {
  if (state.custody?.status === "detained") return false;
  if (response.status !== "on-scene" && response.status !== "searching") return false;
  if (input.playerPosition.sectorId !== incident.sectorId) return false;
  const distance = Math.hypot(input.playerPosition.xM - incident.xM, input.playerPosition.yM - incident.yM);
  if (distance <= 28 && input.timestamp - response.arrivesAt <= 25 * 60_000) return true;
  const warrant = state.warrants.find((item) => item.incidentIds.includes(incident.id) && item.status === "identified");
  if (!warrant) return false;
  const nearCheckpoint = input.streetScene.incidents.some((item) => item.type === "checkpoint" && item.status !== "resolved" && item.sectorId === input.playerPosition.sectorId && Math.hypot(item.xM - input.playerPosition.xM, item.yM - input.playerPosition.yM) <= 32);
  return nearCheckpoint;
}

export function advancePlayerCrimeState(state: PlayerCrimeState | undefined, input: PlayerCrimeInput): PlayerCrimeAdvanceResult {
  const base = normalizePlayerCrimeState(state, input);
  if (input.timestamp < base.lastUpdatedAt) return { state: base, notices: [], newlyDetained: false };
  const notices: PlayerCrimeAdvanceResult["notices"] = [];
  let warrants = [...base.warrants];
  let responses = base.policeResponses.map((item) => ({ ...item }));
  let reportsFiled = 0;
  let responsesCreated = 0;
  const incidents = base.incidents.map((incident) => {
    if (incident.status === "unreported" && input.timestamp >= incident.reportDueAt) {
      reportsFiled += 1;
      const reported = { ...incident, status: "reported" as const, reportedAt: input.timestamp };
      const warrant = warrantForIncident({ ...base, warrants }, reported, input.timestamp);
      warrants = [warrant, ...warrants.filter((item) => item.id !== warrant.id)];
      if (!responses.some((item) => item.incidentId === incident.id)) {
        responses.push(createResponse(input, reported));
        responsesCreated += 1;
      }
      notices.push({
        title: "Преступление зарегистрировано.",
        detail: `${reported.kind} · улики ${reported.evidenceIds.length} · подозреваемый ${warrant.status === "identified" ? "установлен" : "не установлен"}.`,
        importance: warrant.status === "identified" ? 3 : 2
      });
      return reported;
    }
    return incident;
  });

  responses = responses.map((response) => {
    if (response.status === "resolved") return response;
    const duration = Math.max(1, response.arrivesAt - response.dispatchedAt);
    const ratio = clamp((input.timestamp - response.dispatchedAt) / duration, 0, 1);
    const arrived = input.timestamp >= response.arrivesAt;
    const incident = incidents.find((item) => item.id === response.incidentId);
    if (!incident) return { ...response, status: "resolved" as const, resolvedAt: input.timestamp };
    const searchExpired = input.timestamp - response.arrivesAt > 90 * 60_000;
    return {
      ...response,
      status: searchExpired ? "resolved" as const : arrived ? (input.timestamp - response.arrivesAt > 12 * 60_000 ? "searching" as const : "on-scene" as const) : ratio > .05 ? "en-route" as const : "dispatched" as const,
      currentX: response.fromX + (response.targetX - response.fromX) * ratio,
      currentY: response.fromY + (response.targetY - response.fromY) * ratio,
      resolvedAt: searchExpired ? input.timestamp : response.resolvedAt
    };
  });

  let custody = base.custody;
  let newlyDetained = false;
  if (!custody || custody.status !== "detained") {
    for (const response of responses) {
      const incident = incidents.find((item) => item.id === response.incidentId);
      if (!incident || !shouldDetain({ ...base, warrants, policeResponses: responses }, input, response, incident)) continue;
      const warrant = warrants.find((item) => item.incidentIds.includes(incident.id) && item.status !== "closed");
      const confiscated = base.stolenProperty.filter((item) => !item.confiscatedAt && warrant?.incidentIds.includes(item.incidentId)).map((item) => item.id);
      const fine = Math.round(80 + incident.stolenValue * .72 + incident.violence * 4 + (warrant?.charges.length ?? 1) * 55);
      custody = {
        incidentId: incident.id,
        warrantId: warrant?.id,
        status: "detained",
        startedAt: input.timestamp,
        releaseAt: input.timestamp + Math.max(2, Math.min(18, 2 + (warrant?.charges.length ?? 1) * 3)) * HOUR_MS,
        fine,
        confiscatedPropertyIds: confiscated,
        reason: `${incident.kind} · улики ${incident.evidenceIds.length}`
      };
      if (warrant) warrants = warrants.map((item) => item.id === warrant.id ? { ...item, status: "arrested" as const } : item);
      newlyDetained = true;
      notices.push({ title: "Игрок задержан.", detail: `${custody.reason} · штраф ₵ ${fine}.`, importance: 3 });
      break;
    }
  }

  const evidence = base.evidence.filter((item) => item.expiresAt > input.timestamp);
  const heatDecay = Math.max(0, (input.timestamp - base.lastUpdatedAt) / HOUR_MS * 0.35);
  const next: PlayerCrimeState = {
    ...base,
    incidents: incidents.map((incident) => {
      const response = responses.find((item) => item.incidentId === incident.id);
      if (incident.status === "reported" && response && response.status !== "dispatched" && response.status !== "en-route") return { ...incident, status: "investigating" as const };
      return incident;
    }),
    evidence,
    warrants,
    policeResponses: responses.slice(-80),
    gangs: advanceGangs(base, input),
    custody,
    heat: clamp(base.heat - heatDecay + reportsFiled * 4),
    totals: {
      ...base.totals,
      reportsFiled: base.totals.reportsFiled + reportsFiled,
      policeResponses: base.totals.policeResponses + responsesCreated,
      arrests: base.totals.arrests + (newlyDetained ? 1 : 0)
    },
    lastUpdatedAt: input.timestamp
  };
  return { state: next, notices, newlyDetained };
}

export function releasePlayerCustodyState(state: PlayerCrimeState, timestamp: number, paidFine: boolean): PlayerCrimeState {
  const custody = state.custody;
  if (!custody || custody.status !== "detained") return state;
  const released = paidFine || timestamp >= custody.releaseAt;
  if (!released) return state;
  const confiscated = new Set(custody.confiscatedPropertyIds);
  return {
    ...state,
    custody: { ...custody, status: "released", releasedAt: timestamp },
    stolenProperty: state.stolenProperty.map((item) => confiscated.has(item.id) ? { ...item, confiscatedAt: timestamp } : item),
    warrants: state.warrants.map((item) => item.id === custody.warrantId ? { ...item, status: "closed", closedAt: timestamp } : item),
    heat: clamp(state.heat * .38),
    totals: { ...state.totals, finesPaid: state.totals.finesPaid + (paidFine ? custody.fine : 0) },
    lastUpdatedAt: timestamp
  };
}

export function activePlayerWarrants(state: PlayerCrimeState): PlayerWarrantState[] {
  return state.warrants.filter((item) => item.status === "identified" || item.status === "unknown-suspect");
}
