import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import { getSectorStreetTopology } from "../streets/streetTopologySystem";
import type { StreetIntersectionState, StreetSegmentState } from "../streets/types";
import type {
  StreetCrossingState,
  StreetIncidentAction,
  StreetIncidentState,
  StreetIncidentType,
  StreetPedestrianState,
  StreetSceneAdvanceResult,
  StreetSceneInput,
  StreetSceneState,
  StreetTrafficState
} from "./types";

const INCIDENT_BUCKET_MS = 10 * 60_000;
const MAX_PEDESTRIANS = 42;
const MAX_TRAFFIC = 30;
const MAX_ACTIVE_INCIDENTS = 4;

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function round(value: number): number { return Math.round(value * 10) / 10; }
function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}
function distanceSquared(x: number, y: number, point: { xM: number; yM: number }): number { return (point.xM - x) ** 2 + (point.yM - y) ** 2; }

function segmentNodes(segment: StreetSegmentState, nodes: Map<string, StreetIntersectionState>): { from: StreetIntersectionState; to: StreetIntersectionState } | null {
  const from = nodes.get(segment.fromIntersectionId);
  const to = nodes.get(segment.toIntersectionId);
  return from && to ? { from, to } : null;
}

function nearestSegment(xM: number, yM: number, segments: StreetSegmentState[], nodes: Map<string, StreetIntersectionState>): StreetSegmentState | undefined {
  let best: { segment: StreetSegmentState; distance: number } | undefined;
  for (const segment of segments) {
    const pair = segmentNodes(segment, nodes);
    if (!pair) continue;
    const dx = pair.to.xM - pair.from.xM;
    const dy = pair.to.yM - pair.from.yM;
    const lengthSquared = Math.max(.001, dx * dx + dy * dy);
    const ratio = clamp(((xM - pair.from.xM) * dx + (yM - pair.from.yM) * dy) / lengthSquared, 0, 1);
    const px = pair.from.xM + dx * ratio;
    const py = pair.from.yM + dy * ratio;
    const candidate = (px - xM) ** 2 + (py - yM) ** 2;
    if (!best || candidate < best.distance) best = { segment, distance: candidate };
  }
  return best?.segment;
}

function pointOnSegment(segment: StreetSegmentState, nodes: Map<string, StreetIntersectionState>, progress: number, lateralM = 0): { xM: number; yM: number; headingDeg: number } | null {
  const pair = segmentNodes(segment, nodes);
  if (!pair) return null;
  const dx = pair.to.xM - pair.from.xM;
  const dy = pair.to.yM - pair.from.yM;
  const length = Math.max(1, Math.hypot(dx, dy));
  const ratio = clamp(progress, 0, 1);
  return {
    xM: round(pair.from.xM + dx * ratio - dy / length * lateralM),
    yM: round(pair.from.yM + dy * ratio + dx / length * lateralM),
    headingDeg: round(Math.atan2(dy, dx) * 180 / Math.PI)
  };
}

function reflectedProgress(base: number, distanceM: number, lengthM: number): { progress: number; forward: boolean } {
  const phase = (base + distanceM / Math.max(1, lengthM)) % 2;
  return phase <= 1 ? { progress: phase, forward: true } : { progress: 2 - phase, forward: false };
}

