import type { EntityId } from "../../core/ids/entityId";
import type { OrganizationState } from "../../world/state/types";
import type { SpatialPositionState } from "../localScene/types";
import type { MetropolitanMobilityState } from "../mobility/types";
import type { PopulationState } from "../population/types";
import type { MetropolitanState } from "../spatial/types";
import type { UrbanFabricState } from "../urban/types";

export type PhysicalVehicleClass = "compact" | "sedan" | "van" | "taxi" | "service" | "medical" | "police" | "truck" | "bus";
export type PhysicalVehicleStateKind = "parked" | "moving" | "occupied" | "service" | "disabled";
export type PhysicalVehicleAccess = "owned" | "authorized" | "public" | "locked";
export type VehicleParkingKind = "curb" | "residential" | "commercial" | "service" | "freight";

export interface PhysicalVehiclePositionState {
  sectorId: EntityId;
  xM: number;
  yM: number;
  locationId?: EntityId;
  buildingId?: EntityId;
  parkingNodeId?: EntityId;
  updatedAt: number;
}

export interface PhysicalVehicleEntityState {
  id: EntityId;
  modelCode: string;
  modelName: string;
  vehicleClass: PhysicalVehicleClass;
  plate: string;
  ownerEntityId?: EntityId;
  ownerResidentId?: EntityId;
  organizationId?: EntityId;
  fleetMode?: "private-car" | "taxi" | "service" | "freight" | "bus";
  access: PhysicalVehicleAccess;
  state: PhysicalVehicleStateKind;
  position: PhysicalVehiclePositionState;
  seats: number;
  cargoCapacityKg: number;
  condition: number;
  fuelCapacityL: number;
  fuelL: number;
  consumptionLPer100Km: number;
  odometerKm: number;
  driverEntityId?: EntityId;
  passengerEntityIds: EntityId[];
  locked: boolean;
  alarmed: boolean;
  persistent: boolean;
  distanceToPlayerM: number;
  visible: boolean;
  nearby: boolean;
  playerCanEnter: boolean;
  playerCanDrive: boolean;
  lastMovedAt: number;
  lastMaterializedAt: number;
}

export interface VehicleParkingNodeState {
  id: EntityId;
  sectorId: EntityId;
  buildingId?: EntityId;
  addressCode?: string;
  kind: VehicleParkingKind;
  xM: number;
  yM: number;
  spaces: number;
  occupiedVehicleIds: EntityId[];
  security: number;
  pricePerHour: number;
  lastUpdatedAt: number;
}

export interface PlayerVehicleControlState {
  currentVehicleId?: EntityId;
  seat: "driver" | "passenger" | null;
  keyVehicleIds: EntityId[];
  ownedVehicleIds: EntityId[];
  distanceDrivenKm: number;
  fuelConsumedL: number;
  tripsCompleted: number;
}

export interface PhysicalVehicleTotalsState {
  materializedVehicles: number;
  focusSectorVehicles: number;
  parkedVehicles: number;
  movingVehicles: number;
  serviceVehicles: number;
  disabledVehicles: number;
  visibleVehicles: number;
  nearbyVehicles: number;
  parkingNodes: number;
  occupiedParkingSpaces: number;
}

export interface PhysicalVehiclesState {
  version: 1;
  vehicles: PhysicalVehicleEntityState[];
  parkingNodes: VehicleParkingNodeState[];
  player: PlayerVehicleControlState;
  persistentVehicleIds: EntityId[];
  totals: PhysicalVehicleTotalsState;
  lastProcessedHour: number;
  lastUpdatedAt: number;
}

export type VehicleCommand =
  | { kind: "enter"; vehicleId: EntityId; seat: "driver" | "passenger" }
  | { kind: "exit"; vehicleId: EntityId }
  | {
      kind: "drive";
      vehicleId: EntityId;
      destinationLocationId: EntityId;
      distanceM: number;
      durationMinutes: number;
      fuelUsedL: number;
    }
  | { kind: "service"; vehicleId: EntityId; fuelAddedL: number; conditionRestored: number };

export interface PhysicalVehiclesInput {
  timestamp: number;
  seed: string;
  playerId: EntityId;
  activeLocationId: EntityId;
  targetLocationId?: EntityId;
  playerPosition: SpatialPositionState;
  metropolitan: MetropolitanState;
  urban: UrbanFabricState;
  mobility: MetropolitanMobilityState;
  population: PopulationState;
  organizations: OrganizationState[];
  command?: VehicleCommand;
}

export interface PhysicalVehicleTravelEstimate {
  vehicleId: EntityId;
  originLocationId: EntityId;
  destinationLocationId: EntityId;
  distanceM: number;
  durationMinutes: number;
  fuelUsedL: number;
  congestionPercent: number;
  averageSpeedKph: number;
}
