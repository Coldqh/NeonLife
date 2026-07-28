import { createStableEntityId } from "../../core/ids/entityId";
import type { GameSession } from "../../world/state/types";
import type { MetropolitanSectorState } from "../spatial/types";
import { getSectorStreetTopology } from "../streets/streetTopologySystem";
import type { StreetSegmentState } from "../streets/types";
import type {
  LocalMovementAdvanceResult,
  LocalMovementRoutePointState,
  LocalMovementState,
  LocalMovementTargetState
} from "./types";

export const WALKING_SPEED_M_PER_MINUTE = 78;
const MAX_LOCAL_SECTOR_SPAN = 8;

interface GraphEdge {
  to: string;
  distanceM: number;
  streetName: string;
  streetSegmentId: string;
}

interface GraphNode {
  key: string;
  xM: number;
  yM: number;
  sectorId: string;
  edges: GraphEdge[];
}

function distance(left: { xM: number; yM: number }, right: { xM: number; yM: number }): number {
  return Math.hypot(left.xM - right.xM, left.yM - right.yM);
}

function coordinateKey(xM: number, yM: number): string {
  return `${Math.round(xM * 10)}:${Math.round(yM * 10)}`;
}

function sectorAtPoint(session: GameSession, xM: number, yM: number, fallback: string): string {
  return session.metropolitan.sectors.find((sector) => xM >= sector.bounds.xM
    && xM <= sector.bounds.xM + sector.bounds.widthM
    && yM >= sector.bounds.yM
    && yM <= sector.bounds.yM + sector.bounds.heightM)?.id ?? fallback;
}

function topologyInput(session: GameSession, preferredSectorId?: string) {
  return {
    timestamp: session.timestamp,
    seed: session.world.meta.seed,
    metropolitan: session.metropolitan,
    urban: session.urban,
    preferredSectorId
  };
}

function streetRevision(session: GameSession): string {
  const lastDelta = session.streets.deltas.reduce((latest, delta) => Math.max(latest, delta.updatedAt), 0);
  return `${session.streets.topologyVersion}:${session.streets.deltas.length}:${lastDelta}`;
}

function corridorSectors(session: GameSession, originSector: MetropolitanSectorState, targetSector: MetropolitanSectorState): MetropolitanSectorState[] {
  const horizontal = Math.abs(originSector.xIndex - targetSector.xIndex);
  const vertical = Math.abs(originSector.yIndex - targetSector.yIndex);
  if (horizontal + vertical > MAX_LOCAL_SECTOR_SPAN) return [];
  const minX = Math.max(0, Math.min(originSector.xIndex, targetSector.xIndex) - 1);
  const maxX = Math.min(session.metropolitan.config.sectorsWide - 1, Math.max(originSector.xIndex, targetSector.xIndex) + 1);
  const minY = Math.max(0, Math.min(originSector.yIndex, targetSector.yIndex) - 1);
  const maxY = Math.min(session.metropolitan.config.sectorsHigh - 1, Math.max(originSector.yIndex, targetSector.yIndex) + 1);
  return session.metropolitan.sectors.filter((sector) => sector.xIndex >= minX && sector.xIndex <= maxX && sector.yIndex >= minY && sector.yIndex <= maxY);
}

