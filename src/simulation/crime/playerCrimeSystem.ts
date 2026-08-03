import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { OrganizationState } from "../../world/state/types";
import type {
  CrimeEvidenceKind,
  CrimeReportSource,
  GangFactionState,
  PlayerCrimeActionInput,
  PlayerCrimeAdvanceResult,
  PlayerCrimeEvidenceState,
  PlayerCrimeIncidentState,
  PlayerCrimeInput,
  PlayerCrimeState,
  PlayerCrimeTotalsState,
  PlayerCustodyActionInput,
  PlayerCustodyActionResult,
  PlayerCustodyState,
  PlayerWarrantState,
  PoliceResponseState,
  StolenPropertyState
} from "./playerCrimeTypes";

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const UNOBSERVED_RESOLUTION_MS = 6 * HOUR_MS;

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
    escapes: 0,
    failedEscapes: 0,
    finesPaid: 0,
    stolenCredits: 0
  };
}

function gangSeeds(seed: string, timestamp: number, organizations: OrganizationState[], districtIds: string[]): GangFactionState[] {
  const existing = organizations.filter((item) => item.type === "gang");
  const names = ["CUTWIRE", "RED STATIC", "MOURNING SONS"];
  const gangs = names.map((name, index) => {
    const organization = existing[index];
    const rng = new SeededRandom(`${seed}:gang-faction:${index}`);
    const homeDistrictId = districtIds[index % Math.max(1, districtIds.length)] ?? "district-missing";
    return {
      id: organization?.id ?? createStableEntityId("gang-faction", `${seed}:${name}`),
      organizationId: organization?.id,
      name: organization?.name ?? name,
      code: organization?.code ?? `G/${index + 1}`,
      homeDistrictId,
      influence: rng.integer(24, 68),
      influenceByDistrict: Object.fromEntries(districtIds.map((districtId) => [districtId, districtId === homeDistrictId ? rng.integer(35, 68) : rng.integer(4, 28)])),
      cash: organization?.budget ?? rng.integer(90_000, 520_000),
      hostilityToPlayer: 0,
      controlledVenueIds: [],
      rivalIds: [],
      activeMembers: organization?.employeeCount ?? rng.integer(45, 180),
      activeOperations: 0,
      disruptedOperations: 0,
      knownIntel: rng.integer(18, 34),
      conflictIntensity: 0,
      conflictLosses: 0,
      conflictCreditsLost: 0,
      lastKnownAt: timestamp,
      lastUpdatedAt: timestamp
    } satisfies GangFactionState;
  });
  return gangs.map((gang) => ({ ...gang, rivalIds: gangs.filter((item) => item.id !== gang.id).map((item) => item.id) }));
}

function strongestDistrict(influenceByDistrict: Record<string, number>, fallback: string): string {
  return Object.entries(influenceByDistrict).sort((left, right) => right[1] - left[1])[0]?.[0] ?? fallback;
}

function conflictProjection(networkId: string, influenceByDistrict: Record<string, number>, violence: number, gangs: Array<{ id: string; influenceByDistrict: Record<string, number>; violence: number }>): { intensity: number; rivalId?: string } {
  let intensity = 0;
  let rivalId: string | undefined;
  for (const rival of gangs) {
    if (rival.id === networkId) continue;
    const overlap = Object.keys(influenceByDistrict).reduce((highest, districtId) => Math.max(highest, Math.min(influenceByDistrict[districtId] ?? 0, rival.influenceByDistrict[districtId] ?? 0)), 0);
    const pressure = clamp(overlap * .72 + Math.min(violence, rival.violence) * .28 - 18);
    if (pressure > intensity) {
      intensity = pressure;
      rivalId = rival.id;
    }
  }
  return { intensity: Math.round(intensity), rivalId: intensity >= 48 ? rivalId : undefined };
}

