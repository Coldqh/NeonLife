import type { EntityId } from "../../core/ids/entityId";
import type { MetricBounds, SectorLandUse, SpatialDetailLevel } from "../spatial/types";

export type BuildingUse = "residential" | "mixed" | "retail" | "office" | "industrial" | "warehouse" | "medical" | "education" | "civic" | "transport" | "utility" | "hotel" | "entertainment" | "vacant";
export type BuildingScale = "house" | "lowrise" | "midrise" | "highrise" | "megablock" | "megastructure" | "warehouse" | "campus" | "infrastructure";
export type UnitUse = "apartment" | "dorm-room" | "shop" | "office" | "clinic" | "workshop" | "warehouse" | "hotel-room" | "service" | "utility";
export type InteriorRoomKind = "entry" | "living" | "kitchen" | "bedroom" | "bathroom" | "storage" | "workroom" | "office" | "retail-floor" | "clinic-room" | "corridor" | "service-room";
export type InteriorDeltaKind = "door" | "damage" | "inventory" | "occupancy" | "evidence" | "ownership" | "access";

export interface SectorBuildingCatalogState {
  sectorId: EntityId;
  districtId: EntityId;
  seed: string;
  landUse: SectorLandUse;
  buildingCount: number;
  residentialBuildings: number;
  commercialBuildings: number;
  industrialBuildings: number;
  civicBuildings: number;
  residentialUnits: number;
  occupiedResidentialUnits: number;
  residentCapacity: number;
  floorAreaM2: number;
  vacancyRate: number;
  averageFloors: number;
  averageCondition: number;
  materializedBuildingCount: number;
  lastIndexedAt: number;
}

export interface BuildingState {
  id: EntityId;
  sectorId: EntityId;
  districtId: EntityId;
  parcelCode: string;
  addressCode: string;
  seed: string;
  bounds: MetricBounds;
  use: BuildingUse;
  scale: BuildingScale;
  floors: number;
  basementLevels: number;
  floorAreaM2: number;
  residentialUnits: number;
  commercialUnits: number;
  residentCapacity: number;
  representedResidents: number;
  ownerEntityId: EntityId;
  controllerEntityId: EntityId;
  anchorLocationId?: EntityId;
  condition: number;
  security: number;
  publicEntrances: number;
  serviceEntrances: number;
  elevatorCount: number;
  stairwellCount: number;
  utilityService: number;
  detailLevel: SpatialDetailLevel;
  lastMaterializedAt: number;
  permanent: boolean;
}

export interface BuildingUnitState {
  id: EntityId;
  buildingId: EntityId;
  sectorId: EntityId;
  floor: number;
  unitNumber: string;
  use: UnitUse;
  areaM2: number;
  roomCount: number;
  capacity: number;
  occupied: boolean;
  householdId?: EntityId;
  residentIds: EntityId[];
  tenantEntityId?: EntityId;
  ownerEntityId: EntityId;
  monthlyRent: number;
  condition: number;
  security: number;
  interiorSeed: string;
  lastMaterializedAt: number;
  permanent: boolean;
}

export interface HouseholdAddressState {
  householdId: EntityId;
  buildingId: EntityId;
  unitId: EntityId;
  sectorId: EntityId;
  addressCode: string;
  residentIds: EntityId[];
  assignedAt: number;
}

export interface InteriorRoomState {
  id: EntityId;
  kind: InteriorRoomKind;
  bounds: MetricBounds;
  doorIds: EntityId[];
  furnishingProfile: string;
  itemEstimate: number;
}

export interface InteriorState {
  id: EntityId;
  buildingId: EntityId;
  unitId?: EntityId;
  sectorId: EntityId;
  seed: string;
  rooms: InteriorRoomState[];
  entranceDoorIds: EntityId[];
  floor: number;
  estimatedMemoryKb: number;
  lastTouchedAt: number;
  materializedAt: number;
}

export interface InteriorPersistentDeltaState {
  id: EntityId;
  interiorId: EntityId;
  buildingId: EntityId;
  unitId?: EntityId;
  kind: InteriorDeltaKind;
  key: string;
  numericValue?: number;
  textValue?: string;
  createdAt: number;
  updatedAt: number;
  permanent: boolean;
}

export interface MassDemographyCohortState {
  sectorId: EntityId;
  districtId: EntityId;
  population: number;
  households: number;
  children: number;
  youngAdults: number;
  adults: number;
  elderly: number;
  students: number;
  employed: number;
  unemployed: number;
  births: number;
  deaths: number;
  immigrants: number;
  emigrants: number;
  internalArrivals: number;
  internalDepartures: number;
  graduates: number;
  householdFormations: number;
  lastProcessedMonth: number;
}

export interface MassDemographyTotalsState {
  population: number;
  households: number;
  births: number;
  deaths: number;
  immigrants: number;
  emigrants: number;
  internalMoves: number;
  graduates: number;
  householdFormations: number;
}

export interface MassDemographySnapshotState {
  id: EntityId;
  monthIndex: number;
  population: number;
  births: number;
  deaths: number;
  immigrants: number;
  emigrants: number;
  internalMoves: number;
  students: number;
  employed: number;
  unemployed: number;
}

export interface DetailedResidentSampleLinkState {
  residentId: EntityId;
  sectorId: EntityId;
  districtId: EntityId;
  representedWeight: number;
  materialized: boolean;
  updatedAt: number;
}

export interface UrbanMemoryState {
  buildingCacheLimit: number;
  unitCacheLimit: number;
  interiorCacheLimit: number;
  cachedBuildings: number;
  cachedUnits: number;
  cachedInteriors: number;
  buildingsEvicted: number;
  unitsEvicted: number;
  interiorsEvicted: number;
  estimatedMemoryMb: number;
  peakEstimatedMemoryMb: number;
  lastCompactedAt: number;
}

export interface UrbanFabricTotalsState {
  indexedBuildings: number;
  indexedResidentialUnits: number;
  indexedResidentCapacity: number;
  materializedBuildings: number;
  materializedUnits: number;
  detailedHouseholdAddresses: number;
  materializedInteriors: number;
}

export interface UrbanFabricState {
  version: 1;
  catalogs: SectorBuildingCatalogState[];
  buildings: BuildingState[];
  units: BuildingUnitState[];
  householdAddresses: HouseholdAddressState[];
  interiors: InteriorState[];
  interiorDeltas: InteriorPersistentDeltaState[];
  demography: {
    version: 1;
    cohorts: MassDemographyCohortState[];
    history: MassDemographySnapshotState[];
    totals: MassDemographyTotalsState;
    lastProcessedMonth: number;
  };
  sampleLinks: DetailedResidentSampleLinkState[];
  memory: UrbanMemoryState;
  totals: UrbanFabricTotalsState;
  lastUpdatedAt: number;
}

export interface UrbanFabricInput {
  timestamp: number;
  seed: string;
  activeLocationId: EntityId;
  targetLocationId?: EntityId;
  metropolitan: import("../spatial/types").MetropolitanState;
  districts: import("../../world/state/types").DistrictState[];
  locations: import("../../world/state/types").LocationState[];
  organizations: import("../../world/state/types").OrganizationState[];
  population: import("../population/types").PopulationState;
  transportServiceLevel: number;
  dataServiceLevel: number;
}

export interface UrbanFabricAdvanceResult {
  state: UrbanFabricState;
  representedPopulationByDistrict: Record<EntityId, number>;
  representedPopulationBySector: Record<EntityId, number>;
}
