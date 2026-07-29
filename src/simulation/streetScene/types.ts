import type { EntityId } from "../../core/ids/entityId";
import type { LocalSceneState } from "../localScene/types";
import type { MetropolitanState } from "../spatial/types";
import type { StreetTopologyState } from "../streets/types";
import type { UrbanFabricState } from "../urban/types";
import type { PhysicalVehiclesState } from "../vehicles/types";

export type StreetPedestrianMotion = "walking" | "waiting" | "crossing" | "entering";
export type StreetTrafficMotion = "moving" | "stopped" | "parked" | "responding" | "disabled";
export type StreetIncidentType = "fight" | "robbery" | "overdose" | "arrest" | "crash" | "checkpoint" | "vendor" | "breakdown";
export type StreetIncidentStatus = "active" | "reported" | "responding" | "resolved";
export type StreetIncidentAction = "observe" | "call-help" | "intervene" | "move-on";

export interface StreetPedestrianState {
  id: EntityId;
  actorId: EntityId;
  segmentId: EntityId;
  xM: number;
  yM: number;
  headingDeg: number;
  speedMPerMinute: number;
  motion: StreetPedestrianMotion;
  sidewalkSide: "left" | "right";
  destinationBuildingId?: EntityId;
  updatedAt: number;
}

export interface StreetTrafficState {
  id: EntityId;
  vehicleId: EntityId;
  segmentId?: EntityId;
  xM: number;
  yM: number;
  headingDeg: number;
  speedKph: number;
  laneIndex: number;
  motion: StreetTrafficMotion;
  brakeLights: boolean;
  updatedAt: number;
}

export interface StreetCrossingState {
  id: EntityId;
  intersectionId: EntityId;
  xM: number;
  yM: number;
  signal: "walk" | "wait" | "uncontrolled";
  secondsRemaining: number;
}

export interface StreetIncidentState {
  id: EntityId;
  type: StreetIncidentType;
  status: StreetIncidentStatus;
  sectorId: EntityId;
  segmentId: EntityId;
  xM: number;
  yM: number;
  title: string;
  detail: string;
  severity: 1 | 2 | 3;
  participantActorIds: EntityId[];
  involvedVehicleIds: EntityId[];
  responder: "police" | "medical" | "fire" | "service" | null;
  startedAt: number;
  reportedAt?: number;
  respondingAt?: number;
  resolvedAt?: number;
  expiresAt: number;
  playerObserved: boolean;
  playerIntervened: boolean;
  outcome?: string;
}

export interface StreetSceneTotalsState {
  pedestrians: number;
  movingPedestrians: number;
  traffic: number;
  movingTraffic: number;
  activeIncidents: number;
  reportedIncidents: number;
  crossings: number;
}

export interface StreetSceneState {
  version: 1;
  focusSectorId: EntityId;
  pedestrians: StreetPedestrianState[];
  traffic: StreetTrafficState[];
  crossings: StreetCrossingState[];
  incidents: StreetIncidentState[];
  lastIncidentBucket: number;
  totals: StreetSceneTotalsState;
  lastUpdatedAt: number;
}

export interface StreetSceneInput {
  timestamp: number;
  seed: string;
  playerId: EntityId;
  metropolitan: MetropolitanState;
  urban: UrbanFabricState;
  streets: StreetTopologyState;
  localScene: LocalSceneState;
  vehicles: PhysicalVehiclesState;
}

export interface StreetSceneNotice {
  title: string;
  detail: string;
  importance: 1 | 2 | 3;
}

export interface StreetSceneAdvanceResult {
  state: StreetSceneState;
  notices: StreetSceneNotice[];
  spawnedIncidentIds: EntityId[];
  resolvedIncidentIds: EntityId[];
}