function controlledVenues(input: PlayerCrimeInput, influenceByDistrict: Record<string, number>, networkId: string): string[] {
  const result: string[] = [];
  for (const [districtId, influence] of Object.entries(influenceByDistrict)) {
    if (influence < 42) continue;
    const venues = input.urban.venueOperations.registry
      .filter((entry) => entry.venue.districtId === districtId && entry.venue.operatingStatus === "operating")
      .map((entry) => entry.venue.id)
      .sort((left, right) => left.localeCompare(right));
    const target = Math.min(12, Math.max(1, Math.floor(influence / 15)));
    const rng = new SeededRandom(`${input.seed}:gang-control:${networkId}:${districtId}`);
    const offset = venues.length ? rng.integer(0, Math.max(0, venues.length - 1)) : 0;
    for (let index = 0; index < target && index < venues.length; index += 1) {
      result.push(venues[(offset + index * 3) % venues.length]);
    }
  }
  return [...new Set(result)];
}

function projectGangs(input: PlayerCrimeInput, previous: GangFactionState[] = []): GangFactionState[] {
  const networks = input.government?.crimeNetworks ?? [];
  if (!networks.length) {
    const fallback = previous.length ? previous : gangSeeds(input.seed, input.timestamp, input.organizations, input.districts.map((item) => item.id));
    const elapsedDays = Math.max(0, Math.floor((input.timestamp - Math.max(0, ...fallback.map((item) => item.lastUpdatedAt))) / DAY_MS));
    return fallback.map((gang) => ({
      ...gang,
      hostilityToPlayer: clamp(gang.hostilityToPlayer - elapsedDays),
      lastUpdatedAt: input.timestamp
    }));
  }
  const networkViews = networks.map((network) => ({ id: network.id, influenceByDistrict: network.influenceByDistrict, violence: network.violence }));
  return networks.map((network, index) => {
    const organization = input.organizations.find((item) => item.id === network.organizationId);
    const prior = previous.find((item) => item.sourceNetworkId === network.id || item.organizationId === network.organizationId || item.id === network.id);
    const influenceValues = Object.values(network.influenceByDistrict);
    const influence = clamp(influenceValues.length ? Math.max(...influenceValues) : 0);
    const homeDistrictId = strongestDistrict(network.influenceByDistrict, input.districts[index % Math.max(1, input.districts.length)]?.id ?? "district-missing");
    const projectedConflict = conflictProjection(network.id, network.influenceByDistrict, network.violence, networkViews);
    const canonicalConflict = (input.government?.gangConflicts ?? [])
      .filter((item) => item.status === "active" || item.status === "tense" || item.status === "cooling")
      .filter((item) => item.networkAId === network.id || item.networkBId === network.id)
      .sort((left, right) => right.intensity - left.intensity)[0];
    const isConflictSideA = canonicalConflict?.networkAId === network.id;
    const conflictRivalId = canonicalConflict
      ? (isConflictSideA ? canonicalConflict.networkBId : canonicalConflict.networkAId)
      : projectedConflict.rivalId;
    const conflictLosses = canonicalConflict ? (isConflictSideA ? canonicalConflict.lossesA : canonicalConflict.lossesB) : 0;
    const conflictCreditsLost = canonicalConflict ? (isConflictSideA ? canonicalConflict.creditsLostA : canonicalConflict.creditsLostB) : 0;
    const activeOperations = network.operations.filter((item) => item.status === "active" || item.status === "strained").length;
    const disruptedOperations = network.operations.filter((item) => item.status === "disrupted" || item.status === "dormant").length;
    const publicIntel = clamp(Math.round(46 - network.secrecy * .24 + network.heat * .18 + (organization?.type === "gang" ? 8 : 0)), 12, 46);
    const knownIntel = clamp(Math.max(prior?.knownIntel ?? 0, publicIntel));
    return {
      id: network.id,
      sourceNetworkId: network.id,
      organizationId: network.organizationId,
      name: network.name,
      code: organization?.code ?? `NET/${index + 1}`,
      homeDistrictId,
      influence,
      influenceByDistrict: { ...network.influenceByDistrict },
      cash: network.treasury,
      hostilityToPlayer: prior?.hostilityToPlayer ?? 0,
      controlledVenueIds: controlledVenues(input, network.influenceByDistrict, network.id),
      rivalIds: networks.filter((item) => item.id !== network.id).map((item) => item.id),
      activeMembers: network.memberResidentIds.length,
      activeOperations,
      disruptedOperations,
      knownIntel,
      conflictIntensity: canonicalConflict?.intensity ?? projectedConflict.intensity,
      conflictLosses,
      conflictCreditsLost,
      warWithGangId: conflictRivalId,
      lastKnownAt: knownIntel > 0 ? input.timestamp : prior?.lastKnownAt,
      lastUpdatedAt: input.timestamp
    };
  });
}

