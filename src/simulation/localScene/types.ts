import type { EntityId } from "../../core/ids/entityId";
import type { HumanNetworkState } from "../../people/network/types";
import type { MetropolitanMobilityState } from "../mobility/types";
import type { PopulationState } from "../population/types";
import type { MetropolitanState } from "../spatial/types";
import type { UrbanFabricState } from "../urban/types";
import type { LocationState } from "../../world/state/types";

export type SpatialPresenceState = "outside" | "inside" | "in-transit" | "vehicle";
export type LocalActorActivity = "home" | "work" | "commute" | "errand" | "rest" | "idle" | "school" | "medical";

export interface SpatialPositionState {
  sectorId: EntityId;
  xM: number;
  yM: number;
  locationId?: EntityId;
  buildingId?: EntityId;
  unitId?: EntityId;
  roomId?: EntityId;
  floor?: number;
  transitRouteId?: EntityId;
  vehicleId?: EntityId;
  state: SpatialPresenceState;
  updatedAt: number;
}

export interface LocalActorState {
  id: EntityId;
  residentId: EntityId;
  source: "detailed" | "sector-sample";
  activePersonId?: EntityId;
  name: string;
  age: number;
  roleLabel: string;
  health: PopulationState["residents"][number]["health"];
  activity: LocalActorActivity;
  activityLabel: string;
  position: SpatialPositionState;
  homeLocationId: EntityId | null;
  destinationLocationId?: EntityId;
  knownToPlayer: boolean;
  distanceToPlayerM: number;
  visible: boolean;
  nearby: boolean;
  interactable: boolean;
  representedWeight: number;
  lastMaterializedAt: number;
}

export interface LocalBuildingPresenceState {
  buildingId: EntityId;
  addressCode: string;
  use: UrbanFabricState["buildings"][number]["use"];
  distanceToPlayerM: number;
  publicEntrances: number;
  serviceEntrances: number;
  security: number;
  occupiedActorCount: number;
  playerInside: boolean;
}

export interface LocalSceneTotalsState {
  materializedActors: number;
  focusSectorActors: number;
  visibleActors: number;
  nearbyActors: number;
  knownActors: number;
  interiorActors: number;
  commutingActors: number;
  materializedBuildings: number;
  ambientPopulationEstimate: number;
}

export interface LocalSceneState {
  version: 1;
  focusSectorId: EntityId;
  playerPosition: SpatialPositionState;
  actors: LocalActorState[];
  buildings: LocalBuildingPresenceState[];
  nearbyActorIds: EntityId[];
  visibleActorIds: EntityId[];
  totals: LocalSceneTotalsState;
  lastUpdatedAt: number;
}

export interface LocalSceneInput {
  timestamp: number;
  seed: string;
  activeLocationId: EntityId;
  targetLocationId?: EntityId;
  locations: LocationState[];
  people: HumanNetworkState;
  population: PopulationState;
  metropolitan: MetropolitanState;
  urban: UrbanFabricState;
  mobility: MetropolitanMobilityState;
  playerPosition?: SpatialPositionState;
}
