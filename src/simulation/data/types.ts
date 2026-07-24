import type { EntityId } from "../../core/ids/entityId";
import type { LocalEconomyState } from "../../gameplay/economy/types";
import type { GovernmentCrimeState } from "../government/types";
import type { HealthCyberwareState } from "../health/types";
import type { InfrastructureState } from "../infrastructure/types";
import type { KernelTransactionDraft } from "../kernel/types";
import type { OrganizationEcosystemState } from "../organizations/types";
import type { PopulationState } from "../population/types";
import type { DistrictState, LocationState, OrganizationState } from "../../world/state/types";

export type DigitalIdentityStatus = "verified" | "limited" | "compromised" | "forged" | "suspended";
export type DataSensitivity = "public" | "restricted" | "confidential" | "sealed";
export type DataRecordKind =
  | "civil-identity"
  | "address"
  | "employment"
  | "education"
  | "medical"
  | "insurance"
  | "tax"
  | "credit"
  | "criminal"
  | "license"
  | "cyberware"
  | "access-log"
  | "vehicle-registration";
export type DataPurpose = "service" | "employment-screening" | "care" | "insurance" | "tax" | "investigation" | "security" | "commercial-analysis" | "illegal-sale" | "identity-forgery";
export type AccessOutcome = "allowed" | "denied" | "overridden" | "forged";
export type SurveillanceNodeKind = "camera" | "identity-gate" | "transit-scanner" | "medical-terminal" | "work-terminal" | "implant-reader" | "network-sensor";
export type SurveillanceNodeStatus = "online" | "degraded" | "offline" | "compromised";
export type BreachStatus = "active" | "contained" | "sold" | "closed";
export type ForgeryStatus = "active" | "detected" | "retired";

export interface DigitalIdentityState {
  id: EntityId;
  residentId: EntityId;
  civicIdentifier: string;
  aliases: string[];
  status: DigitalIdentityStatus;
  creditScore: number;
  digitalAccess: number;
  fraudRisk: number;
  profileCompleteness: number;
  registeredAddressId: EntityId | null;
  lastVerifiedDay: number;
  compromiseCount: number;
}

export interface DataRecordState {
  id: EntityId;
  subjectId: EntityId;
  kind: DataRecordKind;
  ownerEntityId: EntityId;
  sourceEntityId: EntityId;
  districtId?: EntityId;
  sensitivity: DataSensitivity;
  truthScore: number;
  createdDay: number;
  updatedDay: number;
  retentionUntilDay: number;
  compromised: boolean;
  forged: boolean;
  summary: string;
  value: number;
}

export interface DataAccessGrantState {
  id: EntityId;
  granteeEntityId: EntityId;
  recordKinds: DataRecordKind[];
  purpose: DataPurpose;
  scope: "city" | "district" | "subject";
  districtId?: EntityId;
  subjectId?: EntityId;
  validFromDay: number;
  validUntilDay?: number;
  authorityEntityId: EntityId;
  active: boolean;
}

export interface DataAccessEventState {
  id: EntityId;
  dayIndex: number;
  actorEntityId: EntityId;
  recordId: EntityId;
  purpose: DataPurpose;
  outcome: AccessOutcome;
  nodeId?: EntityId;
  caseId?: EntityId;
}

export interface SurveillanceNodeState {
  id: EntityId;
  locationId: EntityId;
  districtId: EntityId;
  ownerEntityId: EntityId;
  kind: SurveillanceNodeKind;
  coverage: number;
  quality: number;
  vulnerability: number;
  retentionDays: number;
  status: SurveillanceNodeStatus;
  powerServiceLevel: number;
  dataServiceLevel: number;
  capturesToday: number;
  recordsGenerated: number;
  lastUpdatedDay: number;
}

export interface SurveillanceObservationState {
  id: EntityId;
  dayIndex: number;
  nodeId: EntityId;
  ownerEntityId: EntityId;
  districtId: EntityId;
  subjectIds: EntityId[];
  vehicleIds?: EntityId[];
  eventKind?: "routine" | "vehicle-theft" | "public-order";
  observedPlate?: string;
  quality: number;
  retainedUntilDay: number;
  accessedByIds: EntityId[];
  compromised: boolean;
}

export interface DataBreachState {
  id: EntityId;
  sourceEntityId: EntityId;
  attackerEntityId?: EntityId;
  districtId: EntityId;
  recordIds: EntityId[];
  status: BreachStatus;
  startedDay: number;
  discoveredDay?: number;
  containedDay?: number;
  severity: number;
  stolenRecords: number;
  marketValue: number;
  evidence: number;
}

export interface IdentityForgeryState {
  id: EntityId;
  residentId: EntityId;
  issuerEntityId: EntityId;
  alias: string;
  quality: number;
  createdDay: number;
  status: ForgeryStatus;
  detectedDay?: number;
  recordIds: EntityId[];
  price: number;
}

export interface DataDailySnapshot {
  dayIndex: number;
  verifiedIdentities: number;
  limitedIdentities: number;
  compromisedIdentities: number;
  activeNodes: number;
  offlineNodes: number;
  accesses: number;
  deniedAccesses: number;
  activeBreaches: number;
  activeForgeries: number;
  averageCreditScore: number;
}

export interface DataSurveillanceTotals {
  recordsCreated: number;
  accesses: number;
  deniedAccesses: number;
  surveillanceCaptures: number;
  breaches: number;
  recordsStolen: number;
  breachesContained: number;
  dataSales: number;
  dataSaleRevenue: number;
  forgeriesCreated: number;
  forgeriesDetected: number;
  identitiesSuspended: number;
}

export interface DataSurveillanceState {
  version: 1;
  identities: DigitalIdentityState[];
  records: DataRecordState[];
  grants: DataAccessGrantState[];
  accessEvents: DataAccessEventState[];
  nodes: SurveillanceNodeState[];
  observations: SurveillanceObservationState[];
  breaches: DataBreachState[];
  forgeries: IdentityForgeryState[];
  history: DataDailySnapshot[];
  totals: DataSurveillanceTotals;
  dayIndex: number;
  simulatedDays: number;
  lastUpdatedAt: number;
}

export interface DataNotice {
  districtId?: EntityId;
  residentId?: EntityId;
  title: string;
  detail: string;
  importance: 1 | 2 | 3;
}

export interface DataAdvanceInput {
  timestamp: number;
  seed: string;
  cityId: EntityId;
  districts: DistrictState[];
  locations: LocationState[];
  organizations: OrganizationState[];
  population: PopulationState;
  economy: LocalEconomyState;
  infrastructure: InfrastructureState;
  organizationEcosystem: OrganizationEcosystemState;
  government: GovernmentCrimeState;
  health: HealthCyberwareState;
}

export interface DataAdvanceResult {
  state: DataSurveillanceState;
  organizations: OrganizationState[];
  population: PopulationState;
  government: GovernmentCrimeState;
  notices: DataNotice[];
  transactions: KernelTransactionDraft[];
}
