import type { EntityId } from "../../core/ids/entityId";
import type { LocalEconomyState } from "../../gameplay/economy/types";
import type { PopulationState, ShiftType } from "../population/types";
import type { ProductionState, ShipmentLegality, ShipmentStatus } from "../production/types";
import type { MetropolitanState } from "../spatial/types";
import type { UrbanFabricState } from "../urban/types";
import type { DistrictState, LocationState, OrganizationState } from "../../world/state/types";

export type MobilityMode = "walk" | "bus" | "metro" | "private-car" | "taxi" | "service" | "freight";
export type MobilityRouteKind = "mass-transit" | "commuter" | "service" | "freight";
export type MobilityRouteStatus = "clear" | "busy" | "congested" | "blocked";
export type ParkingStatus = "available" | "strained" | "full";

export interface MobilityRouteState {
  id: EntityId;
  code: string;
  name: string;
  kind: MobilityRouteKind;
  primaryMode: MobilityMode;
  originSectorId: EntityId;
  destinationSectorId: EntityId;
  districtIds: EntityId[];
  pathSectorIds: EntityId[];
  distanceM: number;
  baseDurationMinutes: number;
  currentDurationMinutes: number;
  capacityPerHour: number;
  demandPerHour: number;
  loadPercent: number;
  congestionPercent: number;
  serviceReliability: number;
  status: MobilityRouteStatus;
  lastUpdatedAt: number;
}

export interface MobilitySectorFlowState {
  sectorId: EntityId;
  districtId: EntityId;
  hourIndex: number;
  residentTripsPerHour: number;
  workerTripsPerHour: number;
  serviceTripsPerHour: number;
  freightTripsPerHour: number;
  throughTripsPerHour: number;
  roadDemandPerHour: number;
  transitDemandPerHour: number;
  walkingDemandPerHour: number;
  congestionPercent: number;
  transitCrowdingPercent: number;
  averageSpeedKph: number;
  parkingOccupancyPercent: number;
  illegalParkingVehicles: number;
}

export interface MobilityParkingState {
  id: EntityId;
  sectorId: EntityId;
  districtId: EntityId;
  spaces: number;
  occupiedSpaces: number;
  commercialSpaces: number;
  serviceSpaces: number;
  freightBays: number;
  pricePerHour: number;
  turnoverPerDay: number;
  illegalParkingVehicles: number;
  pressurePercent: number;
  status: ParkingStatus;
  lastUpdatedAt: number;
}

export interface MobilityFleetState {
  id: EntityId;
  districtId: EntityId;
  ownerEntityId?: EntityId;
  mode: Exclude<MobilityMode, "walk">;
  vehicles: number;
  activeVehicles: number;
  capacityPerVehicle: number;
  availabilityPercent: number;
  averageCondition: number;
  serviceReliability: number;
  lastUpdatedAt: number;
}

export interface CommuterPlanState {
  residentId: EntityId;
  householdId: EntityId;
  originLocationId: EntityId;
  destinationLocationId: EntityId;
  originSectorId: EntityId;
  destinationSectorId: EntityId;
  mode: "walk" | "bus" | "metro" | "private-car";
  shift: ShiftType;
  departureHour: number;
  returnHour: number;
  distanceM: number;
  expectedDurationMinutes: number;
  lastTripAt?: number;
  tripsCompleted: number;
}

export interface FreightMovementState {
  id: EntityId;
  shipmentId: EntityId;
  sourceLocationId: EntityId;
  destinationLocationId: EntityId;
  originSectorId: EntityId;
  destinationSectorId: EntityId;
  routeId: EntityId;
  pathSectorIds: EntityId[];
  status: ShipmentStatus;
  legality: ShipmentLegality;
  departedAt?: number;
  estimatedArrivalAt: number;
  units: number;
  vehicleCount: number;
  delayHours: number;
  lastUpdatedAt: number;
}

export interface MobilitySnapshotState {
  id: EntityId;
  hourIndex: number;
  totalTripsPerHour: number;
  roadTripsPerHour: number;
  transitTripsPerHour: number;
  walkingTripsPerHour: number;
  serviceTripsPerHour: number;
  freightTripsPerHour: number;
  averageCongestionPercent: number;
  peakCongestionPercent: number;
  averageTransitCrowdingPercent: number;
  averageSpeedKph: number;
  parkingOccupancyPercent: number;
  delayedRoutes: number;
}

export interface MobilityTotalsState {
  passengerTrips: number;
  transitBoardings: number;
  serviceTrips: number;
  freightTrips: number;
  delayedTrips: number;
  vehicleKm: number;
  parkingViolations: number;
  gridlockHours: number;
}

export interface MetropolitanMobilityState {
  version: 1;
  routes: MobilityRouteState[];
  sectorFlows: MobilitySectorFlowState[];
  parking: MobilityParkingState[];
  fleets: MobilityFleetState[];
  commuterPlans: CommuterPlanState[];
  freightMovements: FreightMovementState[];
  history: MobilitySnapshotState[];
  totals: MobilityTotalsState;
  lastProcessedHour: number;
  lastUpdatedAt: number;
}

export interface MetropolitanMobilityInput {
  timestamp: number;
  seed: string;
  metropolitan: MetropolitanState;
  urban: UrbanFabricState;
  districts: DistrictState[];
  locations: LocationState[];
  organizations: OrganizationState[];
  population: PopulationState;
  economy: LocalEconomyState;
  production: ProductionState;
  transportServiceLevel: number;
  dataServiceLevel: number;
  activeLocationId?: EntityId;
  targetLocationId?: EntityId;
}

export interface MobilityTravelEstimate {
  originLocationId: EntityId;
  destinationLocationId: EntityId;
  mode: "walk" | "bus" | "metro" | "taxi";
  routeCode: string;
  distanceM: number;
  durationMinutes: number;
  cost: number;
  congestionPercent: number;
  transitCrowdingPercent: number;
}