export function createPlayerCrimeState(input: PlayerCrimeInput): PlayerCrimeState {
  return {
    version: 2,
    incidents: [],
    evidence: [],
    warrants: [],
    stolenProperty: [],
    policeResponses: [],
    gangs: projectGangs(input),
    custody: null,
    heat: 0,
    totals: emptyTotals(),
    lastUpdatedAt: input.timestamp
  };
}

function normalizeIncident(raw: Partial<PlayerCrimeIncidentState>): PlayerCrimeIncidentState | null {
  if (!raw.id || !raw.kind || !raw.districtId || !raw.sectorId || typeof raw.occurredAt !== "number") return null;
  const aware = Array.isArray(raw.playerAwareEvidenceKinds) ? raw.playerAwareEvidenceKinds : [];
  return {
    id: raw.id,
    kind: raw.kind,
    status: raw.status ?? "resolved",
    districtId: raw.districtId,
    sectorId: raw.sectorId,
    xM: raw.xM ?? 0,
    yM: raw.yM ?? 0,
    venueId: raw.venueId,
    vehicleId: raw.vehicleId,
    victimActorId: raw.victimActorId,
    victimResidentId: raw.victimResidentId,
    occurredAt: raw.occurredAt,
    reportDueAt: raw.reportDueAt ?? raw.occurredAt + 45 * 60_000,
    reportedAt: raw.reportedAt,
    resolvedAt: raw.resolvedAt,
    reportSource: raw.reportSource ?? (raw.alarmTriggered ? "alarm" : (raw.witnessActorIds?.length ?? 0) > 0 ? "witness" : raw.kind === "vehicle-theft" || raw.kind === "assault" ? "victim" : "none"),
    alarmTriggered: raw.alarmTriggered ?? raw.kind === "register-robbery",
    success: raw.success ?? false,
    violence: clamp(raw.violence ?? 0),
    stolenValue: Math.max(0, raw.stolenValue ?? 0),
    evidenceIds: Array.isArray(raw.evidenceIds) ? raw.evidenceIds : [],
    playerAwareEvidenceKinds: aware,
    witnessActorIds: Array.isArray(raw.witnessActorIds) ? raw.witnessActorIds : [],
    recognizedPlayer: raw.recognizedPlayer ?? false,
    identityConfidence: clamp(raw.identityConfidence ?? 0),
    heat: clamp(raw.heat ?? 0),
    outcome: raw.outcome
  };
}

function normalizeCustody(raw: Partial<PlayerCustodyState> | null | undefined): PlayerCustodyState | null {
  if (!raw || !raw.incidentId || !raw.status || typeof raw.startedAt !== "number" || typeof raw.releaseAt !== "number") return null;
  const sentenceHours = Math.max(1, raw.sentenceHours ?? Math.ceil((raw.releaseAt - raw.startedAt) / HOUR_MS));
  const phase = raw.status === "released" ? "released" : raw.phase ?? "hearing";
  return {
    incidentId: raw.incidentId,
    warrantId: raw.warrantId,
    status: raw.status,
    phase,
    startedAt: raw.startedAt,
    searchCompletedAt: raw.searchCompletedAt,
    hearingAt: raw.hearingAt ?? raw.startedAt,
    releaseAt: raw.releaseAt,
    sentenceHours,
    fine: Math.max(0, raw.fine ?? 0),
    confiscatedPropertyIds: Array.isArray(raw.confiscatedPropertyIds) ? raw.confiscatedPropertyIds : [],
    reason: raw.reason ?? "Материалы дела не указаны",
    searchOutcome: raw.searchOutcome,
    escapeAttempted: raw.escapeAttempted ?? false,
    resistedSearch: raw.resistedSearch ?? false,
    releasedAt: raw.releasedAt
  };
}

