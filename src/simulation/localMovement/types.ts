import type { EntityId } from "../../core/ids/entityId";

export type LocalMovementTargetKind = "point" | "location" | "building" | "stop" | "street" | "vehicle" | "person";
export type LocalMovementStatus = "walking" | "arrived";

export interface LocalMovementTargetState {
  kind: LocalMovementTargetKind;
  id: EntityId;
  label: string;
  sectorId: EntityId;
  xM: number;
  yM: number;
  approachXM?: number;
  approachYM?: number;
  locationId?: EntityId;
  buildingId?: EntityId;
  stopId?: EntityId;
  streetSegmentId?: EntityId;
  vehicleId?: EntityId;
  actorId?: EntityId;
}

export interface LocalMovementRoutePointState {
  sectorId: EntityId;
  xM: number;
  yM: number;
  streetName?: string;
  streetSegmentId?: EntityId;
}

export interface LocalMovementState {
  version: 1;
  id: EntityId;
  status: LocalMovementStatus;
  target: LocalMovementTargetState;
  points: LocalMovementRoutePointState[];
  streetNames: string[];
  totalDistanceM: number;
  travelledM: number;
  remainingDistanceM: number;
  estimatedMinutes: number;
  currentLegIndex: number;
  currentLegProgressM: number;
  topologyVersion: number;
  streetDeltaCount: number;
  streetRevision: string;
  startedAt: number;
  updatedAt: number;
  arrivedAt?: number;
  replannedAt?: number;
}

export interface LocalMovementAdvanceResult {
  route: LocalMovementState;
  position: {
    sectorId: EntityId;
    xM: number;
    yM: number;
  };
}
