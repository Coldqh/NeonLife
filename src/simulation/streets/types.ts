import type { EntityId } from "../../core/ids/entityId";
import type { MetricBounds, MetricPoint, MetropolitanState, SectorLandUse } from "../spatial/types";
import type { UrbanFabricState } from "../urban/types";

export type StreetPattern = "fine-grid" | "residential-grid" | "industrial-spine" | "corporate-superblock" | "sparse-service";
export type StreetEdge = "north" | "east" | "south" | "west";
export type StreetClass = "lane" | "local" | "collector" | "arterial";
export type StreetDeltaKind = "closed-segment" | "renamed-street" | "added-segment" | "removed-segment" | "parcel-change" | "parking-change";

export interface StreetEdgePortState {
  edge: StreetEdge;
  offsetM: number;
  class: StreetClass;
  boundaryKey: string;
}

export interface SectorStreetCatalogState {
  sectorId: EntityId;
  districtId: EntityId;
  mapDistrictId: EntityId;
  seed: string;
  topologyVersion: number;
  pattern: StreetPattern;
  landUse: SectorLandUse;
  edgePorts: StreetEdgePortState[];
  streetNamePool: string[];
  estimatedBlocks: number;
  estimatedParcels: number;
  lastMaterializedAt: number;
}

export interface StreetIntersectionState extends MetricPoint {
  id: EntityId;
  sectorId: EntityId;
  kind: "junction" | "crossing" | "sector-gate";
}

export interface StreetSegmentState {
  id: EntityId;
  sectorId: EntityId;
  name: string;
  fromIntersectionId: EntityId;
  toIntersectionId: EntityId;
  class: StreetClass;
  lengthM: number;
  lanes: number;
  widthM: number;
  speedLimitKph: number;
  sidewalkLeftM: number;
  sidewalkRightM: number;
  oneWay: boolean;
  edgeConnection: boolean;
  trafficLoad: number;
}

export interface StreetBlockState {
  id: EntityId;
  sectorId: EntityId;
  code: string;
  bounds: MetricBounds;
  landUse: SectorLandUse;
  parcelIds: EntityId[];
}

export interface StreetParcelState {
  id: EntityId;
  sectorId: EntityId;
  blockId: EntityId;
  bounds: MetricBounds;
  kind: "building" | "development" | "civic" | "parking";
  streetSegmentId: EntityId;
  streetName: string;
  streetNumber: string;
  addressCode: string;
  buildingId?: EntityId;
}

export interface BuildingEntranceAnchorState extends MetricPoint {
  id: EntityId;
  sectorId: EntityId;
  buildingId: EntityId;
  parcelId: EntityId;
  streetSegmentId: EntityId;
  kind: "public" | "service";
  walkwayTo: MetricPoint;
}

export interface ParkingZoneState {
  id: EntityId;
  sectorId: EntityId;
  streetSegmentId: EntityId;
  bounds: MetricBounds;
  capacity: number;
  public: boolean;
  occupiedEstimate: number;
}

export interface MaterializedSectorStreetTopologyState {
  sectorId: EntityId;
  catalogSeed: string;
  topologyVersion: number;
  generatedAt: number;
  buildingLayoutHash: string;
  intersections: StreetIntersectionState[];
  segments: StreetSegmentState[];
  blocks: StreetBlockState[];
  parcels: StreetParcelState[];
  buildingEntrances: BuildingEntranceAnchorState[];
  parkingZones: ParkingZoneState[];
  checksum: string;
}

export interface StreetTopologyDeltaState {
  id: EntityId;
  sectorId: EntityId;
  kind: StreetDeltaKind;
  targetId: EntityId;
  textValue?: string;
  numericValue?: number;
  createdAt: number;
  updatedAt: number;
  permanent: boolean;
}

export interface StreetTopologyTotalsState {
  catalogs: number;
  materializedSectors: number;
  intersections: number;
  segments: number;
  blocks: number;
  parcels: number;
  entrances: number;
  parkingCapacity: number;
  deltas: number;
}

export interface StreetTopologyState {
  version: 1;
  topologyVersion: number;
  catalogs: SectorStreetCatalogState[];
  materializedSectors: MaterializedSectorStreetTopologyState[];
  deltas: StreetTopologyDeltaState[];
  totals: StreetTopologyTotalsState;
  lastUpdatedAt: number;
}

export interface StreetTopologyInput {
  timestamp: number;
  seed: string;
  metropolitan: MetropolitanState;
  urban: UrbanFabricState;
  preferredSectorId?: EntityId;
}