function buildPedestrians(input: StreetSceneInput, segments: StreetSegmentState[], nodes: Map<string, StreetIntersectionState>): StreetPedestrianState[] {
  const elapsedMinutes = input.timestamp / 60_000;
  return input.localScene.actors
    .filter((actor) => actor.position.state === "outside" && actor.position.sectorId === input.localScene.focusSectorId && actor.visible)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, MAX_PEDESTRIANS)
    .flatMap((actor) => {
      const segment = nearestSegment(actor.position.xM, actor.position.yM, segments, nodes) ?? segments[hash(actor.id) % Math.max(1, segments.length)];
      if (!segment) return [];
      const value = hash(actor.id);
      const speed = 58 + value % 36;
      const phase = reflectedProgress((value % 1000) / 1000, elapsedMinutes * speed, segment.lengthM);
      const side = value % 2 === 0 ? "left" as const : "right" as const;
      const sidewalk = (segment.widthM / 2) + Math.max(1.2, side === "left" ? segment.sidewalkLeftM * .45 : segment.sidewalkRightM * .45);
      const point = pointOnSegment(segment, nodes, phase.progress, side === "left" ? sidewalk : -sidewalk);
      if (!point) return [];
      const endpoint = phase.progress < .055 || phase.progress > .945;
      const crossing = endpoint && nodes.get(phase.progress < .5 ? segment.fromIntersectionId : segment.toIntersectionId)?.kind === "crossing";
      return [{
        id: createStableEntityId("street-pedestrian", actor.id),
        actorId: actor.id,
        segmentId: segment.id,
        xM: point.xM,
        yM: point.yM,
        headingDeg: phase.forward ? point.headingDeg : point.headingDeg + 180,
        speedMPerMinute: speed,
        motion: crossing ? "crossing" as const : endpoint ? "waiting" as const : "walking" as const,
        sidewalkSide: side,
        destinationBuildingId: actor.position.buildingId,
        updatedAt: input.timestamp
      }];
    });
}

function vehicleSpeed(segment: StreetSegmentState, seedValue: number): number {
  const congestion = clamp(segment.trafficLoad / 100, 0, .9);
  return round(Math.max(6, segment.speedLimitKph * (1 - congestion * .72) * (.76 + (seedValue % 20) / 100)));
}

function buildTraffic(input: StreetSceneInput, segments: StreetSegmentState[], nodes: Map<string, StreetIntersectionState>): StreetTrafficState[] {
  const elapsedHours = input.timestamp / 3_600_000;
  return input.vehicles.vehicles
    .filter((vehicle) => vehicle.position.sectorId === input.localScene.focusSectorId && vehicle.visible)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, MAX_TRAFFIC)
    .flatMap<StreetTrafficState>((vehicle): StreetTrafficState[] => {
      if (vehicle.state === "parked" || vehicle.state === "disabled" || vehicle.id === input.vehicles.player.currentVehicleId) {
        return [{
          id: createStableEntityId("street-traffic", vehicle.id), vehicleId: vehicle.id,
          xM: vehicle.position.xM, yM: vehicle.position.yM, headingDeg: 0, speedKph: 0, laneIndex: 0,
          motion: vehicle.state === "disabled" ? "disabled" as const : "parked" as const,
          brakeLights: false, updatedAt: input.timestamp
        }];
      }
      const segment = nearestSegment(vehicle.position.xM, vehicle.position.yM, segments, nodes) ?? segments[hash(vehicle.id) % Math.max(1, segments.length)];
      if (!segment) return [];
      const value = hash(vehicle.id);
      const speedKph = vehicleSpeed(segment, value);
      const phase = reflectedProgress((value % 1000) / 1000, elapsedHours * speedKph * 1000, segment.lengthM);
      const laneIndex = value % Math.max(1, segment.lanes);
      const laneOffset = ((laneIndex + .5) / Math.max(1, segment.lanes) - .5) * Math.max(2.4, segment.widthM * .62);
      const point = pointOnSegment(segment, nodes, phase.progress, laneOffset);
      if (!point) return [];
      const signalStop = (phase.progress < .035 || phase.progress > .965) && Math.floor(input.timestamp / 30_000 + value) % 3 === 0;
      return [{
        id: createStableEntityId("street-traffic", vehicle.id), vehicleId: vehicle.id, segmentId: segment.id,
        xM: point.xM, yM: point.yM, headingDeg: phase.forward ? point.headingDeg : point.headingDeg + 180,
        speedKph: signalStop ? 0 : speedKph, laneIndex,
        motion: signalStop ? "stopped" as const : vehicle.vehicleClass === "police" || vehicle.vehicleClass === "medical" ? "responding" as const : "moving" as const,
        brakeLights: signalStop, updatedAt: input.timestamp
      }];
    });
}

