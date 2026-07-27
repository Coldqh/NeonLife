import { migrateEnvelope } from "../src/core/saves/migrations";
import { createWorldSession } from "../src/world/generation/createWorld";
import { getSectorStreetTopology, streetTopologyHealthy } from "../src/simulation/streets/streetTopologySystem";
import type { BuildingState } from "../src/simulation/urban/types";
import type { MaterializedSectorStreetTopologyState, StreetSegmentState } from "../src/simulation/streets/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function roadOverlapsBuilding(segment: StreetSegmentState, topology: MaterializedSectorStreetTopologyState, building: BuildingState): boolean {
  const nodes = new Map(topology.intersections.map((node) => [node.id, node]));
  const from = nodes.get(segment.fromIntersectionId);
  const to = nodes.get(segment.toIntersectionId);
  if (!from || !to) return false;
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

function pointDistanceToSegment(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length)) : 0;
  return Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t));
}


function boundsOverlap(left: { xM: number; yM: number; widthM: number; heightM: number }, right: { xM: number; yM: number; widthM: number; heightM: number }): boolean {
  return left.xM < right.xM + right.widthM
    && left.xM + left.widthM > right.xM
    && left.yM < right.yM + right.heightM
    && left.yM + left.heightM > right.yM;
}

const seed = "street-topology-regression";
const session = createWorldSession(seed);
assert(session.schemaVersion === 29, "new world schema is not 29");
assert(session.streets.version === 1, "street topology state is missing");
assert(session.streets.catalogs.length === session.metropolitan.sectors.length, "not every sector received a street catalog");
assert(session.streets.catalogs.length === 1512, "unexpected city sector count");
assert(streetTopologyHealthy(session.streets, {
  timestamp: session.timestamp,
  seed,
  metropolitan: session.metropolitan,
  urban: session.urban
}), "neighboring sector street ports do not match");
assert(session.streets.materializedSectors.length > 0 && session.streets.materializedSectors.length <= 64, "street cache limit is invalid");

for (const topology of session.streets.materializedSectors) {
  assert(topology.intersections.length > 0, `sector ${topology.sectorId} has no intersections`);
  assert(topology.segments.length > 0, `sector ${topology.sectorId} has no street segments`);
  assert(topology.blocks.length > 0, `sector ${topology.sectorId} has no blocks`);
  assert(topology.blocks.every((block) => block.parcelIds.length > 0), `sector ${topology.sectorId} has blocks without parcels`);
  const buildings = session.urban.buildings.filter((building) => building.sectorId === topology.sectorId);
  const addressCodes = new Set<string>();
  for (const gate of topology.intersections.filter((intersection) => intersection.kind === "sector-gate")) {
    assert(topology.segments.some((segment) => segment.fromIntersectionId === gate.id || segment.toIntersectionId === gate.id), `sector gate ${gate.id} is disconnected`);
  }
  for (let leftIndex = 0; leftIndex < buildings.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < buildings.length; rightIndex += 1) {
      assert(!boundsOverlap(buildings[leftIndex].bounds, buildings[rightIndex].bounds), `buildings ${buildings[leftIndex].id} and ${buildings[rightIndex].id} overlap`);
    }
  }
  for (const building of buildings) {
    assert(Boolean(building.streetName && building.streetNumber && building.parcelId), `building ${building.id} has no street address`);
    const parcel = topology.parcels.find((candidate) => candidate.buildingId === building.id);
    assert(parcel, `building ${building.id} has no parcel`);
    assert(!addressCodes.has(parcel.addressCode), `duplicate address ${parcel.addressCode}`);
    addressCodes.add(parcel.addressCode);
    assert(parcel.bounds.xM <= building.bounds.xM && parcel.bounds.yM <= building.bounds.yM
      && parcel.bounds.xM + parcel.bounds.widthM >= building.bounds.xM + building.bounds.widthM
      && parcel.bounds.yM + parcel.bounds.heightM >= building.bounds.yM + building.bounds.heightM, `parcel does not contain building ${building.id}`);
    assert(topology.buildingEntrances.some((entrance) => entrance.buildingId === building.id && entrance.kind === "public"), `building ${building.id} has no public entrance`);
    assert(!topology.segments.some((segment) => roadOverlapsBuilding(segment, topology, building)), `street crosses building ${building.id}`);
  }
}

