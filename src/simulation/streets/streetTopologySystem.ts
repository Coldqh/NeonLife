import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { TransitOperationsState } from "../transit/types";
import type { PhysicalVehiclesState } from "../vehicles/types";
import type { BuildingState, UrbanFabricState } from "../urban/types";
import type { MetricBounds, MetricPoint, MetropolitanSectorState, SectorLandUse } from "../spatial/types";
import type {
  BuildingEntranceAnchorState,
  MaterializedSectorStreetTopologyState,
  ParkingZoneState,
  SectorStreetCatalogState,
  StreetBlockState,
  StreetClass,
  StreetEdge,
  StreetEdgePortState,
  StreetIntersectionState,
  StreetParcelState,
  StreetPattern,
  StreetSegmentState,
  StreetTopologyInput,
  StreetTopologyState,
  StreetTopologyTotalsState
} from "./types";

const TOPOLOGY_VERSION = 2;
const CACHE_LIMIT = 64;
const CANDIDATE_OFFSETS = [125, 250, 375, 500, 625, 750, 875] as const;
const STREET_NAMES = [
  "Неоновая улица", "Контурный проезд", "Сетевая линия", "Шлаковая улица",
  "Релейный переулок", "Кольцевая магистраль", "Терминальный тракт", "Северная аллея",
  "Южная улица", "Сборочный проезд", "Тихая набережная", "Высотная линия",
  "Складской тракт", "Дождевая улица", "Рыночная аллея", "Портовая магистраль",
  "Искровой переулок", "Транзитная улица", "Медный проезд", "Стеклянная линия",
  "Кабельная улица", "Сервисный тракт", "Крановая набережная", "Нулевая аллея"
] as const;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, precision = 100): number {
  return Math.round(value * precision) / precision;
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function boundaryKey(sector: MetropolitanSectorState, edge: StreetEdge): string {
  if (edge === "north") return `h:${sector.xIndex}:${sector.yIndex}`;
  if (edge === "south") return `h:${sector.xIndex}:${sector.yIndex + 1}`;
  if (edge === "west") return `v:${sector.xIndex}:${sector.yIndex}`;
  return `v:${sector.xIndex + 1}:${sector.yIndex}`;
}

function isOuterEdge(sector: MetropolitanSectorState, edge: StreetEdge, wide: number, high: number): boolean {
  return edge === "north" ? sector.yIndex === 0
    : edge === "south" ? sector.yIndex === high - 1
      : edge === "west" ? sector.xIndex === 0
        : sector.xIndex === wide - 1;
}

function edgePorts(seed: string, sector: MetropolitanSectorState, wide: number, high: number): StreetEdgePortState[] {
  const ports: StreetEdgePortState[] = [];
  for (const edge of ["north", "east", "south", "west"] as const) {
    if (isOuterEdge(sector, edge, wide, high)) continue;
    const key = boundaryKey(sector, edge);
    const rng = new SeededRandom(`${seed}:street-boundary:${key}:v${TOPOLOGY_VERSION}`);
    const count = rng.chance(0.34) ? 2 : 1;
    const picked = new Set<number>();
    while (picked.size < count) picked.add(CANDIDATE_OFFSETS[rng.integer(0, CANDIDATE_OFFSETS.length - 1)]);
    [...picked].sort((left, right) => left - right).forEach((offsetM, index) => {
      ports.push({
        edge,
        offsetM,
        class: index === 0 && (offsetM === 500 || rng.chance(0.3)) ? "collector" : "local",
        boundaryKey: key
      });
    });
  }
  return ports;
}

function patternFor(landUse: SectorLandUse): StreetPattern {
  if (landUse === "industrial" || landUse === "transport" || landUse === "utility") return "industrial-spine";
  if (landUse === "corporate" || landUse === "civic") return "corporate-superblock";
  if (landUse === "vacant") return "sparse-service";
  if (landUse === "residential") return "residential-grid";
  return "fine-grid";
}

function internalOffsets(pattern: StreetPattern): number[] {
  if (pattern === "fine-grid") return [125, 250, 375, 500, 625, 750, 875];
  if (pattern === "residential-grid") return [250, 500, 750];
  if (pattern === "industrial-spine") return [250, 500, 750];
  if (pattern === "corporate-superblock") return [250, 500, 750];
  return [500];
}

function streetNamePool(seed: string, sector: MetropolitanSectorState): string[] {
  const rng = new SeededRandom(`${seed}:street-names:${sector.mapDistrictId}:${sector.xIndex}:${sector.yIndex}`);
  const names = new Set<string>();
  while (names.size < 12) names.add(STREET_NAMES[rng.integer(0, STREET_NAMES.length - 1)]);
  return [...names];
}

function catalogFor(input: StreetTopologyInput, sector: MetropolitanSectorState): SectorStreetCatalogState {
  const pattern = patternFor(sector.landUse);
  const ports = edgePorts(input.seed, sector, input.metropolitan.config.sectorsWide, input.metropolitan.config.sectorsHigh);
  const offsets = new Set([...internalOffsets(pattern), ...ports.map((port) => port.offsetM)]);
  const axisCount = offsets.size;
  return {
    sectorId: sector.id,
    districtId: sector.districtId,
    mapDistrictId: sector.mapDistrictId,
    seed: `${input.seed}:street-topology:${sector.id}:v${TOPOLOGY_VERSION}`,
    topologyVersion: TOPOLOGY_VERSION,
    pattern,
    landUse: sector.landUse,
    edgePorts: ports,
    streetNamePool: streetNamePool(input.seed, sector),
    estimatedBlocks: Math.max(1, (axisCount + 1) ** 2),
    estimatedParcels: Math.max(1, Math.round((axisCount + 1) ** 2 * (pattern === "fine-grid" ? 2.2 : pattern === "residential-grid" ? 1.7 : 1.25))),
    lastMaterializedAt: input.timestamp
  };
}

function classMetrics(roadClass: StreetClass): { lanes: number; widthM: number; speed: number; sidewalk: number } {
  if (roadClass === "arterial") return { lanes: 4, widthM: 11, speed: 60, sidewalk: 3.5 };
  if (roadClass === "collector") return { lanes: 2, widthM: 10, speed: 45, sidewalk: 3 };
  if (roadClass === "local") return { lanes: 2, widthM: 8, speed: 30, sidewalk: 2.5 };
  return { lanes: 1, widthM: 6, speed: 20, sidewalk: 1.8 };
}

function roadClassFor(offsetM: number, pattern: StreetPattern, boundaryConnected: boolean): StreetClass {
  if (offsetM === 500) return "arterial";
  if (boundaryConnected) return "collector";
  if (pattern === "fine-grid" && offsetM % 250 !== 0) return "lane";
  if (pattern === "industrial-spine" || pattern === "corporate-superblock") return "collector";
  return "local";
}

function lineName(
  citySeed: string,
  catalog: SectorStreetCatalogState,
  sector: MetropolitanSectorState,
  orientation: "horizontal" | "vertical",
  offsetM: number
): string {
  const globalAxisM = Math.round((orientation === "horizontal" ? sector.bounds.yM : sector.bounds.xM) + offsetM);
  const rng = new SeededRandom(`${citySeed}:continuous-street:${orientation}:${globalAxisM}:v${TOPOLOGY_VERSION}`);
  const base = STREET_NAMES[rng.integer(0, STREET_NAMES.length - 1)];
  if (catalog.pattern === "industrial-spine" && rng.chance(.42)) return base.replace("улица", "тракт").replace("аллея", "проезд");
  return base;
}

function materializeIntersections(
  sector: MetropolitanSectorState,
  catalog: SectorStreetCatalogState,
  xLines: number[],
  yLines: number[]
): StreetIntersectionState[] {
  const northOffsets = new Set(catalog.edgePorts.filter((port) => port.edge === "north").map((port) => port.offsetM));
  const southOffsets = new Set(catalog.edgePorts.filter((port) => port.edge === "south").map((port) => port.offsetM));
  const westOffsets = new Set(catalog.edgePorts.filter((port) => port.edge === "west").map((port) => port.offsetM));
  const eastOffsets = new Set(catalog.edgePorts.filter((port) => port.edge === "east").map((port) => port.offsetM));
  const points: StreetIntersectionState[] = [];
  for (const x of xLines) {
    for (const y of yLines) {
      const gate = y === 0 && northOffsets.has(x)
        || y === sector.bounds.heightM && southOffsets.has(x)
        || x === 0 && westOffsets.has(y)
        || x === sector.bounds.widthM && eastOffsets.has(y);
      points.push({
        id: createStableEntityId("street-node", `${catalog.seed}:${x}:${y}`),
        sectorId: sector.id,
        xM: sector.bounds.xM + x,
        yM: sector.bounds.yM + y,
        kind: gate ? "sector-gate" : "junction"
      });
    }
  }
  return points;
}

function materializeSegments(
  citySeed: string,
  sector: MetropolitanSectorState,
  catalog: SectorStreetCatalogState,
  intersections: StreetIntersectionState[],
  xLines: number[],
  yLines: number[]
): StreetSegmentState[] {
  const byLocal = new Map(intersections.map((node) => [`${Math.round(node.xM - sector.bounds.xM)}:${Math.round(node.yM - sector.bounds.yM)}`, node]));
  const boundaryOffsets = new Set(catalog.edgePorts.map((port) => port.offsetM));
  const segments: StreetSegmentState[] = [];
  const add = (orientation: "horizontal" | "vertical", fixed: number, start: number, end: number) => {
    const fromLocal = orientation === "horizontal" ? `${start}:${fixed}` : `${fixed}:${start}`;
    const toLocal = orientation === "horizontal" ? `${end}:${fixed}` : `${fixed}:${end}`;
    const from = byLocal.get(fromLocal);
    const to = byLocal.get(toLocal);
    if (!from || !to) return;
    const edgeConnection = from.kind === "sector-gate" || to.kind === "sector-gate";
    const roadClass = roadClassFor(fixed, catalog.pattern, boundaryOffsets.has(fixed) || edgeConnection);
    const metrics = classMetrics(roadClass);
    const name = lineName(citySeed, catalog, sector, orientation, fixed);
    segments.push({
      id: createStableEntityId("street-segment", `${catalog.seed}:${orientation}:${fixed}:${start}:${end}`),
      sectorId: sector.id,
      name,
      fromIntersectionId: from.id,
      toIntersectionId: to.id,
      class: roadClass,
      lengthM: end - start,
      lanes: metrics.lanes,
      widthM: metrics.widthM,
      speedLimitKph: metrics.speed,
      sidewalkLeftM: metrics.sidewalk,
      sidewalkRightM: metrics.sidewalk,
      oneWay: roadClass === "lane" && (Math.round((fixed + start) / 125) % 3 === 0),
      edgeConnection,
      trafficLoad: clamp(sector.trafficLoad - (roadClass === "arterial" ? 10 : roadClass === "collector" ? 4 : 0))
    });
  };
  for (const y of yLines) for (let index = 0; index < xLines.length - 1; index += 1) add("horizontal", y, xLines[index], xLines[index + 1]);
  for (const x of xLines) for (let index = 0; index < yLines.length - 1; index += 1) add("vertical", x, yLines[index], yLines[index + 1]);
  return segments;
}

function segmentEndpoints(segment: StreetSegmentState, byId: Map<string, StreetIntersectionState>): [StreetIntersectionState, StreetIntersectionState] | null {
  const from = byId.get(segment.fromIntersectionId);
  const to = byId.get(segment.toIntersectionId);
  return from && to ? [from, to] : null;
}

function nearestPointOnSegment(point: MetricPoint, from: MetricPoint, to: MetricPoint): MetricPoint {
  const dx = to.xM - from.xM;
  const dy = to.yM - from.yM;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return { ...from };
  const t = clamp(((point.xM - from.xM) * dx + (point.yM - from.yM) * dy) / lengthSquared, 0, 1);
  return { xM: from.xM + dx * t, yM: from.yM + dy * t };
}

function distanceSquared(left: MetricPoint, right: MetricPoint): number {
  return (left.xM - right.xM) ** 2 + (left.yM - right.yM) ** 2;
}

function nearestSegment(
  point: MetricPoint,
  segments: StreetSegmentState[],
  intersectionById: Map<string, StreetIntersectionState>
): { segment: StreetSegmentState; point: MetricPoint; distanceSquared: number } | null {
  let best: { segment: StreetSegmentState; point: MetricPoint; distanceSquared: number } | null = null;
  for (const segment of segments) {
    const endpoints = segmentEndpoints(segment, intersectionById);
    if (!endpoints) continue;
    const snapped = nearestPointOnSegment(point, endpoints[0], endpoints[1]);
    const candidateDistance = distanceSquared(point, snapped);
    if (!best || candidateDistance < best.distanceSquared) best = { segment, point: snapped, distanceSquared: candidateDistance };
  }
  return best;
}


function segmentOverlapsBuilding(
  segment: StreetSegmentState,
  intersections: Map<string, StreetIntersectionState>,
  building: BuildingState
): boolean {
  const endpoints = segmentEndpoints(segment, intersections);
  if (!endpoints) return false;
  const [from, to] = endpoints;
  const half = segment.widthM / 2;
  const left = building.bounds.xM;
  const right = building.bounds.xM + building.bounds.widthM;
  const top = building.bounds.yM;
  const bottom = building.bounds.yM + building.bounds.heightM;
  if (Math.abs(from.yM - to.yM) < .01) {
    const y = from.yM;
    const x1 = Math.min(from.xM, to.xM);
    const x2 = Math.max(from.xM, to.xM);
    return y + half > top && y - half < bottom && x2 > left && x1 < right;
  }
  if (Math.abs(from.xM - to.xM) < .01) {
    const x = from.xM;
    const y1 = Math.min(from.yM, to.yM);
    const y2 = Math.max(from.yM, to.yM);
    return x + half > left && x - half < right && y2 > top && y1 < bottom;
  }
  return false;
}

function removeBuildingConflicts(
  segments: StreetSegmentState[],
  intersections: StreetIntersectionState[],
  buildings: BuildingState[]
): StreetSegmentState[] {
  if (!buildings.length) return segments;
  const byId = new Map(intersections.map((node) => [node.id, node]));
  return segments.filter((segment) => !buildings.some((building) => segmentOverlapsBuilding(segment, byId, building)));
}

function blockBounds(
  sector: MetropolitanSectorState,
  xStart: number,
  xEnd: number,
  yStart: number,
  yEnd: number,
  segments: StreetSegmentState[]
): MetricBounds | null {
  const widest = segments.reduce((max, segment) => Math.max(max, segment.widthM / 2 + Math.max(segment.sidewalkLeftM, segment.sidewalkRightM)), 5);
  const inset = Math.min(9, Math.max(5, widest));
  const widthM = xEnd - xStart - inset * 2;
  const heightM = yEnd - yStart - inset * 2;
  if (widthM < 20 || heightM < 20) return null;
  return { xM: sector.bounds.xM + xStart + inset, yM: sector.bounds.yM + yStart + inset, widthM, heightM };
}

function containsPoint(bounds: MetricBounds, point: MetricPoint): boolean {
  return point.xM >= bounds.xM && point.xM <= bounds.xM + bounds.widthM && point.yM >= bounds.yM && point.yM <= bounds.yM + bounds.heightM;
}

function paddedBuildingParcel(building: BuildingState, sector: MetropolitanSectorState): MetricBounds {
  const padding = 4;
  const xM = Math.max(sector.bounds.xM, building.bounds.xM - padding);
  const yM = Math.max(sector.bounds.yM, building.bounds.yM - padding);
  const right = Math.min(sector.bounds.xM + sector.bounds.widthM, building.bounds.xM + building.bounds.widthM + padding);
  const bottom = Math.min(sector.bounds.yM + sector.bounds.heightM, building.bounds.yM + building.bounds.heightM + padding);
  return { xM, yM, widthM: Math.max(8, right - xM), heightM: Math.max(8, bottom - yM) };
}

function boundsOverlap(left: MetricBounds, right: MetricBounds): boolean {
  return left.xM < right.xM + right.widthM
    && left.xM + left.widthM > right.xM
    && left.yM < right.yM + right.heightM
    && left.yM + left.heightM > right.yM;
}

function entrancePoint(building: BuildingState, roadPoint: MetricPoint): MetricPoint {
  const center = { xM: building.bounds.xM + building.bounds.widthM / 2, yM: building.bounds.yM + building.bounds.heightM / 2 };
  const dx = roadPoint.xM - center.xM;
  const dy = roadPoint.yM - center.yM;
  if (Math.abs(dx / Math.max(1, building.bounds.widthM)) > Math.abs(dy / Math.max(1, building.bounds.heightM))) {
    return { xM: dx < 0 ? building.bounds.xM : building.bounds.xM + building.bounds.widthM, yM: clamp(roadPoint.yM, building.bounds.yM + 2, building.bounds.yM + building.bounds.heightM - 2) };
  }
  return { xM: clamp(roadPoint.xM, building.bounds.xM + 2, building.bounds.xM + building.bounds.widthM - 2), yM: dy < 0 ? building.bounds.yM : building.bounds.yM + building.bounds.heightM };
}

function materializeBlocksAndParcels(
  sector: MetropolitanSectorState,
  catalog: SectorStreetCatalogState,
  segments: StreetSegmentState[],
  intersections: StreetIntersectionState[],
  xLines: number[],
  yLines: number[],
  buildings: BuildingState[]
): { blocks: StreetBlockState[]; parcels: StreetParcelState[]; entrances: BuildingEntranceAnchorState[] } {
  const blocks: StreetBlockState[] = [];
  const parcels: StreetParcelState[] = [];
  const entrances: BuildingEntranceAnchorState[] = [];
  const intersectionById = new Map(intersections.map((node) => [node.id, node]));
  const usedAddressCodes = new Set<string>();
  const reserveAddress = (streetName: string, baseNumber: number) => {
    let number = Math.max(1, baseNumber % 400);
    let code = `${streetName}, ${number} · ${sector.code}`;
    while (usedAddressCodes.has(code)) {
      number = number >= 398 ? 1 : number + 2;
      code = `${streetName}, ${number} · ${sector.code}`;
    }
    usedAddressCodes.add(code);
    return { number: `${number}`, code };
  };

  for (let yIndex = 0; yIndex < yLines.length - 1; yIndex += 1) {
    for (let xIndex = 0; xIndex < xLines.length - 1; xIndex += 1) {
      const bounds = blockBounds(sector, xLines[xIndex], xLines[xIndex + 1], yLines[yIndex], yLines[yIndex + 1], segments);
      if (!bounds) continue;
      const id = createStableEntityId("street-block", `${catalog.seed}:${xIndex}:${yIndex}`);
      blocks.push({ id, sectorId: sector.id, code: `Q-${(yIndex * (xLines.length - 1) + xIndex + 1).toString().padStart(2, "0")}`, bounds, landUse: sector.landUse, parcelIds: [] });
    }
  }

  for (const building of buildings) {
    const center = { xM: building.bounds.xM + building.bounds.widthM / 2, yM: building.bounds.yM + building.bounds.heightM / 2 };
    const block = blocks.find((candidate) => containsPoint(candidate.bounds, center)) ?? blocks.slice().sort((left, right) => distanceSquared(center, { xM: left.bounds.xM + left.bounds.widthM / 2, yM: left.bounds.yM + left.bounds.heightM / 2 }) - distanceSquared(center, { xM: right.bounds.xM + right.bounds.widthM / 2, yM: right.bounds.yM + right.bounds.heightM / 2 }))[0];
    if (!block) continue;
    const nearest = nearestSegment(center, segments, intersectionById);
    if (!nearest) continue;
    const reservedAddress = reserveAddress(nearest.segment.name, Math.round((nearest.point.xM + nearest.point.yM) / 20));
    const parcel: StreetParcelState = {
      id: createStableEntityId("street-parcel", `${catalog.seed}:building:${building.id}`),
      sectorId: sector.id,
      blockId: block.id,
      bounds: paddedBuildingParcel(building, sector),
      kind: "building",
      streetSegmentId: nearest.segment.id,
      streetName: nearest.segment.name,
      streetNumber: reservedAddress.number,
      addressCode: reservedAddress.code,
      buildingId: building.id
    };
    parcels.push(parcel);
    for (const overlappingBlock of blocks.filter((candidate) => boundsOverlap(candidate.bounds, parcel.bounds))) {
      if (!overlappingBlock.parcelIds.includes(parcel.id)) overlappingBlock.parcelIds.push(parcel.id);
    }
    if (!block.parcelIds.includes(parcel.id)) block.parcelIds.push(parcel.id);
    const publicPoint = entrancePoint(building, nearest.point);
    entrances.push({
      id: createStableEntityId("building-entrance-anchor", `${building.id}:public`),
      sectorId: sector.id,
      buildingId: building.id,
      parcelId: parcel.id,
      streetSegmentId: nearest.segment.id,
      kind: "public",
      xM: publicPoint.xM,
      yM: publicPoint.yM,
      walkwayTo: nearest.point
    });
    if (building.serviceEntrances > 0) {
      const mirroredRoad = { xM: center.xM - (nearest.point.xM - center.xM), yM: center.yM - (nearest.point.yM - center.yM) };
      const serviceNearest = nearestSegment(mirroredRoad, segments, intersectionById) ?? nearest;
      const servicePoint = entrancePoint(building, serviceNearest.point);
      entrances.push({
        id: createStableEntityId("building-entrance-anchor", `${building.id}:service`),
        sectorId: sector.id,
        buildingId: building.id,
        parcelId: parcel.id,
        streetSegmentId: serviceNearest.segment.id,
        kind: "service",
        xM: servicePoint.xM,
        yM: servicePoint.yM,
        walkwayTo: serviceNearest.point
      });
    }
  }

  for (const block of blocks) {
    if (block.parcelIds.length) continue;
    const center = { xM: block.bounds.xM + block.bounds.widthM / 2, yM: block.bounds.yM + block.bounds.heightM / 2 };
    const nearest = nearestSegment(center, segments, intersectionById);
    if (!nearest) continue;
    const reservedAddress = reserveAddress(nearest.segment.name, Math.round((center.xM + center.yM) / 25));
    const parcel: StreetParcelState = {
      id: createStableEntityId("street-parcel", `${catalog.seed}:development:${block.id}`),
      sectorId: sector.id,
      blockId: block.id,
      bounds: { ...block.bounds },
      kind: sector.landUse === "civic" ? "civic" : "development",
      streetSegmentId: nearest.segment.id,
      streetName: nearest.segment.name,
      streetNumber: reservedAddress.number,
      addressCode: reservedAddress.code
    };
    parcels.push(parcel);
    block.parcelIds.push(parcel.id);
  }
  return { blocks, parcels, entrances };
}

function materializeParking(
  sector: MetropolitanSectorState,
  catalog: SectorStreetCatalogState,
  segments: StreetSegmentState[],
  intersections: StreetIntersectionState[],
  buildings: BuildingState[]
): ParkingZoneState[] {
  const byId = new Map(intersections.map((node) => [node.id, node]));
  const zones: ParkingZoneState[] = [];
  for (const segment of segments) {
    if (segment.class === "arterial" || segment.lengthM < 80 || catalog.pattern === "sparse-service" && zones.length > 2) continue;
    const endpoints = segmentEndpoints(segment, byId);
    if (!endpoints) continue;
    const [from, to] = endpoints;
    const horizontal = Math.abs(to.xM - from.xM) >= Math.abs(to.yM - from.yM);
    const capacity = Math.max(2, Math.floor(segment.lengthM / (catalog.landUse === "industrial" ? 14 : 7)));
    const offset = segment.widthM / 2 + Math.max(segment.sidewalkLeftM, segment.sidewalkRightM) + 2;
    const rawBounds: MetricBounds = horizontal
      ? { xM: Math.min(from.xM, to.xM) + 8, yM: from.yM + offset, widthM: Math.max(6, segment.lengthM - 16), heightM: 3 }
      : { xM: from.xM + offset, yM: Math.min(from.yM, to.yM) + 8, widthM: 3, heightM: Math.max(6, segment.lengthM - 16) };
    const bounds: MetricBounds = {
      xM: clamp(rawBounds.xM, sector.bounds.xM, sector.bounds.xM + sector.bounds.widthM - rawBounds.widthM),
      yM: clamp(rawBounds.yM, sector.bounds.yM, sector.bounds.yM + sector.bounds.heightM - rawBounds.heightM),
      widthM: rawBounds.widthM,
      heightM: rawBounds.heightM
    };
    if (buildings.some((building) => boundsOverlap(bounds, building.bounds))) continue;
    zones.push({
      id: createStableEntityId("parking-zone", `${catalog.seed}:${segment.id}`),
      sectorId: sector.id,
      streetSegmentId: segment.id,
      bounds,
      capacity,
      public: catalog.landUse !== "corporate",
      occupiedEstimate: Math.round(capacity * clamp(sector.trafficLoad / 100, 0.18, 0.94))
    });
  }
  return zones;
}

function applyDeltas(topology: MaterializedSectorStreetTopologyState, state: StreetTopologyState): MaterializedSectorStreetTopologyState {
  const deltas = state.deltas.filter((delta) => delta.sectorId === topology.sectorId);
  if (!deltas.length) return topology;
  const closed = new Set(deltas.filter((delta) => delta.kind === "closed-segment" || delta.kind === "removed-segment").map((delta) => delta.targetId));
  const renamed = new Map(deltas.filter((delta) => delta.kind === "renamed-street" && delta.textValue).map((delta) => [delta.targetId, delta.textValue!]));
  const segments = topology.segments
    .filter((segment) => !closed.has(segment.id))
    .map((segment) => renamed.has(segment.id) ? { ...segment, name: renamed.get(segment.id)! } : segment);
  const availableSegmentIds = new Set(segments.map((segment) => segment.id));
  const parcels = topology.parcels
    .filter((parcel) => availableSegmentIds.has(parcel.streetSegmentId))
    .map((parcel) => {
      const nextName = renamed.get(parcel.streetSegmentId);
      if (!nextName) return parcel;
      const comma = parcel.addressCode.indexOf(",");
      return {
        ...parcel,
        streetName: nextName,
        addressCode: `${nextName}${comma >= 0 ? parcel.addressCode.slice(comma) : `, ${parcel.streetNumber}`}`
      };
    });
  const parcelIds = new Set(parcels.map((parcel) => parcel.id));
  const buildingEntrances = topology.buildingEntrances.filter((entrance) => availableSegmentIds.has(entrance.streetSegmentId) && parcelIds.has(entrance.parcelId));
  const parkingZones = topology.parkingZones.filter((zone) => availableSegmentIds.has(zone.streetSegmentId));
  const blocks = topology.blocks.map((block) => ({ ...block, parcelIds: block.parcelIds.filter((id) => parcelIds.has(id)) }));
  const checksum = hashText([
    topology.catalogSeed,
    segments.map((segment) => `${segment.id}:${segment.name}`).join("|"),
    parcels.map((parcel) => `${parcel.id}:${parcel.addressCode}`).join("|"),
    buildingEntrances.map((entrance) => entrance.id).join("|"),
    parkingZones.map((zone) => zone.id).join("|")
  ].join("::"));
  return { ...topology, segments, parcels, buildingEntrances, parkingZones, blocks, checksum };
}

function buildingLayoutHash(buildings: BuildingState[]): string {
  return hashText(buildings
    .map((building) => `${building.id}:${building.bounds.xM}:${building.bounds.yM}:${building.bounds.widthM}:${building.bounds.heightM}`)
    .sort()
    .join("|"));
}

function materializeTopology(state: StreetTopologyState, input: StreetTopologyInput, sectorId: string): MaterializedSectorStreetTopologyState {
  const sector = input.metropolitan.sectors.find((item) => item.id === sectorId);
  if (!sector) throw new Error(`Unknown sector ${sectorId}`);
  const catalog = state.catalogs.find((item) => item.sectorId === sectorId) ?? catalogFor(input, sector);
  const baseOffsets = internalOffsets(catalog.pattern);
  const xLines = [...new Set([0, sector.bounds.widthM, ...baseOffsets, ...catalog.edgePorts.filter((port) => port.edge === "north" || port.edge === "south").map((port) => port.offsetM)])].sort((left, right) => left - right);
  const yLines = [...new Set([0, sector.bounds.heightM, ...baseOffsets, ...catalog.edgePorts.filter((port) => port.edge === "east" || port.edge === "west").map((port) => port.offsetM)])].sort((left, right) => left - right);
  const intersections = materializeIntersections(sector, catalog, xLines, yLines);
  const buildings = input.urban.buildings.filter((building) => building.sectorId === sectorId);
  const segments = removeBuildingConflicts(materializeSegments(input.seed, sector, catalog, intersections, xLines, yLines), intersections, buildings);
  const blockData = materializeBlocksAndParcels(sector, catalog, segments, intersections, xLines, yLines, buildings);
  const parkingZones = materializeParking(sector, catalog, segments, intersections, buildings);
  const checksumSource = [catalog.seed, intersections.length, segments.map((segment) => `${segment.id}:${segment.name}`).join("|"), blockData.parcels.map((parcel) => `${parcel.id}:${parcel.addressCode}`).join("|")].join("::");
  return applyDeltas({
    sectorId,
    catalogSeed: catalog.seed,
    topologyVersion: TOPOLOGY_VERSION,
    generatedAt: input.timestamp,
    buildingLayoutHash: buildingLayoutHash(buildings),
    intersections,
    segments,
    blocks: blockData.blocks,
    parcels: blockData.parcels,
    buildingEntrances: blockData.entrances,
    parkingZones,
    checksum: hashText(checksumSource)
  }, state);
}

function totals(state: Pick<StreetTopologyState, "catalogs" | "materializedSectors" | "deltas">): StreetTopologyTotalsState {
  return {
    catalogs: state.catalogs.length,
    materializedSectors: state.materializedSectors.length,
    intersections: state.materializedSectors.reduce((sum, item) => sum + item.intersections.length, 0),
    segments: state.materializedSectors.reduce((sum, item) => sum + item.segments.length, 0),
    blocks: state.materializedSectors.reduce((sum, item) => sum + item.blocks.length, 0),
    parcels: state.materializedSectors.reduce((sum, item) => sum + item.parcels.length, 0),
    entrances: state.materializedSectors.reduce((sum, item) => sum + item.buildingEntrances.length, 0),
    parkingCapacity: state.materializedSectors.reduce((sum, item) => sum + item.parkingZones.reduce((local, zone) => local + zone.capacity, 0), 0),
    deltas: state.deltas.length
  };
}

function targetSectorIds(input: StreetTopologyInput): string[] {
  const ids = new Set([...input.metropolitan.streaming.activeSectorIds, ...input.metropolitan.streaming.warmSectorIds]);
  if (input.preferredSectorId) ids.add(input.preferredSectorId);
  return [...ids];
}

export function createStreetTopologyState(input: StreetTopologyInput): StreetTopologyState {
  const catalogs = input.metropolitan.sectors.map((sector) => catalogFor(input, sector));
  let state: StreetTopologyState = { version: 1, topologyVersion: TOPOLOGY_VERSION, catalogs, materializedSectors: [], deltas: [], totals: { catalogs: catalogs.length, materializedSectors: 0, intersections: 0, segments: 0, blocks: 0, parcels: 0, entrances: 0, parkingCapacity: 0, deltas: 0 }, lastUpdatedAt: input.timestamp };
  state = advanceStreetTopologyState(state, input);
  return state;
}

export function advanceStreetTopologyState(state: StreetTopologyState, input: StreetTopologyInput): StreetTopologyState {
  const catalogs = state.topologyVersion === TOPOLOGY_VERSION && state.catalogs.length === input.metropolitan.sectors.length
    ? state.catalogs.map((catalog) => ({ ...catalog, lastMaterializedAt: targetSectorIds(input).includes(catalog.sectorId) ? input.timestamp : catalog.lastMaterializedAt }))
    : input.metropolitan.sectors.map((sector) => catalogFor(input, sector));
  const base: StreetTopologyState = { ...state, version: 1, topologyVersion: TOPOLOGY_VERSION, catalogs, lastUpdatedAt: input.timestamp };
  const targets = targetSectorIds(input);
  const previous = new Map(state.materializedSectors.map((topology) => [topology.sectorId, topology]));
  const materialized = targets.map((sectorId) => {
    const currentBuildings = input.urban.buildings.filter((building) => building.sectorId === sectorId);
    const old = previous.get(sectorId);
    return old && old.topologyVersion === TOPOLOGY_VERSION && old.buildingLayoutHash === buildingLayoutHash(currentBuildings)
      ? { ...old, generatedAt: input.timestamp }
      : materializeTopology(base, input, sectorId);
  });
  const retained = state.materializedSectors
    .filter((topology) => !targets.includes(topology.sectorId))
    .sort((left, right) => right.generatedAt - left.generatedAt)
    .slice(0, Math.max(0, CACHE_LIMIT - materialized.length));
  const next: StreetTopologyState = { ...base, materializedSectors: [...materialized, ...retained].slice(0, CACHE_LIMIT) };
  return { ...next, totals: totals(next) };
}

export function normalizeStreetTopologyState(value: unknown, input: StreetTopologyInput): StreetTopologyState {
  if (!value || typeof value !== "object") return createStreetTopologyState(input);
  const raw = value as Partial<StreetTopologyState>;
  if (raw.version !== 1 || raw.topologyVersion !== TOPOLOGY_VERSION || !Array.isArray(raw.catalogs)) return createStreetTopologyState(input);
  const fresh = createStreetTopologyState(input);
  const normalized: StreetTopologyState = {
    ...fresh,
    ...raw,
    version: 1,
    topologyVersion: TOPOLOGY_VERSION,
    catalogs: raw.catalogs.length === input.metropolitan.sectors.length ? raw.catalogs : fresh.catalogs,
    materializedSectors: Array.isArray(raw.materializedSectors) ? raw.materializedSectors.slice(0, CACHE_LIMIT) : [],
    deltas: Array.isArray(raw.deltas) ? raw.deltas : [],
    lastUpdatedAt: typeof raw.lastUpdatedAt === "number" ? raw.lastUpdatedAt : input.timestamp
  };
  return advanceStreetTopologyState(normalized, input);
}

export function getSectorStreetTopology(state: StreetTopologyState, input: StreetTopologyInput, sectorId: string): MaterializedSectorStreetTopologyState {
  return state.materializedSectors.find((topology) => topology.sectorId === sectorId) ?? materializeTopology(state, { ...input, preferredSectorId: sectorId }, sectorId);
}

export function alignUrbanFabricToStreetTopology(urban: UrbanFabricState, streets: StreetTopologyState, input: StreetTopologyInput): UrbanFabricState {
  const topologyBySector = new Map<string, MaterializedSectorStreetTopologyState>();
  const topology = (sectorId: string) => {
    const existing = topologyBySector.get(sectorId);
    if (existing) return existing;
    const resolved = getSectorStreetTopology(streets, input, sectorId);
    topologyBySector.set(sectorId, resolved);
    return resolved;
  };
  const buildings = urban.buildings.map((building) => {
    const local = topology(building.sectorId);
    const parcel = local.parcels.find((item) => item.buildingId === building.id);
    const entrance = local.buildingEntrances.find((item) => item.buildingId === building.id && item.kind === "public");
    if (!parcel) return building;
    return {
      ...building,
      parcelCode: parcel.id,
      addressCode: parcel.addressCode,
      blockId: parcel.blockId,
      parcelId: parcel.id,
      primaryEntranceId: entrance?.id,
      streetName: parcel.streetName,
      streetNumber: parcel.streetNumber
    };
  });
  const addressByBuilding = new Map(buildings.map((building) => [building.id, building.addressCode]));
  return {
    ...urban,
    buildings,
    householdAddresses: urban.householdAddresses.map((address) => ({ ...address, addressCode: addressByBuilding.get(address.buildingId) ?? address.addressCode }))
  };
}

export function snapTransitStopsToStreetTopology(transit: TransitOperationsState, streets: StreetTopologyState, input: StreetTopologyInput): TransitOperationsState {
  const cache = new Map<string, MaterializedSectorStreetTopologyState>();
  const stops = transit.stops.map((stop) => {
    let topology = cache.get(stop.sectorId);
    if (!topology) {
      topology = getSectorStreetTopology(streets, input, stop.sectorId);
      cache.set(stop.sectorId, topology);
    }
    const intersections = new Map(topology.intersections.map((node) => [node.id, node]));
    const nearest = nearestSegment({ xM: stop.xM, yM: stop.yM }, topology.segments, intersections);
    if (!nearest) return stop;
    return { ...stop, xM: round(nearest.point.xM), yM: round(nearest.point.yM) };
  });
  return { ...transit, stops };
}

export function snapPhysicalVehicleParkingToStreetTopology(
  vehicles: PhysicalVehiclesState,
  streets: StreetTopologyState,
  input: StreetTopologyInput
): PhysicalVehiclesState {
  const topologyCache = new Map<string, MaterializedSectorStreetTopologyState>();
  const resolve = (sectorId: string) => {
    const cached = topologyCache.get(sectorId);
    if (cached) return cached;
    const topology = getSectorStreetTopology(streets, { ...input, preferredSectorId: sectorId }, sectorId);
    topologyCache.set(sectorId, topology);
    return topology;
  };
  const parkingNodes = vehicles.parkingNodes.map((node) => {
    const topology = resolve(node.sectorId);
    const point = { xM: node.xM, yM: node.yM };
    const zones = topology.parkingZones
      .map((zone) => ({ zone, distance: distanceSquared(point, { xM: zone.bounds.xM + zone.bounds.widthM / 2, yM: zone.bounds.yM + zone.bounds.heightM / 2 }) }))
      .sort((left, right) => left.distance - right.distance);
    const selected = zones[0]?.zone;
    if (selected) {
      const parcel = topology.parcels.find((candidate) => candidate.streetSegmentId === selected.streetSegmentId);
      return {
        ...node,
        xM: round(selected.bounds.xM + selected.bounds.widthM / 2),
        yM: round(selected.bounds.yM + selected.bounds.heightM / 2),
        spaces: Math.max(1, Math.min(node.spaces, selected.capacity)),
        addressCode: parcel?.addressCode ?? node.addressCode
      };
    }
    const intersections = new Map(topology.intersections.map((intersection) => [intersection.id, intersection]));
    const nearest = nearestSegment(point, topology.segments, intersections);
    return nearest ? { ...node, xM: round(nearest.point.xM), yM: round(nearest.point.yM) } : node;
  });
  const nodeById = new Map(parkingNodes.map((node) => [node.id, node]));
  const nextVehicles = vehicles.vehicles.map((vehicle) => {
    if (!vehicle.position.parkingNodeId || vehicle.state === "moving") return vehicle;
    const node = nodeById.get(vehicle.position.parkingNodeId);
    if (!node) return vehicle;
    return { ...vehicle, position: { ...vehicle.position, xM: node.xM, yM: node.yM } };
  });
  return { ...vehicles, parkingNodes, vehicles: nextVehicles };
}

export function streetTopologyHealthy(state: StreetTopologyState, input: StreetTopologyInput): boolean {
  if (state.catalogs.length !== input.metropolitan.sectors.length) return false;
  const catalogBySector = new Map(state.catalogs.map((catalog) => [catalog.sectorId, catalog]));
  for (const sector of input.metropolitan.sectors) {
    const catalog = catalogBySector.get(sector.id);
    if (!catalog) return false;
    for (const port of catalog.edgePorts) {
      const neighbor = input.metropolitan.sectors.find((candidate) => {
        if (port.edge === "north") return candidate.xIndex === sector.xIndex && candidate.yIndex === sector.yIndex - 1;
        if (port.edge === "south") return candidate.xIndex === sector.xIndex && candidate.yIndex === sector.yIndex + 1;
        if (port.edge === "west") return candidate.xIndex === sector.xIndex - 1 && candidate.yIndex === sector.yIndex;
        return candidate.xIndex === sector.xIndex + 1 && candidate.yIndex === sector.yIndex;
      });
      if (!neighbor) return false;
      const opposite: StreetEdge = port.edge === "north" ? "south" : port.edge === "south" ? "north" : port.edge === "west" ? "east" : "west";
      const neighborCatalog = catalogBySector.get(neighbor.id);
      if (!neighborCatalog?.edgePorts.some((candidate) => candidate.edge === opposite && candidate.offsetM === port.offsetM && candidate.boundaryKey === port.boundaryKey)) return false;
    }
  }
  return true;
}