function buildCrossings(input: StreetSceneInput, intersections: StreetIntersectionState[], segments: StreetSegmentState[]): StreetCrossingState[] {
  const phase = Math.floor(input.timestamp / 1_000) % 44;
  const explicit = intersections.filter((item) => item.kind === "crossing");
  const fallbackIds = new Set(segments.filter((segment) => segment.class === "arterial" || segment.class === "collector").flatMap((segment) => [segment.fromIntersectionId, segment.toIntersectionId]));
  const source = explicit.length >= 3 ? explicit : intersections.filter((item, index) => fallbackIds.has(item.id) && index % 2 === 0);
  return source.slice(0, 18).map((intersection, index) => {
    const localPhase = (phase + index * 7) % 44;
    return {
      id: createStableEntityId("street-crossing", intersection.id), intersectionId: intersection.id,
      xM: intersection.xM, yM: intersection.yM,
      signal: intersection.kind !== "crossing" ? "uncontrolled" as const : localPhase < 17 ? "walk" as const : "wait" as const,
      secondsRemaining: intersection.kind !== "crossing" ? 0 : localPhase < 17 ? 17 - localPhase : 44 - localPhase
    };
  });
}

const INCIDENT_COPY: Record<StreetIncidentType, { title: string; detail: string; responder: StreetIncidentState["responder"]; severity: 1 | 2 | 3 }> = {
  fight: { title: "Драка у тротуара", detail: "Двое сцепились у входа. Прохожие держатся подальше.", responder: "police", severity: 2 },
  robbery: { title: "Уличное ограбление", detail: "Человек требует вещи у прохожего и контролирует выход со двора.", responder: "police", severity: 3 },
  overdose: { title: "Человек без сознания", detail: "Рядом валяется пустой инъектор. Дыхание слабое.", responder: "medical", severity: 3 },
  arrest: { title: "Задержание", detail: "Патруль прижал человека к машине и проверяет документы.", responder: "police", severity: 2 },
  crash: { title: "Дорожная авария", detail: "Две машины перекрыли полосу. На асфальте обломки.", responder: "fire", severity: 3 },
  checkpoint: { title: "Проверка документов", detail: "Патруль остановил поток и выборочно сканирует прохожих.", responder: "police", severity: 2 },
  vendor: { title: "Уличный продавец", detail: "Нелегальный лоток работает до появления патруля.", responder: null, severity: 1 },
  breakdown: { title: "Сломанная машина", detail: "Машина стоит с открытым капотом и сужает проезд.", responder: "service", severity: 1 }
};

function incidentType(rng: SeededRandom): StreetIncidentType {
  return rng.pick(["fight", "robbery", "overdose", "arrest", "crash", "checkpoint", "vendor", "breakdown"] as const);
}

function generateIncident(input: StreetSceneInput, bucket: number, segments: StreetSegmentState[], nodes: Map<string, StreetIntersectionState>, pedestrians: StreetPedestrianState[], traffic: StreetTrafficState[]): StreetIncidentState | null {
  if (!segments.length) return null;
  const rng = new SeededRandom(`${input.seed}:street-incident:${input.localScene.focusSectorId}:${bucket}`);
  const activeChance = input.localScene.playerPosition.state === "outside" ? .34 : .12;
  if (!rng.chance(activeChance)) return null;
  const type = incidentType(rng);
  const segment = rng.pick(segments.filter((item) => item.class !== "lane").length ? segments.filter((item) => item.class !== "lane") : segments);
  const progress = .16 + rng.next() * .68;
  const point = pointOnSegment(segment, nodes, progress, type === "vendor" ? segment.widthM / 2 + segment.sidewalkLeftM * .45 : 0);
  if (!point) return null;
  const copy = INCIDENT_COPY[type];
  const nearestActors = [...pedestrians].sort((left, right) => distanceSquared(point.xM, point.yM, left) - distanceSquared(point.xM, point.yM, right));
  const nearestVehicles = [...traffic].sort((left, right) => distanceSquared(point.xM, point.yM, left) - distanceSquared(point.xM, point.yM, right));
  const startedAt = bucket * INCIDENT_BUCKET_MS;
  return {
    id: createStableEntityId("street-incident", `${input.seed}:${input.localScene.focusSectorId}:${bucket}:${type}`),
    type, status: type === "arrest" || type === "checkpoint" ? "responding" : "active",
    sectorId: input.localScene.focusSectorId, segmentId: segment.id, xM: point.xM, yM: point.yM,
    title: copy.title, detail: copy.detail, severity: copy.severity,
    participantActorIds: nearestActors.slice(0, type === "fight" || type === "robbery" ? 2 : 1).map((item) => item.actorId),
    involvedVehicleIds: ["crash", "breakdown", "arrest", "checkpoint"].includes(type) ? nearestVehicles.slice(0, type === "crash" ? 2 : 1).map((item) => item.vehicleId) : [],
    responder: copy.responder,
    startedAt, respondingAt: type === "arrest" || type === "checkpoint" ? startedAt : undefined,
    expiresAt: startedAt + rng.integer(24, 76) * 60_000,
    playerObserved: false, playerIntervened: false
  };
}

