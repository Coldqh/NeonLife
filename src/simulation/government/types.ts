import type { EntityId } from "../../core/ids/entityId";
import type { LocalEconomyState } from "../../gameplay/economy/types";
import type { OrganizationEcosystemState } from "../organizations/types";
import type { InfrastructureState } from "../infrastructure/types";
import type { KernelTransactionDraft } from "../kernel/types";
import type { PopulationState } from "../population/types";
import type { ProductionState } from "../production/types";
import type { DistrictState, LocationState, OrganizationState } from "../../world/state/types";

export type EnforcementFocus = "violent-crime" | "property-crime" | "contraband" | "corporate-compliance" | "public-order";
export type LicenseStatus = "active" | "probation" | "suspended" | "revoked";
export type LicenseKind = "retail" | "food" | "medical" | "industrial" | "logistics" | "data" | "housing" | "security";
export type CrimeOperationKind = "cargo-diversion" | "data-theft" | "counterfeit-cyberware" | "stim-market" | "extortion" | "identity-fraud";
export type CrimeOperationStatus = "active" | "strained" | "disrupted" | "dormant";
export type EnforcementCaseStatus = "open" | "investigating" | "charged" | "closed" | "cold";
export type EnforcementCaseKind = "organized-crime" | "cargo-theft" | "vehicle-theft" | "cybercrime" | "extortion" | "contraband" | "corruption";

export interface GovernmentPolicyState {
  householdIncomeTaxRate: number;
  businessProfitTaxRate: number;
  propertyTaxRate: number;
  licenseStrictness: number;
  laborInspection: number;
  rentProtection: number;
  socialSupport: number;
  dataMonitoring: number;
  contrabandEnforcement: number;
  enforcementFocus: EnforcementFocus;
}

export interface PublicBudgetState {
  authorityOrganizationId: EntityId;
  treasury: number;
  reserveTarget: number;
  debt: number;
  incomeToday: number;
  spendingToday: number;
  taxIncome: number;
  licenseIncome: number;
  fineIncome: number;
  socialSpending: number;
  policingSpending: number;
  infrastructureGrants: number;
  medicalGrants: number;
  courtSpending: number;
  lastSettlementDay: number;
}

export interface BusinessLicenseState {
  id: EntityId;
  businessId: EntityId;
  organizationId?: EntityId;
  kind: LicenseKind;
  status: LicenseStatus;
  issuedAt: number;
  expiresAt: number;
  feePerWeek: number;
  violations: number;
  inspectionRisk: number;
  bribeExposure: number;
  lastInspectionAt?: number;
  nextReviewAt: number;
}

export interface DistrictLawState {
  districtId: EntityId;
  patrolCoverage: number;
  policeReadiness: number;
  corruption: number;
  courtBacklog: number;
  detentionLoad: number;
  publicTrust: number;
  violentCrime: number;
  propertyCrime: number;
  cyberCrime: number;
  illegalMarketShare: number;
  unresolvedCases: number;
  arrests: number;
  convictions: number;
  bribesPaid: number;
  lastUpdatedAt: number;
}

export interface CriminalOperationState {
  id: EntityId;
  networkId: EntityId;
  districtId: EntityId;
  kind: CrimeOperationKind;
  status: CrimeOperationStatus;
  capacity: number;
  demand: number;
  risk: number;
  heat: number;
  secrecy: number;
  revenueToday: number;
  costsToday: number;
  contrabandUnits: number;
  victimBusinessId?: EntityId;
  sourceFacilityId?: EntityId;
  lastUpdatedAt: number;
}

export interface CrimeNetworkState {
  id: EntityId;
  organizationId: EntityId;
  name: string;
  leaderResidentId: EntityId | null;
  memberResidentIds: EntityId[];
  treasury: number;
  heat: number;
  secrecy: number;
  cohesion: number;
  violence: number;
  corruptionBudget: number;
  influenceByDistrict: Record<EntityId, number>;
  operations: CriminalOperationState[];
  lastUpdatedAt: number;
}

export interface EnforcementCaseState {
  id: EntityId;
  districtId: EntityId;
  networkId: EntityId;
  operationId?: EntityId;
  kind: EnforcementCaseKind;
  status: EnforcementCaseStatus;
  evidence: number;
  priority: number;
  openedAt: number;
  updatedAt: number;
  assignedOfficerIds: EntityId[];
  detainedResidentIds: EntityId[];
  seizedCredits: number;
  arrests: number;
  subjectVehicleId?: EntityId;
  suspectResidentIds?: EntityId[];
}

export interface GovernmentDailySnapshot {
  dayIndex: number;
  treasury: number;
  taxIncome: number;
  publicSpending: number;
  crimeRevenue: number;
  arrests: number;
  openCases: number;
  suspendedLicenses: number;
  averagePatrolCoverage: number;
  averageCorruption: number;
}

export interface GovernmentCrimeTotals {
  taxesCollected: number;
  licenseFeesCollected: number;
  finesCollected: number;
  socialTransfers: number;
  publicGrants: number;
  bribesPaid: number;
  crimeRevenue: number;
  cargoStolen: number;
  arrests: number;
  convictions: number;
  casesOpened: number;
  inspections: number;
  licensesSuspended: number;
}

export interface GovernmentCrimeState {
  version: 1;
  policy: GovernmentPolicyState;
  budget: PublicBudgetState;
  licenses: BusinessLicenseState[];
  districts: DistrictLawState[];
  crimeNetworks: CrimeNetworkState[];
  cases: EnforcementCaseState[];
  history: GovernmentDailySnapshot[];
  totals: GovernmentCrimeTotals;
  dayIndex: number;
  simulatedDays: number;
  lastUpdatedAt: number;
}

export interface GovernmentNotice {
  districtId?: EntityId;
  organizationId?: EntityId;
  title: string;
  detail: string;
  importance: 1 | 2 | 3;
}

export interface GovernmentAdvanceInput {
  timestamp: number;
  seed: string;
  cityId: EntityId;
  districts: DistrictState[];
  locations: LocationState[];
  organizations: OrganizationState[];
  population: PopulationState;
  economy: LocalEconomyState;
  infrastructure: InfrastructureState;
  production: ProductionState;
  organizationEcosystem: OrganizationEcosystemState;
}

export interface GovernmentAdvanceResult {
  state: GovernmentCrimeState;
  organizations: OrganizationState[];
  population: PopulationState;
  economy: LocalEconomyState;
  infrastructure: InfrastructureState;
  production: ProductionState;
  notices: GovernmentNotice[];
  transactions: KernelTransactionDraft[];
}