function buildGraph(session: GameSession, sectors: MetropolitanSectorState[]): Map<string, GraphNode> {
  const graph = new Map<string, GraphNode>();
  for (const sector of sectors) {
    const topology = getSectorStreetTopology(session.streets, topologyInput(session, sector.id), sector.id);
    const intersectionById = new Map(topology.intersections.map((intersection) => [intersection.id, intersection]));
    for (const intersection of topology.intersections) {
      const key = coordinateKey(intersection.xM, intersection.yM);
      if (!graph.has(key)) graph.set(key, { key, xM: intersection.xM, yM: intersection.yM, sectorId: sector.id, edges: [] });
    }
    for (const segment of topology.segments) {
      const from = intersectionById.get(segment.fromIntersectionId);
      const to = intersectionById.get(segment.toIntersectionId);
      if (!from || !to) continue;
      const fromKey = coordinateKey(from.xM, from.yM);
      const toKey = coordinateKey(to.xM, to.yM);
      const fromNode = graph.get(fromKey);
      const toNode = graph.get(toKey);
      if (!fromNode || !toNode) continue;
      const weight = Math.max(.1, distance(from, to));
      fromNode.edges.push({ to: toKey, distanceM: weight, streetName: segment.name, streetSegmentId: segment.id });
      toNode.edges.push({ to: fromKey, distanceM: weight, streetName: segment.name, streetSegmentId: segment.id });
    }
  }
  return graph;
}

function nearestNode(graph: Map<string, GraphNode>, point: { xM: number; yM: number }, sectorId?: string): GraphNode | null {
  let best: GraphNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of graph.values()) {
    if (sectorId && node.sectorId !== sectorId) {
      const nodeDistance = distance(node, point);
      if (nodeDistance > 240) continue;
    }
    const nodeDistance = distance(node, point);
    if (nodeDistance < bestDistance) {
      best = node;
      bestDistance = nodeDistance;
    }
  }
  return best;
}

function findPath(graph: Map<string, GraphNode>, start: GraphNode, goal: GraphNode): Array<{ node: GraphNode; edge?: GraphEdge }> | null {
  const open = new Set<string>([start.key]);
  const cost = new Map<string, number>([[start.key, 0]]);
  const score = new Map<string, number>([[start.key, distance(start, goal)]]);
  const parent = new Map<string, { from: string; edge: GraphEdge }>();

  while (open.size) {
    let currentKey: string | null = null;
    let currentScore = Number.POSITIVE_INFINITY;
    for (const key of open) {
      const value = score.get(key) ?? Number.POSITIVE_INFINITY;
      if (value < currentScore) {
        currentKey = key;
        currentScore = value;
      }
    }
    if (!currentKey) break;
    if (currentKey === goal.key) {
      const keys: string[] = [goal.key];
      while (keys[0] !== start.key) {
        const link = parent.get(keys[0]);
        if (!link) return null;
        keys.unshift(link.from);
      }
      return keys.map((key, index) => ({ node: graph.get(key)!, edge: index ? parent.get(key)?.edge : undefined }));
    }
    open.delete(currentKey);
    const current = graph.get(currentKey);
    if (!current) continue;
    for (const edge of current.edges) {
      const next = graph.get(edge.to);
      if (!next) continue;
      const nextCost = (cost.get(currentKey) ?? Number.POSITIVE_INFINITY) + edge.distanceM;
      if (nextCost >= (cost.get(next.key) ?? Number.POSITIVE_INFINITY)) continue;
      parent.set(next.key, { from: currentKey, edge });
      cost.set(next.key, nextCost);
      score.set(next.key, nextCost + distance(next, goal));
      open.add(next.key);
    }
  }
  return null;
}

function dedupePoints(points: LocalMovementRoutePointState[]): LocalMovementRoutePointState[] {
  const result: LocalMovementRoutePointState[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (previous && distance(previous, point) < .5) {
      result[result.length - 1] = { ...previous, ...point };
      continue;
    }
    result.push(point);
  }
  return result;
}

function orderedStreetNames(points: LocalMovementRoutePointState[]): string[] {
  const names: string[] = [];
  for (const point of points) {
    if (!point.streetName || names[names.length - 1] === point.streetName) continue;
    names.push(point.streetName);
  }
  return names;
}

