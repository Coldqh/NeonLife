import type { MapDistrictState, MetropolitanSectorState, MetricBounds } from "../../simulation/spatial/types";

export interface CameraState { zoom: number; panX: number; panY: number }
export interface GridPoint { x: number; y: number }
export interface GridLoop { points: GridPoint[] }

export const CAMERA_KEY = "neon-life/global-map-camera/v3";
export const MIN_ZOOM = 0.82;
export const MAX_ZOOM = 8;
export const DISTRICT_PALETTE = ["#ff4058", "#3f91ff", "#ff8b35", "#42d896", "#a565ff", "#23c8cb", "#ffc348", "#e76aa3", "#7b8cff", "#65d6a5", "#ff635f", "#5cc0ff", "#c46cff", "#e2b84f"];
export const RAIL_PALETTE = ["#ff3854", "#a86dff", "#2fc7c0", "#ffb33e", "#4b9cff", "#e66d9d"];

export function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function pointKey(point: GridPoint): string { return `${point.x}:${point.y}`; }
function edgeKey(from: GridPoint, to: GridPoint): string { return `${pointKey(from)}>${pointKey(to)}`; }
export function districtColor(index: number): string { return DISTRICT_PALETTE[index % DISTRICT_PALETTE.length]; }
export function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
export function stringHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
export function seededUnit(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}
export function loadCamera(): CameraState {
  try {
    const value = JSON.parse(localStorage.getItem(CAMERA_KEY) ?? "null") as Partial<CameraState> | null;
    if (value && [value.zoom, value.panX, value.panY].every((item) => typeof item === "number" && Number.isFinite(item))) {
      return { zoom: clamp(value.zoom ?? 1, MIN_ZOOM, MAX_ZOOM), panX: value.panX ?? 0, panY: value.panY ?? 0 };
    }
  } catch { /* optional UI state */ }
  return { zoom: 1, panX: 0, panY: 0 };
}
export function constrainedCamera(camera: CameraState, width: number, height: number, columns: number, rows: number): CameraState {
  const zoom = clamp(camera.zoom, MIN_ZOOM, MAX_ZOOM);
  const baseScale = Math.min((width - 34) / columns, (height - 34) / rows);
  const worldWidth = columns * baseScale * zoom;
  const worldHeight = rows * baseScale * zoom;
  const maxPanX = Math.max(0, (worldWidth - width) / 2 + 72);
  const maxPanY = Math.max(0, (worldHeight - height) / 2 + 72);
  return { zoom, panX: clamp(camera.panX, -maxPanX, maxPanX), panY: clamp(camera.panY, -maxPanY, maxPanY) };
}
export function boundaryLoops(sectors: MetropolitanSectorState[], districtId?: string): GridLoop[] {
  const edges = new Map<string, { from: GridPoint; to: GridPoint }>();
  const add = (from: GridPoint, to: GridPoint) => {
    const reverse = edgeKey(to, from);
    if (edges.has(reverse)) edges.delete(reverse);
    else edges.set(edgeKey(from, to), { from, to });
  };
  for (const sector of sectors) {
    if (districtId && sector.mapDistrictId !== districtId) continue;
    const x = sector.xIndex; const y = sector.yIndex;
    add({ x, y }, { x: x + 1, y });
    add({ x: x + 1, y }, { x: x + 1, y: y + 1 });
    add({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
    add({ x, y: y + 1 }, { x, y });
  }
  const outgoing = new Map<string, string[]>();
  for (const [key, edge] of edges) {
    const list = outgoing.get(pointKey(edge.from)) ?? [];
    list.push(key);
    outgoing.set(pointKey(edge.from), list);
  }
  const remaining = new Set(edges.keys());
  const loops: GridLoop[] = [];
  while (remaining.size) {
    const firstKey = remaining.values().next().value as string;
    const first = edges.get(firstKey);
    if (!first) { remaining.delete(firstKey); continue; }
    const points: GridPoint[] = [first.from];
    let currentKey = firstKey;
    let guard = 0;
    while (remaining.has(currentKey) && guard < edges.size + 8) {
      guard += 1;
      const current = edges.get(currentKey);
      if (!current) break;
      remaining.delete(currentKey);
      points.push(current.to);
      if (pointKey(current.to) === pointKey(first.from)) break;
      const candidates = (outgoing.get(pointKey(current.to)) ?? []).filter((candidate) => remaining.has(candidate));
      if (!candidates.length) break;
      const direction = (from: GridPoint, to: GridPoint): number => to.x > from.x ? 0 : to.y > from.y ? 1 : to.x < from.x ? 2 : 3;
      const currentDirection = direction(current.from, current.to);
      const turnPriority = [1, 0, 3, 2]; // keep occupied cells on the right; do not join diagonal islands
      candidates.sort((leftKey, rightKey) => {
        const left = edges.get(leftKey); const right = edges.get(rightKey);
        if (!left || !right) return 0;
        const leftTurn = (direction(left.from, left.to) - currentDirection + 4) % 4;
        const rightTurn = (direction(right.from, right.to) - currentDirection + 4) % 4;
        return turnPriority.indexOf(leftTurn) - turnPriority.indexOf(rightTurn);
      });
      currentKey = candidates[0];
    }
    if (points.length >= 4) {
      const compact: GridPoint[] = [];
      for (const point of points) {
        const previous = compact[compact.length - 1];
        const before = compact[compact.length - 2];
        if (before && previous && (before.x === previous.x && previous.x === point.x || before.y === previous.y && previous.y === point.y)) compact[compact.length - 1] = point;
        else compact.push(point);
      }
      loops.push({ points: compact });
    }
  }
  return loops;
}
export function rawLoopPath(loops: GridLoop[], originX: number, originY: number, scale: number): Path2D {
  const path = new Path2D();
  for (const loop of loops) {
    if (!loop.points.length) continue;
    path.moveTo(originX + loop.points[0].x * scale, originY + loop.points[0].y * scale);
    for (let index = 1; index < loop.points.length; index += 1) path.lineTo(originX + loop.points[index].x * scale, originY + loop.points[index].y * scale);
    path.closePath();
  }
  return path;
}
export function roundedLoopPath(loops: GridLoop[], originX: number, originY: number, scale: number, radius: number): Path2D {
  const path = new Path2D();
  for (const loop of loops) {
    const source = loop.points.slice(0, -1);
    if (source.length < 3) continue;
    const points = source.map((point) => ({ x: originX + point.x * scale, y: originY + point.y * scale }));
    for (let index = 0; index < points.length; index += 1) {
      const previous = points[(index - 1 + points.length) % points.length];
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const previousLength = Math.hypot(current.x - previous.x, current.y - previous.y);
      const nextLength = Math.hypot(next.x - current.x, next.y - current.y);
      const corner = Math.min(radius, previousLength * .34, nextLength * .34);
      const before = { x: current.x + (previous.x - current.x) / Math.max(.001, previousLength) * corner, y: current.y + (previous.y - current.y) / Math.max(.001, previousLength) * corner };
      const after = { x: current.x + (next.x - current.x) / Math.max(.001, nextLength) * corner, y: current.y + (next.y - current.y) / Math.max(.001, nextLength) * corner };
      if (!index) path.moveTo(before.x, before.y); else path.lineTo(before.x, before.y);
      path.quadraticCurveTo(current.x, current.y, after.x, after.y);
    }
    path.closePath();
  }
  return path;
}
export function districtBounds(district: MapDistrictState): MetricBounds { return district.bounds; }
export function riskLabel(value: number): string { return value >= 72 ? "КРИТИЧЕСКИЙ" : value >= 55 ? "ВЫСОКИЙ" : value >= 35 ? "СРЕДНИЙ" : "НИЗКИЙ"; }