function normalizeGang(raw: Partial<GangFactionState>, input: PlayerCrimeInput): GangFactionState | null {
  if (!raw.id || !raw.name || !raw.homeDistrictId) return null;
  return {
    id: raw.id,
    sourceNetworkId: raw.sourceNetworkId,
    organizationId: raw.organizationId,
    name: raw.name,
    code: raw.code ?? "G/—",
    homeDistrictId: raw.homeDistrictId,
    influence: clamp(raw.influence ?? 0),
    influenceByDistrict: raw.influenceByDistrict && typeof raw.influenceByDistrict === "object" ? { ...raw.influenceByDistrict } : { [raw.homeDistrictId]: clamp(raw.influence ?? 0) },
    cash: Math.max(0, raw.cash ?? 0),
    hostilityToPlayer: clamp(raw.hostilityToPlayer ?? 0),
    controlledVenueIds: Array.isArray(raw.controlledVenueIds) ? raw.controlledVenueIds : [],
    rivalIds: Array.isArray(raw.rivalIds) ? raw.rivalIds : [],
    activeMembers: Math.max(0, raw.activeMembers ?? 0),
    activeOperations: Math.max(0, raw.activeOperations ?? 0),
    disruptedOperations: Math.max(0, raw.disruptedOperations ?? 0),
    knownIntel: clamp(raw.knownIntel ?? 18),
    conflictIntensity: clamp(raw.conflictIntensity ?? 0),
    conflictLosses: Math.max(0, Math.round(raw.conflictLosses ?? 0)),
    conflictCreditsLost: Math.max(0, Math.round(raw.conflictCreditsLost ?? 0)),
    warWithGangId: raw.warWithGangId,
    lastKnownAt: raw.lastKnownAt,
    lastUpdatedAt: raw.lastUpdatedAt ?? input.timestamp
  };
}

