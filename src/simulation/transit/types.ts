import type { EntityId } from "../../core/ids/entityId";
import type { HumanNetworkState } from "../../people/network/types";
import type { LocationState, DistrictState } from "../../world/state/types";
import type { SpatialPositionState } from "../localScene/types";
import type { MetropolitanMobilityState } from "../mobility/types";
import type { PopulationState } from "../population/types";
import type { MetropolitanState } from "../spatial/types";
import type { PhysicalVehiclesState } from "../vehicles/types";

export type TransitMode = "bus" | "metro";
export type TransitServiceStatus = "operational" | "delayed" | "crowded" | "suspended";
export type TransitVehicleStatus = "in-service" | "boarding" | "delayed" | "out-of-service";
export type TransitJourneyPhase = "waiting" | "onboard" | "arrived";
export type TransitSeatKind = "standard" | "priority";
export type TransitPriorityNeed = "none" | "elderly" | "injured" | "disabled" | "carrying-child";
export type TransitPhoneActivity = "messages" | "job-board" | "study" | "city-feed";

export interface TransitStopState {
  id: EntityId;
  code: string;
  name: string;
  mode: TransitMode;
  sectorId: EntityId;
  districtId: EntityId;
  xM: number;
  yM: number;
  routeIds: EntityId[];
  shelter: boolean;
  accessible: boolean;
  dailyBoardings: number;
}

export interface TransitRouteOperationState {
  id: EntityId;
  sourceRouteId?: EntityId;
  code: string;
  name: string;
  mode: TransitMode;
  stopIds: EntityId[];
  headwayMinutes: number;
  serviceStartHour: number;
  serviceEndHour: number;
  fare: number;
  capacityPerVehicle: number;
  scheduledVehicles: number;
  activeVehicles: number;
  reliability: number;
  averageDelayMinutes: number;
  crowdingPercent: number;
  status: TransitServiceStatus;
}

export interface TransitCrewState {
  driverId: EntityId;
  residentId?: EntityId;
  name: string;
  roleLabel: string;
  shiftEndsAt: number;
}

export interface TransitVehicleOperationState {
  id: EntityId;
  physicalVehicleId?: EntityId;
  routeId: EntityId;
  mode: TransitMode;
  fleetNumber: string;
  capacity: number;
  seatCount: number;
  currentStopIndex: number;
  direction: 1 | -1;
  nextStopAt: number;
  occupancy: number;
  condition: number;
  delayMinutes: number;
  status: TransitVehicleStatus;
  crew: TransitCrewState;
}

export interface TransitJourneySegmentState {
  id: EntityId;
  routeId: EntityId;
  mode: TransitMode;
  originStopId: EntityId;
  destinationStopId: EntityId;
  stopIds: EntityId[];
  durationMinutes: number;
  fare: number;
  transferMinutesAfter: number;
}

export interface TransitPassengerState {
  id: EntityId;
  residentId?: EntityId;
  activePersonId?: EntityId;
  name: string;
  age: number;
  roleLabel: string;
  priorityNeed: TransitPriorityNeed;
  seatId?: EntityId;
  standing: boolean;
  mood: "calm" | "tired" | "irritated" | "nervous" | "friendly";
  attitudeToPlayer: number;
  interactionCount: number;
  knownFact: string;
}

export interface TransitSeatState {
  id: EntityId;
  index: number;
  kind: TransitSeatKind;
  occupiedBy: EntityId | "player" | null;
}

export interface TransitCabinState {
  vehicleId: EntityId;
  seats: TransitSeatState[];
  passengers: TransitPassengerState[];
  totalPassengerCount: number;
  crowdingPercent: number;
  playerStanding: boolean;
  lastInteraction?: string;
  lastPhoneActivity?: TransitPhoneActivity;
}

export interface PlayerTransitJourneyState {
  id: EntityId;
  phase: TransitJourneyPhase;
  destinationLocationId: EntityId;
  segments: TransitJourneySegmentState[];
  activeSegmentIndex: number;
  currentStopOffset: number;
  currentStopId: EntityId;
  nextStopId?: EntityId;
  vehicleId?: EntityId;
  seatId?: EntityId;
  startedAt: number;
  expectedArrivalAt: number;
  farePaid: number;
  interactions: number;
  yieldedSeats: number;
  phoneMinutes: number;
  skipped: boolean;
}

export interface TransitPlayerState {
  journey?: PlayerTransitJourneyState;
  position: SpatialPositionState;
  completedTrips: number;
  completedTransfers: number;
  faresPaid: number;
  seatsTaken: number;
  seatsYielded: number;
  passengerInteractions: number;
  productivePhoneMinutes: number;
  knowledgePoints: number;
}

export interface TransitTotalsState {
  stops: number;
  routes: number;
  activeVehicles: number;
  delayedRoutes: number;
  crowdedRoutes: number;
  passengerCapacity: number;
  representedPassengers: number;
}

export interface TransitOperationsState {
  version: 1;
  stops: TransitStopState[];
  routes: TransitRouteOperationState[];
  vehicles: TransitVehicleOperationState[];
  player: TransitPlayerState;
  cabin?: TransitCabinState;
  totals: TransitTotalsState;
  lastProcessedMinute: number;
  lastUpdatedAt: number;
}

export type TransitCommand =
  | { kind: "begin"; destinationLocationId: EntityId; segments: TransitJourneySegmentState[]; expectedArrivalAt: number }
  | { kind: "board"; vehicleId: EntityId }
  | { kind: "take-seat"; seatId: EntityId }
  | { kind: "stand" }
  | { kind: "yield-seat"; passengerId: EntityId }
  | { kind: "advance" }
  | { kind: "interact-advance"; passengerId: EntityId }
  | { kind: "phone-advance"; activity: TransitPhoneActivity; productiveMinutes: number }
  | { kind: "alight" }
  | { kind: "skip" };

export interface TransitOperationsInput {
  timestamp: number;
  seed: string;
  playerId: EntityId;
  activeLocationId: EntityId;
  playerPosition: SpatialPositionState;
  locations: LocationState[];
  districts: DistrictState[];
  people: HumanNetworkState;
  population: PopulationState;
  metropolitan: MetropolitanState;
  mobility: MetropolitanMobilityState;
  physicalVehicles: PhysicalVehiclesState;
  command?: TransitCommand;
}

export interface TransitJourneyEstimate {
  destinationLocationId: EntityId;
  segments: TransitJourneySegmentState[];
  originStopId: EntityId;
  destinationStopId: EntityId;
  walkingMinutes: number;
  waitingMinutes: number;
  rideMinutes: number;
  transferMinutes: number;
  totalMinutes: number;
  totalFare: number;
  expectedArrivalAt: number;
}