function updateIncidents(incidents: StreetIncidentState[], timestamp: number): { incidents: StreetIncidentState[]; resolvedIds: string[] } {
  const resolvedIds: string[] = [];
  const next = incidents.map((incident) => {
    if (incident.status === "resolved") return incident;
    let status: StreetIncidentState["status"] = incident.status;
    let respondingAt = incident.respondingAt;
    let resolvedAt = incident.resolvedAt;
    let outcome = incident.outcome;
    if (status === "reported" && incident.reportedAt && timestamp - incident.reportedAt >= 3 * 60_000) {
      status = "responding"; respondingAt = incident.reportedAt + 3 * 60_000;
    }
    if (status === "responding" && respondingAt && timestamp - respondingAt >= 9 * 60_000) {
      status = "resolved"; resolvedAt = respondingAt + 9 * 60_000; outcome = outcome ?? "Экстренная служба завершила работу на месте.";
    } else if (status === "active" && timestamp >= incident.expiresAt) {
      status = "resolved"; resolvedAt = incident.expiresAt; outcome = outcome ?? "Ситуация закончилась без участия игрока.";
    }
    if (status === "resolved") resolvedIds.push(incident.id);
    return { ...incident, status, respondingAt, resolvedAt, outcome };
  });
  return { incidents: next.filter((incident) => !incident.resolvedAt || timestamp - incident.resolvedAt < 60 * 60_000), resolvedIds };
}

function totals(state: Omit<StreetSceneState, "totals">): StreetSceneState["totals"] {
  return {
    pedestrians: state.pedestrians.length,
    movingPedestrians: state.pedestrians.filter((item) => item.motion === "walking" || item.motion === "crossing").length,
    traffic: state.traffic.length,
    movingTraffic: state.traffic.filter((item) => item.motion === "moving" || item.motion === "responding").length,
    activeIncidents: state.incidents.filter((item) => item.status !== "resolved").length,
    reportedIncidents: state.incidents.filter((item) => item.status === "reported" || item.status === "responding").length,
    crossings: state.crossings.length
  };
}

export function createStreetSceneState(input: StreetSceneInput): StreetSceneState {
  const bucket = Math.floor(input.timestamp / INCIDENT_BUCKET_MS);
  const seedState: StreetSceneState = {
    version: 1, focusSectorId: input.localScene.focusSectorId, pedestrians: [], traffic: [], crossings: [], incidents: [],
    lastIncidentBucket: bucket - 1,
    totals: { pedestrians: 0, movingPedestrians: 0, traffic: 0, movingTraffic: 0, activeIncidents: 0, reportedIncidents: 0, crossings: 0 },
    lastUpdatedAt: input.timestamp
  };
  return advanceStreetSceneState(seedState, input).state;
}