for (const stop of session.transit.stops) {
  const topology = getSectorStreetTopology(session.streets, {
    timestamp: session.timestamp,
    seed,
    metropolitan: session.metropolitan,
    urban: session.urban,
    preferredSectorId: stop.sectorId
  }, stop.sectorId);
  const nodes = new Map(topology.intersections.map((node) => [node.id, node]));
  const distance = Math.min(...topology.segments.map((segment) => {
    const from = nodes.get(segment.fromIntersectionId)!;
    const to = nodes.get(segment.toIntersectionId)!;
    return pointDistanceToSegment(stop.xM, stop.yM, from.xM, from.yM, to.xM, to.yM);
  }));
  assert(distance < .02, `transit stop ${stop.id} is not snapped to a street`);
}

for (const node of session.vehicles.parkingNodes) {
  const topology = getSectorStreetTopology(session.streets, {
    timestamp: session.timestamp,
    seed,
    metropolitan: session.metropolitan,
    urban: session.urban,
    preferredSectorId: node.sectorId
  }, node.sectorId);
  const insideZone = topology.parkingZones.some((zone) => node.xM >= zone.bounds.xM
    && node.xM <= zone.bounds.xM + zone.bounds.widthM
    && node.yM >= zone.bounds.yM
    && node.yM <= zone.bounds.yM + zone.bounds.heightM);
  assert(insideZone || topology.parkingZones.length === 0, `parking node ${node.id} is not attached to street parking`);
}