export function normalizePlayerCrimeState(value: unknown, input: PlayerCrimeInput): PlayerCrimeState {
  if (!value || typeof value !== "object") return createPlayerCrimeState(input);
  const raw = value as Partial<Omit<PlayerCrimeState, "version">> & { version?: number };
  if (raw.version !== 1 && raw.version !== 2) return createPlayerCrimeState(input);
  const normalizedGangs = Array.isArray(raw.gangs) ? raw.gangs.map((item) => normalizeGang(item, input)).filter((item): item is GangFactionState => Boolean(item)) : [];
  const baseGangs = projectGangs(input, normalizedGangs);
  return {
    version: 2,
    incidents: Array.isArray(raw.incidents) ? raw.incidents.map((item) => normalizeIncident(item)).filter((item): item is PlayerCrimeIncidentState => Boolean(item)) : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    warrants: Array.isArray(raw.warrants) ? raw.warrants : [],
    stolenProperty: Array.isArray(raw.stolenProperty) ? raw.stolenProperty : [],
    policeResponses: Array.isArray(raw.policeResponses) ? raw.policeResponses : [],
    gangs: baseGangs,
    custody: normalizeCustody(raw.custody),
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

function reportSource(input: PlayerCrimeActionInput, witnessCount: number, cameraCount: number): CrimeReportSource {
  if (input.alarmTriggered || input.kind === "register-robbery") return "alarm";
  if (witnessCount > 0) return "witness";
  if (cameraCount > 0) return "camera";
  if (input.victimActorId || input.victimResidentId || input.kind === "vehicle-theft") return "victim";
  return "none";
}

function reportDelayMinutes(input: PlayerCrimeActionInput, source: CrimeReportSource): number {
  if (source === "alarm") return 1;
  if (source === "witness") return input.kind === "assault" ? 3 : 9;
  if (source === "camera") return input.kind === "vehicle-theft" ? 7 : 18;
  if (source === "victim") return input.kind === "vehicle-theft" ? 35 : 16;
  return 360;
}

function playerAwareEvidence(input: PlayerCrimeActionInput, witnessCount: number, cameraCount: number, physical: PlayerCrimeEvidenceState[]): CrimeEvidenceKind[] {
  const result: CrimeEvidenceKind[] = [];
  if (witnessCount > 0) result.push("witness");
  if (cameraCount > 0) result.push("camera");
  for (const item of physical) result.push(item.kind);
  if (input.stolenProperty) result.push("stolen-property");
  return [...new Set(result)];
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
  const source = reportSource(input, witness.evidence.length, camera.length);
  const reportDelay = reportDelayMinutes(input, source);
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
    reportSource: source,
    alarmTriggered: Boolean(input.alarmTriggered || input.kind === "register-robbery"),
    success: input.success,
    violence: clamp(input.violence),
    stolenValue: Math.max(0, Math.round(input.stolenValue)),
    evidenceIds: evidence.map((item) => item.id),
    playerAwareEvidenceKinds: playerAwareEvidence(input, witness.evidence.length, camera.length, physical),
    witnessActorIds: witness.actorIds,
    recognizedPlayer: witness.recognized || camera.some((item) => item.subjectIdentified),
    identityConfidence,
    heat,
    outcome: input.success ? undefined : "Попытка сорвалась, но следы могли остаться."
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
  const gangs = state.gangs.map((gang) => {
    const hitControlledVenue = Boolean(input.venueId && gang.controlledVenueIds.includes(input.venueId));
    if (!hitControlledVenue) return gang;
    const hostilityGain = input.kind === "register-robbery" ? 18 : input.kind === "shoplifting" ? 6 : 10;
    return {
      ...gang,
      hostilityToPlayer: clamp(gang.hostilityToPlayer + hostilityGain),
      knownIntel: clamp(gang.knownIntel + 8),
      lastKnownAt: input.timestamp
    };
  });
  return {
    ...state,
    incidents: [incident, ...state.incidents].slice(0, 180),
    evidence: [...evidence, ...state.evidence].filter((item) => item.expiresAt > input.timestamp).slice(0, 500),
    stolenProperty: [...stolenProperty, ...state.stolenProperty].slice(0, 120),
    gangs,
    heat: clamp(state.heat + heat * .45),
    totals,
    lastUpdatedAt: input.timestamp
  };
}

function policeOrigin(input: PlayerCrimeInput, incident: PlayerCrimeIncidentState): { x: number; y: number } {
  const civic = input.urban.buildings.find((building) => building.sectorId === incident.sectorId && building.use === "civic");
  if (civic) return { x: civic.bounds.xM + civic.bounds.widthM / 2, y: civic.bounds.yM + civic.bounds.heightM / 2 };
  return { x: incident.xM - 620, y: incident.yM - 420 };
}

function createResponse(input: PlayerCrimeInput, incident: PlayerCrimeIncidentState): PoliceResponseState {
  const district = input.districts.find((item) => item.id === incident.districtId);
  const law = input.government?.districts.find((item) => item.districtId === incident.districtId);
  const origin = policeOrigin(input, incident);
  const distance = Math.hypot(incident.xM - origin.x, incident.yM - origin.y);
  const readiness = law?.policeReadiness ?? district?.securityLevel ?? 45;
  const coverage = law?.patrolCoverage ?? district?.securityLevel ?? 45;
  const travelMinutes = Math.max(2, Math.min(18, Math.round(distance / 240 + (100 - readiness) / 20 + (100 - coverage) / 28)));
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

function shouldDispatchResponse(incident: PlayerCrimeIncidentState): boolean {
  if (incident.alarmTriggered || incident.reportSource === "alarm") return true;
  if (incident.kind === "vehicle-theft" || incident.violence >= 35) return true;
  return incident.reportSource === "witness" && incident.reportDueAt - incident.occurredAt <= 10 * 60_000;
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
    lastSeenSectorId: incident.recognizedPlayer ? incident.sectorId : existing?.lastSeenSectorId,
    lastSeenAt: incident.recognizedPlayer ? timestamp : existing?.lastSeenAt
  };
}

function shouldDetain(state: PlayerCrimeState, input: PlayerCrimeInput, response: PoliceResponseState, incident: PlayerCrimeIncidentState): boolean {
  if (state.custody?.status === "detained") return false;
  if (response.status !== "on-scene" && response.status !== "searching") return false;
  if (input.playerPosition.sectorId !== incident.sectorId) return false;
  const distance = Math.hypot(input.playerPosition.xM - incident.xM, input.playerPosition.yM - incident.yM);
  const warrant = state.warrants.find((item) => item.incidentIds.includes(incident.id) && item.status === "identified");
  const linkedProperty = state.stolenProperty.some((item) => item.incidentId === incident.id && !item.confiscatedAt && !item.disposedAt);
  if (distance <= 28 && input.timestamp - response.arrivesAt <= 25 * 60_000) {
    return Boolean(warrant || incident.recognizedPlayer || linkedProperty || incident.violence >= 60);
  }
  if (!warrant) return false;
  const nearCheckpoint = input.streetScene.incidents.some((item) => item.type === "checkpoint" && item.status !== "resolved" && item.sectorId === input.playerPosition.sectorId && Math.hypot(item.xM - input.playerPosition.xM, item.yM - input.playerPosition.yM) <= 32);
  return nearCheckpoint;
}

function arrestCustody(state: PlayerCrimeState, input: PlayerCrimeInput, incident: PlayerCrimeIncidentState, warrant: PlayerWarrantState | undefined): PlayerCustodyState {
  const confiscated = state.stolenProperty.filter((item) => !item.confiscatedAt && !item.disposedAt && (warrant?.incidentIds.includes(item.incidentId) || item.incidentId === incident.id)).map((item) => item.id);
  const sentenceHours = Math.max(2, Math.min(24, 2 + (warrant?.charges.length ?? 1) * 3 + Math.round(incident.violence / 25)));
  const hearingAt = input.timestamp + 35 * 60_000;
  const fine = Math.round(80 + incident.stolenValue * .72 + incident.violence * 4 + (warrant?.charges.length ?? 1) * 55);
  return {
    incidentId: incident.id,
    warrantId: warrant?.id,
    status: "detained",
    phase: "stopped",
    startedAt: input.timestamp,
    hearingAt,
    releaseAt: hearingAt + sentenceHours * HOUR_MS,
    sentenceHours,
    fine,
    confiscatedPropertyIds: confiscated,
    reason: `${incident.kind} · материалы дела сформированы`,
    escapeAttempted: false,
    resistedSearch: false
  };
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
    if (incident.status !== "unreported") return incident;
    if (incident.reportSource === "none" && input.timestamp - incident.occurredAt >= UNOBSERVED_RESOLUTION_MS) {
      return { ...incident, status: "resolved" as const, resolvedAt: input.timestamp, outcome: incident.outcome ?? "Сообщения не поступило. Дело не открыто." };
    }
    if (incident.reportSource === "none" || input.timestamp < incident.reportDueAt) return incident;
    reportsFiled += 1;
    const reported = { ...incident, status: "reported" as const, reportedAt: input.timestamp };
    const warrant = warrantForIncident({ ...base, warrants }, reported, input.timestamp);
    warrants = [warrant, ...warrants.filter((item) => item.id !== warrant.id)];
    if (shouldDispatchResponse(reported) && !responses.some((item) => item.incidentId === incident.id)) {
      responses.push(createResponse(input, reported));
      responsesCreated += 1;
    }
    notices.push({
      title: warrant.status === "identified" ? "Личность попала в ориентировку." : "Полиция открыла дело против неизвестного.",
      detail: warrant.status === "identified" ? "Свидетель или запись связали происшествие с игроком." : "Прямой связи с игроком пока нет.",
      importance: warrant.status === "identified" ? 3 : 1
    });
    return reported;
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
      custody = arrestCustody(base, input, incident, warrant);
      if (warrant) warrants = warrants.map((item) => item.id === warrant.id ? { ...item, status: "arrested" as const } : item);
      newlyDetained = true;
      notices.push({ title: "Полиция остановила игрока.", detail: "Сначала будет обыск, затем разбор материалов дела.", importance: 3 });
      break;
    }
  }

  const evidence = base.evidence.filter((item) => item.expiresAt > input.timestamp);
  const heatDecay = Math.max(0, (input.timestamp - base.lastUpdatedAt) / HOUR_MS * 0.35);
  const projectedGangs = projectGangs(input, base.gangs).map((gang) => ({
    ...gang,
    hostilityToPlayer: clamp(gang.hostilityToPlayer - Math.max(0, Math.floor((input.timestamp - base.lastUpdatedAt) / DAY_MS)))
  }));
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
    gangs: projectedGangs,
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

function confiscateCustodyProperty(state: PlayerCrimeState, custody: PlayerCustodyState, timestamp: number): PlayerCrimeState["stolenProperty"] {
  const confiscated = new Set(custody.confiscatedPropertyIds);
  return state.stolenProperty.map((item) => confiscated.has(item.id) && !item.confiscatedAt ? { ...item, confiscatedAt: timestamp } : item);
}

export function actOnPlayerCustodyState(state: PlayerCrimeState, input: PlayerCustodyActionInput): PlayerCustodyActionResult {
  const custody = state.custody;
  if (!custody || custody.status !== "detained") return { state, success: false, message: "Игрок не находится под стражей." };
  if (input.action === "submit-search") {
    if (custody.phase !== "stopped") return { state, success: false, message: "Обыск уже завершён." };
    const nextCustody: PlayerCustodyState = {
      ...custody,
      phase: "searched",
      searchCompletedAt: input.timestamp,
      searchOutcome: custody.confiscatedPropertyIds.length ? `Изъято предметов: ${custody.confiscatedPropertyIds.length}.` : "Запрещённых и краденых предметов при игроке не нашли."
    };
    return {
      state: { ...state, custody: nextCustody, stolenProperty: confiscateCustodyProperty(state, nextCustody, input.timestamp), lastUpdatedAt: input.timestamp },
      success: true,
      message: nextCustody.searchOutcome ?? "Обыск завершён."
    };
  }
  if (input.action === "resist-search") {
    if (custody.phase !== "stopped") return { state, success: false, message: "Сопротивляться обыску уже поздно." };
    const nextCustody: PlayerCustodyState = {
      ...custody,
      phase: "searched",
      searchCompletedAt: input.timestamp,
      fine: custody.fine + 140,
      sentenceHours: custody.sentenceHours + 2,
      releaseAt: custody.releaseAt + 2 * HOUR_MS,
      resistedSearch: true,
      searchOutcome: `Сопротивление подавлено. Штраф увеличен на ₵ 140, срок — на 2 часа.`
    };
    return {
      state: {
        ...state,
        custody: nextCustody,
        stolenProperty: confiscateCustodyProperty(state, nextCustody, input.timestamp),
        heat: clamp(state.heat + 12),
        lastUpdatedAt: input.timestamp
      },
      success: true,
      message: nextCustody.searchOutcome ?? "Сопротивление подавлено."
    };
  }
  if (input.action === "attempt-escape") {
    if (custody.phase !== "stopped" || custody.escapeAttempted) return { state, success: false, message: "Побег сейчас невозможен." };
    const chance = clamp(12 + input.health * .38 - input.fatigue * .24 - state.heat * .16, 5, 52);
    const rng = new SeededRandom(`${input.seed}:custody-escape:${custody.incidentId}:${Math.floor(input.timestamp / 60_000)}`);
    const escaped = rng.chance(chance / 100);
    if (escaped) {
      return {
        state: {
          ...state,
          custody: { ...custody, status: "released", phase: "released", escapeAttempted: true, releasedAt: input.timestamp, searchOutcome: "Побег удался до обыска." },
          warrants: state.warrants.map((item) => item.id === custody.warrantId ? { ...item, status: "identified" as const, lastSeenAt: input.timestamp } : item),
          policeResponses: state.policeResponses.map((item) => item.incidentId === custody.incidentId && item.status !== "resolved" ? { ...item, status: "searching" as const } : item),
          heat: clamp(state.heat + 28),
          totals: { ...state.totals, escapes: state.totals.escapes + 1 },
          lastUpdatedAt: input.timestamp
        },
        success: true,
        message: "Побег удался. Ориентировка усилена."
      };
    }
    const nextCustody: PlayerCustodyState = {
      ...custody,
      phase: "searched",
      searchCompletedAt: input.timestamp,
      escapeAttempted: true,
      fine: custody.fine + 220,
      sentenceHours: custody.sentenceHours + 4,
      releaseAt: custody.releaseAt + 4 * HOUR_MS,
      searchOutcome: "Побег сорван. Штраф увеличен на ₵ 220, срок — на 4 часа."
    };
    return {
      state: {
        ...state,
        custody: nextCustody,
        stolenProperty: confiscateCustodyProperty(state, nextCustody, input.timestamp),
        heat: clamp(state.heat + 20),
        totals: { ...state.totals, failedEscapes: state.totals.failedEscapes + 1 },
        lastUpdatedAt: input.timestamp
      },
      success: true,
      message: nextCustody.searchOutcome ?? "Побег сорван."
    };
  }
  if (input.action === "proceed-hearing") {
    if (custody.phase !== "searched") return { state, success: false, message: "Сначала должен завершиться обыск." };
    const hearingAt = Math.max(input.timestamp, custody.hearingAt);
    return {
      state: { ...state, custody: { ...custody, phase: "hearing", hearingAt }, lastUpdatedAt: input.timestamp },
      success: true,
      message: `Материалы рассмотрены: штраф ₵ ${custody.fine} или ${custody.sentenceHours} ч. под стражей.`
    };
  }
  return { state, success: false, message: "Неизвестное действие." };
}

export function releasePlayerCustodyState(state: PlayerCrimeState, timestamp: number, paidFine: boolean): PlayerCrimeState {
  const custody = state.custody;
  if (!custody || custody.status !== "detained" || custody.phase !== "hearing") return state;
  const released = paidFine || timestamp >= custody.releaseAt;
  if (!released) return state;
  return {
    ...state,
    custody: { ...custody, status: "released", phase: "released", releasedAt: timestamp },
    stolenProperty: state.stolenProperty.map((item) => custody.confiscatedPropertyIds.includes(item.id) && !item.confiscatedAt ? { ...item, confiscatedAt: timestamp } : item),
    warrants: state.warrants.map((item) => item.id === custody.warrantId ? { ...item, status: "closed", closedAt: timestamp } : item),
    heat: clamp(state.heat * .38),
    totals: { ...state.totals, finesPaid: state.totals.finesPaid + (paidFine ? custody.fine : 0) },
    lastUpdatedAt: timestamp
  };
}

export function activePlayerWarrants(state: PlayerCrimeState): PlayerWarrantState[] {
  return state.warrants.filter((item) => item.status === "identified" || item.status === "unknown-suspect");
}
