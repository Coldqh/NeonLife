import type { EntityId } from "../../core/ids/entityId";
import type { DataSurveillanceState } from "../data/types";
import type { GovernmentCrimeState } from "../government/types";
import type { LocalSceneState, SpatialPositionState } from "../localScene/types";
import type { StreetSceneState } from "../streetScene/types";
import type { UrbanFabricState } from "../urban/types";
import type { DistrictState, OrganizationState } from "../../world/state/types";

export type PlayerCrimeKind = "shoplifting" | "register-robbery" | "vehicle-theft" | "assault";
export type PlayerCrimeIncidentStatus = "unreported" | "reported" | "responding" | "investigating" | "resolved";
export type CrimeEvidenceKind = "camera" | "witness" | "stolen-property" | "vehicle-plate" | "blood" | "transaction";
export type CrimeReportSource = "alarm" | "witness" | "camera" | "victim" | "none";
export type PlayerWarrantStatus = "unknown-suspect" | "identified" | "arrested" | "closed";
export type PoliceResponseStatus = "dispatched" | "en-route" | "on-scene" | "searching" | "resolved";
export type PlayerCustodyPhase = "stopped" | "searched" | "hearing" | "released";
export type PlayerCustodyAction = "submit-search" | "resist-search" | "attempt-escape" | "proceed-hearing" | "pay" | "serve";

export interface PlayerCrimeEvidenceState {
  id: EntityId;
  incidentId: EntityId;
  kind: CrimeEvidenceKind;
  strength: number;
  ownerEntityId: EntityId;
  subjectIdentified: boolean;
  description: string;
  createdAt: number;
  expiresAt: number;
}

export interface PlayerCrimeIncidentState {
  id: EntityId;
  kind: PlayerCrimeKind;
  status: PlayerCrimeIncidentStatus;
  districtId: EntityId;
  sectorId: EntityId;
  xM: number;
  yM: number;
  venueId?: EntityId;
  vehicleId?: EntityId;
  victimActorId?: EntityId;
  victimResidentId?: EntityId;
  occurredAt: number;
  reportDueAt: number;
  reportedAt?: number;
  resolvedAt?: number;
  reportSource: CrimeReportSource;
  alarmTriggered: boolean;
  success: boolean;
  violence: number;
  stolenValue: number;
  evidenceIds: EntityId[];
  playerAwareEvidenceKinds: CrimeEvidenceKind[];
  witnessActorIds: EntityId[];
  recognizedPlayer: boolean;
  identityConfidence: number;
  heat: number;
  outcome?: string;
}

export interface PlayerWarrantState {
  id: EntityId;
  incidentIds: EntityId[];
  status: PlayerWarrantStatus;
  scope: "district" | "city";
  districtId: EntityId;
  charges: PlayerCrimeKind[];
  identityConfidence: number;
  heat: number;
  issuedAt: number;
  lastSeenSectorId?: EntityId;
  lastSeenAt?: number;
  closedAt?: number;
}

export interface StolenPropertyState {
  id: EntityId;
  incidentId: EntityId;
  sourceVenueId?: EntityId;
  sourceVehicleId?: EntityId;
  offerId?: EntityId;
  name: string;
  value: number;
  quantity: number;
  evidenceStrength: number;
  acquiredAt: number;
  confiscatedAt?: number;
  disposedAt?: number;
}

export interface PoliceResponseState {
  id: EntityId;
  incidentId: EntityId;
  unitCode: string;
  status: PoliceResponseStatus;
  sectorId: EntityId;
  fromX: number;
  fromY: number;
  targetX: number;
  targetY: number;
  currentX: number;
  currentY: number;
  dispatchedAt: number;
  arrivesAt: number;
  resolvedAt?: number;
}

export interface PlayerCustodyState {
  incidentId: EntityId;
  warrantId?: EntityId;
  status: "detained" | "released";
  phase: PlayerCustodyPhase;
  startedAt: number;
  searchCompletedAt?: number;
  hearingAt: number;
  releaseAt: number;
  sentenceHours: number;
  fine: number;
  confiscatedPropertyIds: EntityId[];
  reason: string;
  searchOutcome?: string;
  escapeAttempted: boolean;
  resistedSearch: boolean;
  releasedAt?: number;
}

export interface GangFactionState {
  id: EntityId;
  sourceNetworkId?: EntityId;
  organizationId?: EntityId;
  name: string;
  code: string;
  homeDistrictId: EntityId;
  influence: number;
  influenceByDistrict: Record<EntityId, number>;
  cash: number;
  hostilityToPlayer: number;
  controlledVenueIds: EntityId[];
  rivalIds: EntityId[];
  activeMembers: number;
  activeOperations: number;
  disruptedOperations: number;
  knownIntel: number;
  conflictIntensity: number;
  conflictLosses: number;
  conflictCreditsLost: number;
  warWithGangId?: EntityId;
  lastKnownAt?: number;
  lastUpdatedAt: number;
}

export interface PlayerCrimeTotalsState {
  crimesCommitted: number;
  shoplifting: number;
  registerRobberies: number;
  vehicleThefts: number;
  assaults: number;
  evidenceCreated: number;
  reportsFiled: number;
  policeResponses: number;
  arrests: number;
  escapes: number;
  failedEscapes: number;
  finesPaid: number;
  stolenCredits: number;
}

export interface PlayerCrimeState {
  version: 2;
  incidents: PlayerCrimeIncidentState[];
  evidence: PlayerCrimeEvidenceState[];
  warrants: PlayerWarrantState[];
  stolenProperty: StolenPropertyState[];
  policeResponses: PoliceResponseState[];
  gangs: GangFactionState[];
  custody: PlayerCustodyState | null;
  heat: number;
  totals: PlayerCrimeTotalsState;
  lastUpdatedAt: number;
}

export interface PlayerCrimeInput {
  seed: string;
  timestamp: number;
  playerId: EntityId;
  playerPosition: SpatialPositionState;
  localScene: LocalSceneState;
  streetScene: StreetSceneState;
  data: DataSurveillanceState;
  urban: UrbanFabricState;
  government?: GovernmentCrimeState;
  districts: DistrictState[];
  organizations: OrganizationState[];
}

export interface PlayerCrimeActionInput extends PlayerCrimeInput {
  kind: PlayerCrimeKind;
  sectorId: EntityId;
  districtId: EntityId;
  xM: number;
  yM: number;
  venueId?: EntityId;
  vehicleId?: EntityId;
  victimActorId?: EntityId;
  victimResidentId?: EntityId;
  success: boolean;
  violence: number;
  stolenValue: number;
  alarmTriggered?: boolean;
  stolenProperty?: Omit<StolenPropertyState, "id" | "incidentId" | "acquiredAt">;
}

export interface PlayerCustodyActionInput {
  seed: string;
  timestamp: number;
  action: Exclude<PlayerCustodyAction, "pay" | "serve">;
  health: number;
  fatigue: number;
}

export interface PlayerCustodyActionResult {
  state: PlayerCrimeState;
  success: boolean;
  message: string;
}

export interface PlayerCrimeAdvanceNotice {
  title: string;
  detail: string;
  importance: 1 | 2 | 3;
}

export interface PlayerCrimeAdvanceResult {
  state: PlayerCrimeState;
  notices: PlayerCrimeAdvanceNotice[];
  newlyDetained: boolean;
}
