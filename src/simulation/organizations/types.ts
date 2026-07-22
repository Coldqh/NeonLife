import type { EntityId } from "../../core/ids/entityId";
import type { LocalEconomyState } from "../../gameplay/economy/types";
import type { DistrictState, LocationState, OrganizationState } from "../../world/state/types";
import type { InfrastructureState } from "../infrastructure/types";
import type { KernelTransactionDraft, SimulationKernelState } from "../kernel/types";
import type { PopulationState } from "../population/types";
import type { ProductionState } from "../production/types";

export type OrganizationGovernance = "board" | "executive" | "cooperative" | "bureau" | "union" | "cell";
export type OrganizationStrategy =
  | "expansion"
  | "consolidation"
  | "service-restoration"
  | "supply-security"
  | "workforce-retention"
  | "cost-control"
  | "market-capture"
  | "territorial-network"
  | "reserve-building";
export type OrganizationHealth = "expanding" | "stable" | "strained" | "distressed" | "dormant";
export type OrganizationRelationStatus = "partner" | "dependent" | "neutral" | "rival" | "hostile";
export type OrganizationAgreementKind = "supply-framework" | "service-concession" | "labor-compact" | "joint-operation" | "nonaggression";
export type OrganizationAgreementStatus = "active" | "strained" | "breached" | "ended";
export type OrganizationDecisionType =
  | "fund-operation"
  | "restore-network"
  | "secure-supply"
  | "expand-business"
  | "expand-production"
  | "raise-compensation"
  | "reduce-costs"
  | "fund-backchannel"
  | "build-reserve";
export type OrganizationDecisionStatus = "executed" | "blocked" | "deferred";

export interface OrganizationLeadershipState {
  leaderResidentId: EntityId | null;
  managementResidentIds: EntityId[];
  leadershipScore: number;
  continuity: number;
  appointedDay: number;
  changes: number;
}

export interface OrganizationMetricsState {
  treasury: number;
  baselineTreasury: number;
  assetValue: number;
  operatingProfit: number;
  ownedBusinesses: number;
  ownedFacilities: number;
  ownedNetworks: number;
  ownedHousing: number;
  simulatedWorkers: number;
  activeWorkers: number;
  staffGap: number;
  supplyBreaches: number;
  serviceReliability: number;
  productionReliability: number;
  marketShare: number;
}

export interface OrganizationActorState {
  organizationId: EntityId;
  governance: OrganizationGovernance;
  health: OrganizationHealth;
  strategy: OrganizationStrategy;
  riskTolerance: number;
  reserveTarget: number;
  wagePosition: number;
  legalPreference: number;
  leadership: OrganizationLeadershipState;
  metrics: OrganizationMetricsState;
  influenceByDistrict: Record<EntityId, number>;
  activeDecisionId?: EntityId;
  lastDecisionWeek: number;
  lastUpdatedAt: number;
}

export interface OrganizationRelationState {
  id: EntityId;
  sourceOrganizationId: EntityId;
  targetOrganizationId: EntityId;
  trust: number;
  rivalry: number;
  dependency: number;
  leverage: number;
  status: OrganizationRelationStatus;
  lastUpdatedAt: number;
}

export interface OrganizationAgreementState {
  id: EntityId;
  kind: OrganizationAgreementKind;
  sourceOrganizationId: EntityId;
  targetOrganizationId: EntityId;
  status: OrganizationAgreementStatus;
  startedAt: number;
  endedAt?: number;
  reviewAt: number;
  breachCount: number;
  linkedContractIds: EntityId[];
  weeklyValue: number;
  metadata: Record<string, string | number | boolean>;
}

export interface OrganizationDecisionState {
  id: EntityId;
  organizationId: EntityId;
  type: OrganizationDecisionType;
  strategy: OrganizationStrategy;
  status: OrganizationDecisionStatus;
  createdAt: number;
  executedAt?: number;
  targetEntityId?: EntityId;
  targetOrganizationId?: EntityId;
  creditsCommitted: number;
  description: string;
  effects: Record<string, string | number | boolean>;
}

export interface OrganizationWeeklySnapshot {
  weekIndex: number;
  activeOrganizations: number;
  distressedOrganizations: number;
  strategicInvestments: number;
  creditsCommitted: number;
  leadershipChanges: number;
  agreementsActive: number;
  agreementsBreached: number;
}

export interface OrganizationEcosystemTotals {
  decisions: number;
  blockedDecisions: number;
  investments: number;
  creditsCommitted: number;
  expansions: number;
  contractions: number;
  leadershipChanges: number;
  agreementsCreated: number;
  agreementsBreached: number;
}

export interface OrganizationEcosystemState {
  version: 1;
  actors: OrganizationActorState[];
  relations: OrganizationRelationState[];
  agreements: OrganizationAgreementState[];
  decisions: OrganizationDecisionState[];
  history: OrganizationWeeklySnapshot[];
  totals: OrganizationEcosystemTotals;
  dayIndex: number;
  weekIndex: number;
  simulatedWeeks: number;
  lastUpdatedAt: number;
}

export interface OrganizationNotice {
  organizationId: EntityId;
  districtId?: EntityId;
  title: string;
  detail: string;
  importance: 1 | 2 | 3;
}

export interface OrganizationAdvanceResult {
  state: OrganizationEcosystemState;
  organizations: OrganizationState[];
  population: PopulationState;
  economy: LocalEconomyState;
  infrastructure: InfrastructureState;
  production: ProductionState;
  notices: OrganizationNotice[];
  transactions: KernelTransactionDraft[];
}

export interface OrganizationEcosystemInput {
  timestamp: number;
  seed: string;
  organizations: OrganizationState[];
  population: PopulationState;
  economy: LocalEconomyState;
  infrastructure: InfrastructureState;
  production: ProductionState;
  kernel: SimulationKernelState;
  districts: DistrictState[];
  locations: LocationState[];
}