export function advanceStreetSceneState(current: StreetSceneState | undefined, input: StreetSceneInput): StreetSceneAdvanceResult {
  const topology = getSectorStreetTopology(input.streets, {
    timestamp: input.timestamp, seed: input.seed, metropolitan: input.metropolitan, urban: input.urban,
    preferredSectorId: input.localScene.focusSectorId
  }, input.localScene.focusSectorId);
  const nodes = new Map(topology.intersections.map((node) => [node.id, node]));
  const pedestrians = buildPedestrians(input, topology.segments, nodes);
  const traffic = buildTraffic(input, topology.segments, nodes);
  const crossings = buildCrossings(input, topology.intersections, topology.segments);
  const previous = current?.version === 1 ? current : createStreetSceneState({ ...input, timestamp: input.timestamp - INCIDENT_BUCKET_MS });
  const updated = updateIncidents(previous.incidents, input.timestamp);
  const targetBucket = Math.floor(input.timestamp / INCIDENT_BUCKET_MS);
  let incidents = updated.incidents;
  const spawnedIncidentIds: string[] = [];
  const notices: StreetSceneAdvanceResult["notices"] = [];
  const firstBucket = Math.max(previous.lastIncidentBucket + 1, targetBucket - 12);
  for (let bucket = firstBucket; bucket <= targetBucket; bucket += 1) {
    if (incidents.filter((item) => item.status !== "resolved").length >= MAX_ACTIVE_INCIDENTS) break;
    const incident = generateIncident(input, bucket, topology.segments, nodes, pedestrians, traffic);
    if (!incident || incidents.some((item) => item.id === incident.id)) continue;
    incidents.push(incident);
    spawnedIncidentIds.push(incident.id);
    notices.push({ title: incident.title, detail: `${incident.detail} · ${topology.segments.find((item) => item.id === incident.segmentId)?.name ?? "улица"}`, importance: incident.severity });
  }
  for (const id of updated.resolvedIds) {
    const incident = incidents.find((item) => item.id === id);
    if (incident) notices.push({ title: `Завершено: ${incident.title}`, detail: incident.outcome ?? "Улица вернулась к обычному движению.", importance: 1 });
  }
  const draft = {
    version: 1 as const, focusSectorId: input.localScene.focusSectorId, pedestrians, traffic, crossings, incidents,
    lastIncidentBucket: targetBucket, lastUpdatedAt: input.timestamp
  };
  return { state: { ...draft, totals: totals(draft) }, notices, spawnedIncidentIds, resolvedIncidentIds: updated.resolvedIds };
}

export function normalizeStreetSceneState(value: unknown, input: StreetSceneInput): StreetSceneState {
  const raw = value && typeof value === "object" ? value as Partial<StreetSceneState> : null;
  if (!raw || raw.version !== 1 || !Array.isArray(raw.incidents)) return createStreetSceneState(input);
  const current: StreetSceneState = {
    version: 1,
    focusSectorId: typeof raw.focusSectorId === "string" ? raw.focusSectorId : input.localScene.focusSectorId,
    pedestrians: [], traffic: [], crossings: [],
    incidents: raw.incidents.filter((item): item is StreetIncidentState => Boolean(item && typeof item.id === "string" && typeof item.type === "string")),
    lastIncidentBucket: typeof raw.lastIncidentBucket === "number" ? raw.lastIncidentBucket : Math.floor(input.timestamp / INCIDENT_BUCKET_MS) - 1,
    totals: raw.totals ?? { pedestrians: 0, movingPedestrians: 0, traffic: 0, movingTraffic: 0, activeIncidents: 0, reportedIncidents: 0, crossings: 0 },
    lastUpdatedAt: input.timestamp
  };
  return advanceStreetSceneState(current, input).state;
}

export function applyStreetIncidentAction(state: StreetSceneState, incidentId: string, action: StreetIncidentAction, timestamp: number): StreetSceneState {
  const incidents = state.incidents.map((incident) => {
    if (incident.id !== incidentId || incident.status === "resolved") return incident;
    if (action === "observe") return { ...incident, playerObserved: true };
    if (action === "call-help") return incident.status === "active" ? { ...incident, status: "reported" as const, reportedAt: timestamp, playerObserved: true } : incident;
    if (action === "intervene") return {
      ...incident, status: "resolved" as const, resolvedAt: timestamp, playerObserved: true, playerIntervened: true,
      outcome: incident.type === "overdose" ? "Игрок стабилизировал пострадавшего до приезда медиков." : incident.type === "vendor" ? "Продавец свернул лоток после разговора." : "Игрок вмешался и остановил ситуацию."
    };
    return { ...incident, playerObserved: true };
  });
  const draft = { ...state, incidents, lastUpdatedAt: timestamp };
  return { ...draft, totals: totals(draft) };
}