export function planLocalMovement(session: GameSession, targetInput: LocalMovementTargetState): LocalMovementState | null {
  if (session.localScene.playerPosition.state !== "outside" || session.transit.player.journey) return null;
  const target = refreshLocalMovementTarget(session, targetInput);
  const origin = session.localScene.playerPosition;
  if (distance(origin, target) < 2) return null;
  const originSector = session.metropolitan.sectors.find((sector) => sector.id === origin.sectorId);
  const targetSector = session.metropolitan.sectors.find((sector) => sector.id === target.sectorId);
  if (!originSector || !targetSector) return null;
  const sectors = corridorSectors(session, originSector, targetSector);
  if (!sectors.length) return null;
  const graph = buildGraph(session, sectors);
  const routingTarget = { xM: target.approachXM ?? target.xM, yM: target.approachYM ?? target.yM };
  const start = nearestNode(graph, origin, originSector.id);
  const goal = nearestNode(graph, routingTarget, targetSector.id);
  if (!start || !goal) return null;
  const path = findPath(graph, start, goal);
  if (!path) return null;

  const points = dedupePoints([
    { sectorId: origin.sectorId, xM: origin.xM, yM: origin.yM },
    ...path.map(({ node, edge }) => ({
      sectorId: sectorAtPoint(session, node.xM, node.yM, node.sectorId),
      xM: node.xM,
      yM: node.yM,
      streetName: edge?.streetName,
      streetSegmentId: edge?.streetSegmentId
    })),
    { sectorId: target.sectorId, xM: routingTarget.xM, yM: routingTarget.yM, streetName: path[path.length - 1]?.edge?.streetName, streetSegmentId: path[path.length - 1]?.edge?.streetSegmentId },
    { sectorId: target.sectorId, xM: target.xM, yM: target.yM, streetName: path[path.length - 1]?.edge?.streetName, streetSegmentId: path[path.length - 1]?.edge?.streetSegmentId }
  ]);
  if (points.length < 2) return null;
  const totalDistanceM = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
  if (!Number.isFinite(totalDistanceM) || totalDistanceM < 2) return null;
  return {
    version: 1,
    id: createStableEntityId("local-movement", `${session.world.meta.seed}:${session.timestamp}:${target.kind}:${target.id}:${Math.round(origin.xM)}:${Math.round(origin.yM)}`),
    status: "walking",
    target,
    points,
    streetNames: orderedStreetNames(points),
    totalDistanceM: Math.round(totalDistanceM * 10) / 10,
    travelledM: 0,
    remainingDistanceM: Math.round(totalDistanceM * 10) / 10,
    estimatedMinutes: Math.max(1, Math.ceil(totalDistanceM / WALKING_SPEED_M_PER_MINUTE)),
    currentLegIndex: 0,
    currentLegProgressM: 0,
    topologyVersion: session.streets.topologyVersion,
    streetDeltaCount: session.streets.deltas.length,
    streetRevision: streetRevision(session),
    startedAt: session.timestamp,
    updatedAt: session.timestamp
  };
}

function topologyForBuilding(session: GameSession, buildingId: string) {
  const building = session.urban.buildings.find((item) => item.id === buildingId);
  if (!building) return null;
  const topology = getSectorStreetTopology(session.streets, topologyInput(session, building.sectorId), building.sectorId);
  const entrance = topology.buildingEntrances.find((item) => item.buildingId === building.id && item.kind === "public")
    ?? topology.buildingEntrances.find((item) => item.buildingId === building.id);
  return { building, entrance };
}

export function localMovementTargetForLocation(session: GameSession, locationId: string): LocalMovementTargetState | null {
  const location = session.world.locations.find((item) => item.id === locationId);
  const placement = session.metropolitan.locations.find((item) => item.locationId === locationId);
  if (!location || !placement) return null;
  const building = session.urban.buildings.find((item) => item.anchorLocationId === locationId);
  if (building) {
    const resolved = topologyForBuilding(session, building.id);
    if (resolved?.entrance) return {
      kind: "location", id: location.id, label: location.name, sectorId: building.sectorId,
      xM: resolved.entrance.xM, yM: resolved.entrance.yM,
      approachXM: resolved.entrance.walkwayTo.xM, approachYM: resolved.entrance.walkwayTo.yM,
      locationId: location.id, buildingId: building.id
    };
  }
  return {
    kind: "location", id: location.id, label: location.name, sectorId: placement.sectorId,
    xM: placement.bounds.xM + placement.bounds.widthM / 2,
    yM: placement.bounds.yM + placement.bounds.heightM / 2,
    locationId: location.id
  };
}