let auditedSegments = 0;
let auditedBlocks = 0;
for (const sector of session.metropolitan.sectors) {
  const topology = getSectorStreetTopology(session.streets, {
    timestamp: session.timestamp,
    seed,
    metropolitan: session.metropolitan,
    urban: session.urban,
    preferredSectorId: sector.id
  }, sector.id);
  assert(topology.segments.length > 0, `sector ${sector.code} has no streets`);
  assert(topology.blocks.length > 0, `sector ${sector.code} has no blocks`);
  assert(topology.intersections.every((node) => node.xM >= sector.bounds.xM
    && node.xM <= sector.bounds.xM + sector.bounds.widthM
    && node.yM >= sector.bounds.yM
    && node.yM <= sector.bounds.yM + sector.bounds.heightM), `sector ${sector.code} has nodes outside its bounds`);
  const adjacency = new Map(topology.intersections.map((node) => [node.id, [] as string[]]));
  for (const segment of topology.segments) {
    adjacency.get(segment.fromIntersectionId)?.push(segment.toIntersectionId);
    adjacency.get(segment.toIntersectionId)?.push(segment.fromIntersectionId);
  }
  const gates = topology.intersections.filter((node) => node.kind === "sector-gate");
  if (gates.length) {
    const visited = new Set<string>([gates[0].id]);
    const queue = [gates[0].id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    assert(gates.every((gate) => visited.has(gate.id)), `sector ${sector.code} has disconnected boundary streets`);
  }
  auditedSegments += topology.segments.length;
  auditedBlocks += topology.blocks.length;
}

const second = createWorldSession(seed);
const firstFocus = session.streets.materializedSectors.find((topology) => topology.sectorId === session.metropolitan.streaming.focusSectorId);
const secondFocus = second.streets.materializedSectors.find((topology) => topology.sectorId === second.metropolitan.streaming.focusSectorId);
assert(firstFocus?.checksum === secondFocus?.checksum, "street topology is not deterministic");

const buildingIds = session.urban.buildings.map((building) => building.id).sort().join("|");
const { streets: _removedStreets, ...legacyPayload } = session;
const migrated = migrateEnvelope({
  slotId: "slot-1",
  schemaVersion: 28,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  checksum: "legacy",
  payload: { ...legacyPayload, schemaVersion: 28 }
}, "slot-1");
assert(migrated?.payload.schemaVersion === 29, "legacy save was not upgraded to schema 29");
assert(migrated.payload.streets.catalogs.length === 1512, "migration did not build street catalogs");
assert(migrated.payload.urban.buildings.map((building) => building.id).sort().join("|") === buildingIds, "migration changed building identities");
assert(migrated.payload.urban.buildings.every((building) => Boolean(building.addressCode)), "migration lost building addresses");

// Continuous street names must survive sector borders.
for (const sector of session.metropolitan.sectors.slice(0, 240)) {
  const east = session.metropolitan.sectors.find((candidate) => candidate.xIndex === sector.xIndex + 1 && candidate.yIndex === sector.yIndex);
  if (!east) continue;
  const leftTopology = getSectorStreetTopology(session.streets, { timestamp: session.timestamp, seed, metropolitan: session.metropolitan, urban: session.urban, preferredSectorId: sector.id }, sector.id);
  const rightTopology = getSectorStreetTopology(session.streets, { timestamp: session.timestamp, seed, metropolitan: session.metropolitan, urban: session.urban, preferredSectorId: east.id }, east.id);
  const leftNodes = new Map(leftTopology.intersections.map((node) => [node.id, node]));
  const rightNodes = new Map(rightTopology.intersections.map((node) => [node.id, node]));
  const leftBoundary = leftTopology.segments.filter((segment) => {
    const from = leftNodes.get(segment.fromIntersectionId);
    const to = leftNodes.get(segment.toIntersectionId);
    return Boolean(from && to && (Math.abs(from.xM - (sector.bounds.xM + sector.bounds.widthM)) < .01 || Math.abs(to.xM - (sector.bounds.xM + sector.bounds.widthM)) < .01));
  });
  for (const segment of leftBoundary) {
    const from = leftNodes.get(segment.fromIntersectionId)!;
    const to = leftNodes.get(segment.toIntersectionId)!;
    const yM = Math.abs(from.xM - (sector.bounds.xM + sector.bounds.widthM)) < .01 ? from.yM : to.yM;
    const match = rightTopology.segments.find((candidate) => {
      const rightFrom = rightNodes.get(candidate.fromIntersectionId);
      const rightTo = rightNodes.get(candidate.toIntersectionId);
      return Boolean(rightFrom && rightTo && (
        Math.abs(rightFrom.xM - east.bounds.xM) < .01 && Math.abs(rightFrom.yM - yM) < .01
        || Math.abs(rightTo.xM - east.bounds.xM) < .01 && Math.abs(rightTo.yM - yM) < .01
      ));
    });
    if (match) assert(match.name === segment.name, `street name changes at border ${sector.code}/${east.code}`);
  }
}

// Renaming or removing a street must update dependent topology, not only the visible segment.
const deltaSector = session.streets.materializedSectors.find((topology) => topology.parcels.some((parcel) => topology.segments.some((segment) => segment.id === parcel.streetSegmentId)));
assert(deltaSector, "no topology available for delta test");
const deltaParcel = deltaSector.parcels.find((parcel) => deltaSector.segments.some((segment) => segment.id === parcel.streetSegmentId))!;
const renamedTopology = getSectorStreetTopology({
  ...session.streets,
  deltas: [...session.streets.deltas, {
    id: "test-rename-delta",
    sectorId: deltaSector.sectorId,
    kind: "renamed-street",
    targetId: deltaParcel.streetSegmentId,
    textValue: "Проверочная улица",
    createdAt: session.timestamp,
    updatedAt: session.timestamp,
    permanent: true
  }]
}, { timestamp: session.timestamp, seed, metropolitan: session.metropolitan, urban: session.urban, preferredSectorId: deltaSector.sectorId }, deltaSector.sectorId);
const renamedParcel = renamedTopology.parcels.find((parcel) => parcel.id === deltaParcel.id);
assert(renamedParcel?.streetName === "Проверочная улица" && renamedParcel.addressCode.startsWith("Проверочная улица,"), "street rename did not propagate to address");
const removedTopology = getSectorStreetTopology({
  ...session.streets,
  deltas: [...session.streets.deltas, {
    id: "test-remove-delta",
    sectorId: deltaSector.sectorId,
    kind: "removed-segment",
    targetId: deltaParcel.streetSegmentId,
    createdAt: session.timestamp,
    updatedAt: session.timestamp,
    permanent: true
  }]
}, { timestamp: session.timestamp, seed, metropolitan: session.metropolitan, urban: session.urban, preferredSectorId: deltaSector.sectorId }, deltaSector.sectorId);
assert(!removedTopology.parcels.some((parcel) => parcel.streetSegmentId === deltaParcel.streetSegmentId), "removed street kept dependent parcels");
assert(!removedTopology.buildingEntrances.some((entrance) => entrance.streetSegmentId === deltaParcel.streetSegmentId), "removed street kept dependent entrances");
assert(!removedTopology.parkingZones.some((zone) => zone.streetSegmentId === deltaParcel.streetSegmentId), "removed street kept dependent parking");

console.log(JSON.stringify({
  catalogs: session.streets.catalogs.length,
  materialized: session.streets.materializedSectors.length,
  intersections: session.streets.totals.intersections,
  segments: session.streets.totals.segments,
  blocks: session.streets.totals.blocks,
  parcels: session.streets.totals.parcels,
  entrances: session.streets.totals.entrances,
  parkingCapacity: session.streets.totals.parkingCapacity,
  stops: session.transit.stops.length,
  auditedSectors: session.metropolitan.sectors.length,
  auditedSegments,
  auditedBlocks
}, null, 2));
