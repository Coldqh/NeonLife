import type { EntityId } from "../../core/ids/entityId";
import type { PlayerState } from "../../gameplay/player/demoPlayer";
import type { LocationState } from "../../world/state/types";
import type { LocalSceneState } from "../localScene/types";
import type { PopulationState } from "../population/types";
import type { BuildingUse, InteriorRoomKind, UnitUse, UrbanFabricState } from "../urban/types";

export type PlayerAccessLevel = "street" | "building" | "unit" | "room";
export type AccessDoorKind = "public-entrance" | "service-entrance" | "unit" | "room";
export type AccessLockType = "none" | "mechanical" | "electronic" | "corporate";
export type AccessDecision = "open" | "authorized" | "locked" | "closed" | "unavailable";

export interface BuildingEntryAccessState {
  buildingId: EntityId;
  addressCode: string;
  use: BuildingUse;
  distanceToPlayerM: number;
  publicDoorId?: EntityId;
  serviceDoorId?: EntityId;
  publicDecision: AccessDecision;
  serviceDecision: AccessDecision;
  publicReason: string;
  serviceReason: string;
  playerInside: boolean;
}

export interface AccessDoorState {
  id: EntityId;
  buildingId: EntityId;
  unitId?: EntityId;
  roomId?: EntityId;
  floor: number;
  kind: AccessDoorKind;
  label: string;
  lockType: AccessLockType;
  decision: AccessDecision;
  reason: string;
  locked: boolean;
  open: boolean;
  alarmed: boolean;
  security: number;
  playerAuthorized: boolean;
  lastChangedAt: number;
}

export interface BuildingFloorAccessState {
  floor: number;
  label: string;
  unitIds: EntityId[];
  roomIds: EntityId[];
  stairsAvailable: boolean;
  elevatorAvailable: boolean;
  accessible: boolean;
  occupiedActorCount: number;
}

export interface BuildingUnitAccessState {
  unitId: EntityId;
  floor: number;
  unitNumber: string;
  use: UnitUse;
  occupied: boolean;
  residentCount: number;
  security: number;
  doorId: EntityId;
  decision: AccessDecision;
  reason: string;
  playerAuthorized: boolean;
  interiorId?: EntityId;
}

export interface BuildingRoomAccessState {
  roomId: EntityId;
  interiorId: EntityId;
  unitId?: EntityId;
  floor: number;
  kind: InteriorRoomKind;
  doorId: EntityId;
  decision: AccessDecision;
  playerInside: boolean;
  occupiedActorCount: number;
}

export interface PlayerBuildingAccessState {
  level: PlayerAccessLevel;
  buildingId?: EntityId;
  unitId?: EntityId;
  interiorId?: EntityId;
  roomId?: EntityId;
  floor?: number;
  entranceDoorId?: EntityId;
  enteredAt?: number;
}

export interface BuildingAccessTotalsState {
  localBuildings: number;
  openEntrances: number;
  authorizedEntrances: number;
  lockedEntrances: number;
  activeFloors: number;
  activeUnits: number;
  activeRooms: number;
  doorsOpened: number;
  deniedAttempts: number;
}

export interface BuildingAccessState {
  version: 1;
  player: PlayerBuildingAccessState;
  buildingEntries: BuildingEntryAccessState[];
  doors: AccessDoorState[];
  floors: BuildingFloorAccessState[];
  units: BuildingUnitAccessState[];
  rooms: BuildingRoomAccessState[];
  visitedBuildingIds: EntityId[];
  visitedUnitIds: EntityId[];
  totals: BuildingAccessTotalsState;
  lastUpdatedAt: number;
}

export interface BuildingAccessInput {
  timestamp: number;
  seed: string;
  player: PlayerState;
  playerHomeLocationId: EntityId;
  locations: LocationState[];
  population: PopulationState;
  urban: UrbanFabricState;
  localScene: LocalSceneState;
}