export function localMovementTargetForBuilding(session: GameSession, buildingId: string): LocalMovementTargetState | null {
  const resolved = topologyForBuilding(session, buildingId);
  if (!resolved) return null;
  const { building, entrance } = resolved;
  return {
    kind: "building", id: building.id, label: building.addressCode, sectorId: building.sectorId,
    xM: entrance?.xM ?? building.bounds.xM + building.bounds.widthM / 2,
    yM: entrance?.yM ?? building.bounds.yM + building.bounds.heightM / 2,
    approachXM: entrance?.walkwayTo.xM,
    approachYM: entrance?.walkwayTo.yM,
    locationId: building.anchorLocationId,
    buildingId: building.id
  };
}

export function localMovementTargetForStop(session: GameSession, stopId: string): LocalMovementTargetState | null {
  const stop = session.transit.stops.find((item) => item.id === stopId);
  return stop ? { kind: "stop", id: stop.id, label: stop.name, sectorId: stop.sectorId, xM: stop.xM, yM: stop.yM, stopId: stop.id } : null;
}

export function localMovementTargetForVehicle(session: GameSession, vehicleId: string): LocalMovementTargetState | null {
  const vehicle = session.vehicles.vehicles.find((item) => item.id === vehicleId);
  if (!vehicle || vehicle.state === "moving") return null;
  return { kind: "vehicle", id: vehicle.id, label: `${vehicle.modelName} · ${vehicle.plate}`, sectorId: vehicle.position.sectorId, xM: vehicle.position.xM, yM: vehicle.position.yM, locationId: vehicle.position.locationId, vehicleId: vehicle.id };
}

export function localMovementTargetForActor(session: GameSession, actorId: string): LocalMovementTargetState | null {
  const actor = session.localScene.actors.find((item) => item.id === actorId);
  if (!actor) return null;
  if (actor.position.state === "inside" && actor.position.buildingId) {
    const entrance = localMovementTargetForBuilding(session, actor.position.buildingId);
    return entrance ? { ...entrance, kind: "person", id: actor.id, label: actor.name, actorId: actor.id } : null;
  }
  if (actor.position.state !== "outside") return null;
  return { kind: "person", id: actor.id, label: actor.name, sectorId: actor.position.sectorId, xM: actor.position.xM, yM: actor.position.yM, locationId: actor.position.locationId, actorId: actor.id };
}

export function localMovementTargetForPoint(session: GameSession, sectorId: string, xM: number, yM: number, label = "Точка на карте", streetSegment?: StreetSegmentState): LocalMovementTargetState {
  return {
    kind: streetSegment ? "street" : "point",
    id: createStableEntityId(streetSegment ? "street-target" : "point-target", `${session.world.meta.seed}:${sectorId}:${Math.round(xM)}:${Math.round(yM)}:${streetSegment?.id ?? "point"}`),
    label,
    sectorId,
    xM,
    yM,
    streetSegmentId: streetSegment?.id
  };
}

export function refreshLocalMovementTarget(session: GameSession, target: LocalMovementTargetState): LocalMovementTargetState {
  if (target.buildingId && target.kind === "building") return localMovementTargetForBuilding(session, target.buildingId) ?? target;
  if (target.stopId) return localMovementTargetForStop(session, target.stopId) ?? target;
  if (target.vehicleId) return localMovementTargetForVehicle(session, target.vehicleId) ?? target;
  if (target.actorId) return localMovementTargetForActor(session, target.actorId) ?? target;
  if (target.locationId) return localMovementTargetForLocation(session, target.locationId) ?? target;
  return target;
}

