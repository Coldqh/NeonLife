import type { EntityId } from "../../core/ids/entityId";
import type { DistrictState, LocationState } from "../../world/state/types";

export type SpatialDetailLevel = "active" | "warm" | "cold";
export type SectorLandUse = "residential" | "mixed" | "commercial" | "industrial" | "corporate" | "civic" | "transport" | "utility" | "vacant";
export type LocationFootprintKind = "tower" | "megablock" | "campus" | "warehouse" | "midrise" | "lowrise" | "infrastructure";
export type SpatialDeltaKind = "structure" | "access" | "ownership" | "occupancy" | "damage" | "inventory" | "evidence" | "history";

export interface MetricPoint {
  xM: number;
  yM: number;
}

export interface MetricBounds extends MetricPoint {
  widthM: number;
  heightM: number;
}

export interface MetropolitanConfig {
  widthM: number;
  heightM: number;
  sectorSizeM: number;
  blockSizeM: number;
  sectorsWide: number;
  sectorsHigh: number;
  activeRadius: number;
  warmRadius: number;
  maxActiveSectors: number;
  maxWarmSectors: number;
  maxMaterializedResidents: number;
  maxMaterializedInteriors: number;
  memoryBudgetMb: number;
  coldSectorFootprintKb: number;
  warmSectorFootprintKb: number;
  activeSectorFootprintKb: number;
  seedVersion: number;
}

export interface DistrictSpatialState {
  districtId: EntityId;
  bounds: MetricBounds;
  center: MetricPoint;
  representedPopulation: number;
  densityPerKm2: number;
  sectorIds: EntityId[];
  dominantLandUse: SectorLandUse;
  transitScore: number;
  verticality: number;
}

export interface MetropolitanSectorState {
  id: EntityId;
  code: string;
  xIndex: number;
  yIndex: number;
  bounds: MetricBounds;
  districtId: EntityId;
  seed: string;
  representedPopulation: number;
  representedHouseholds: number;
  buildingEstimate: number;
  floorAreaEstimateM2: number;
  roadLengthM: number;
  densityPerKm2: number;
  landUse: SectorLandUse;
  detailLevel: SpatialDetailLevel;
  lastTouchedAt: number;
  lastSimulatedAt: number;
  persistentDeltaCount: number;
  materializedResidentCount: number;
  materializedInteriorCount: number;
  crowdLoad: number;
  trafficLoad: number;
}

export interface LocationSpatialState {
  locationId: EntityId;
  sectorId: EntityId;
  districtId: EntityId;
  addressCode: string;
  bounds: MetricBounds;
  floors: number;
  basementLevels: number;
  footprintKind: LocationFootprintKind;
  entranceCount: number;
  serviceEntranceCount: number;
  verticalPopulationCapacity: number;
  persistentInteriorSeed: string;
}

export interface RoadNodeState extends MetricPoint {
  id: EntityId;
  sectorId: EntityId;
  kind: "intersection" | "interchange" | "bridge" | "tunnel" | "district-gate";
}

export interface RoadLinkState {
  id: EntityId;
  fromNodeId: EntityId;
  toNodeId: EntityId;
  class: "local" | "collector" | "arterial" | "expressway";
  lengthM: number;
  lanes: number;
  capacityPerHour: number;
  speedLimitKph: number;
  districtIds: EntityId[];
}

export interface TransitStationState extends MetricPoint {
  id: EntityId;
  name: string;
  sectorId: EntityId;
  districtId: EntityId;
  lineIds: EntityId[];
  dailyCapacity: number;
}

export interface TransitLineState {
  id: EntityId;
  name: string;
  mode: "metro" | "elevated" | "regional-rail" | "freight";
  stationIds: EntityId[];
  lengthM: number;
  dailyCapacity: number;
}

export interface SpatialPersistentDelta {
  id: EntityId;
  sectorId: EntityId;
  entityId?: EntityId;
  kind: SpatialDeltaKind;
  key: string;
  numericValue?: number;
  textValue?: string;
  createdAt: number;
  updatedAt: number;
  permanent: boolean;
}

export interface SpatialArchiveSummary {
  id: EntityId;
  sectorId: EntityId;
  dayIndex: number;
  eventsCompacted: number;
  observationsExpired: number;
  temporaryDeltasRemoved: number;
  residentsDematerialized: number;
  interiorsDematerialized: number;
}

export interface SpatialStreamingState {
  focusSectorId: EntityId;
  activeSectorIds: EntityId[];
  warmSectorIds: EntityId[];
  coldSectorCount: number;
  estimatedMemoryMb: number;
  peakEstimatedMemoryMb: number;
  materializedResidentCount: number;
  materializedInteriorCount: number;
  sectorsActivated: number;
  sectorsEvicted: number;
  residentsDematerialized: number;
  interiorsDematerialized: number;
  compactions: number;
  lastCompactedAt: number;
}

export interface MetropolitanTotals {
  sectors: number;
  representedPopulation: number;
  estimatedBuildings: number;
  estimatedFloorAreaM2: number;
  roadLengthM: number;
  transitLengthM: number;
  persistentDeltas: number;
  archiveSummaries: number;
}

export interface MetropolitanState {
  version: 1;
  config: MetropolitanConfig;
  districts: DistrictSpatialState[];
  sectors: MetropolitanSectorState[];
  locations: LocationSpatialState[];
  roadNodes: RoadNodeState[];
  roadLinks: RoadLinkState[];
  transitStations: TransitStationState[];
  transitLines: TransitLineState[];
  deltas: SpatialPersistentDelta[];
  archive: SpatialArchiveSummary[];
  streaming: SpatialStreamingState;
  totals: MetropolitanTotals;
  lastUpdatedAt: number;
}

export interface MetropolitanAdvanceInput {
  timestamp: number;
  seed: string;
  activeLocationId: EntityId;
  targetLocationId?: EntityId;
  districts: DistrictState[];
  locations: LocationState[];
  representedPopulationByDistrict: Record<string, number>;
  transportServiceLevel: number;
  dataServiceLevel: number;
  recentEventCount: number;
  recentObservationCount: number;
}

export interface MetropolitanAdvanceResult {
  state: MetropolitanState;
  compactedEventBudget: number;
  compactedObservationBudget: number;
}