export function refreshLocalMovementRoute(session: GameSession, route: LocalMovementState): LocalMovementState | null {
  const target = refreshLocalMovementTarget(session, route.target);
  const routeEnd = route.points[route.points.length - 1] ?? route.target;
  const movedTarget = distance(target, routeEnd) > 12 || target.sectorId !== routeEnd.sectorId;
  const topologyStable = route.topologyVersion === session.streets.topologyVersion
    && route.streetDeltaCount === session.streets.deltas.length
    && route.streetRevision === streetRevision(session);
  if (topologyStable && !movedTarget) return route;
  const replanned = planLocalMovement({ ...session, localMovement: undefined }, target);
  return replanned ? { ...replanned, id: route.id, startedAt: route.startedAt, replannedAt: session.timestamp } : null;
}

export function advanceLocalMovementRoute(session: GameSession, routeInput: LocalMovementState, minutes: number): LocalMovementAdvanceResult {
  const route = refreshLocalMovementRoute(session, routeInput) ?? routeInput;
  if (route.status === "arrived" || route.points.length < 2 || minutes <= 0) {
    const final = route.points[Math.min(route.currentLegIndex, route.points.length - 1)] ?? route.target;
    return { route, position: { sectorId: final.sectorId, xM: final.xM, yM: final.yM } };
  }
  let remainingStepM = minutes * WALKING_SPEED_M_PER_MINUTE;
  let legIndex = route.currentLegIndex;
  let legProgress = route.currentLegProgressM;
  let travelled = route.travelledM;
  let xM = route.points[legIndex].xM;
  let yM = route.points[legIndex].yM;
  let sectorId = route.points[legIndex].sectorId;

  while (remainingStepM > 0 && legIndex < route.points.length - 1) {
    const from = route.points[legIndex];
    const to = route.points[legIndex + 1];
    const legLength = Math.max(.001, distance(from, to));
    const available = Math.max(0, legLength - legProgress);
    const consumed = Math.min(available, remainingStepM);
    legProgress += consumed;
    travelled += consumed;
    remainingStepM -= consumed;
    const ratio = Math.min(1, legProgress / legLength);
    xM = from.xM + (to.xM - from.xM) * ratio;
    yM = from.yM + (to.yM - from.yM) * ratio;
    sectorId = sectorAtPoint(session, xM, yM, ratio >= .999 ? to.sectorId : from.sectorId);
    if (legProgress + .01 >= legLength) {
      legIndex += 1;
      legProgress = 0;
      xM = to.xM;
      yM = to.yM;
      sectorId = to.sectorId;
    }
  }

  const arrived = legIndex >= route.points.length - 1;
  const travelledM = Math.min(route.totalDistanceM, travelled);
  const remainingDistanceM = Math.max(0, route.totalDistanceM - travelledM);
  return {
    route: {
      ...route,
      status: arrived ? "arrived" : "walking",
      target: refreshLocalMovementTarget(session, route.target),
      currentLegIndex: Math.min(legIndex, route.points.length - 1),
      currentLegProgressM: arrived ? 0 : legProgress,
      travelledM: Math.round(travelledM * 10) / 10,
      remainingDistanceM: Math.round(remainingDistanceM * 10) / 10,
      estimatedMinutes: arrived ? 0 : Math.max(1, Math.ceil(remainingDistanceM / WALKING_SPEED_M_PER_MINUTE)),
      updatedAt: session.timestamp + minutes * 60_000,
      arrivedAt: arrived ? session.timestamp + minutes * 60_000 : undefined
    },
    position: { sectorId, xM: Math.round(xM * 10) / 10, yM: Math.round(yM * 10) / 10 }
  };
}

export function localMovementCurrentStreet(route: LocalMovementState): string {
  return route.points[Math.min(route.currentLegIndex + 1, route.points.length - 1)]?.streetName
    ?? route.points[route.currentLegIndex]?.streetName
    ?? route.streetNames[0]
    ?? "Пешеходный участок";
}
