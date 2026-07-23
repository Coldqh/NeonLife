import type { EntityId } from "../../core/ids/entityId";
import type { LocalEconomyState } from "../../gameplay/economy/types";
import type { GovernmentCrimeState } from "../government/types";
import type { InfrastructureState } from "../infrastructure/types";
import type { KernelTransactionDraft } from "../kernel/types";
import type { PopulationState } from "../population/types";
import type { ProductionState } from "../production/types";
import type { OrganizationState, DistrictState, LocationState } from "../../world/state/types";

export type ConditionKind =
  | "respiratory-infection"
  | "gastrointestinal-infection"
  | "industrial-trauma"
  | "repetitive-strain"
  | "toxic-exposure"
  | "chronic-respiratory"
  | "cardiovascular"
  | "sleep-disorder"
  | "trauma-disorder"
  | "stimulant-dependence"
  | "implant-rejection"
  | "implant-failure";
export type ConditionOrigin = "infection" | "workplace" | "pollution" | "housing" | "crime" | "dependency" | "cyberware";
export type ConditionStage = "acute" | "chronic" | "recovering" | "resolved";
export type CareLevel = "self-care" | "primary" | "urgent" | "inpatient" | "surgery";
export type CaseStatus = "waiting" | "admitted" | "treated" | "discharged" | "abandoned";
export type FacilityKind = "walk-in" | "trauma-center" | "hospital" | "occupational" | "underground";
export type FacilityStatus = "stable" | "strained" | "restricted" | "closed";
export type InsurancePlanKind = "public-basic" | "employer" | "private" | "uninsured";
export type InsuranceStatus = "active" | "lapsed" | "exhausted";
export type DebtStatus = "current" | "delinquent" | "written-off" | "paid";
export type CyberwareCategory = "industrial" | "medical" | "sensory" | "communications" | "neural" | "mobility" | "protective" | "combat";
export type CyberwareStatus = "active" | "degraded" | "failed" | "removed";

export interface ClinicalConditionState {
  id: EntityId;
  residentId: EntityId;
  kind: ConditionKind;
  origin: ConditionOrigin;
  stage: ConditionStage;
  onsetDay: number;
  severity: number;
  contagiousness: number;
  workRestriction: number;
  careLevel: CareLevel;
  untreatedDays: number;
  treatmentDays: number;
  lastTreatedDay?: number;
  resolvedDay?: number;
  sourceEntityId?: EntityId;
}

export interface PatientCaseState {
  id: EntityId;
  residentId: EntityId;
  conditionIds: EntityId[];
  facilityId: EntityId;
  triageLevel: 1 | 2 | 3 | 4 | 5;
  status: CaseStatus;
  requestedDay: number;
  admittedDay?: number;
  dischargedDay?: number;
  waitingDays: number;
  estimatedCost: number;
  insurerPaid: number;
  patientPaid: number;
  debtCreated: number;
}

export interface HealthFacilityState {
  id: EntityId;
  locationId: EntityId;
  districtId: EntityId;
  ownerOrganizationId: EntityId;
  kind: FacilityKind;
  licensed: boolean;
  bedCapacity: number;
  treatmentRooms: number;
  surgicalRooms: number;
  staffing: number;
  serviceLevel: number;
  medicalStock: number;
  implantParts: number;
  maintenanceKits: number;
  cash: number;
  queueLength: number;
  occupiedBeds: number;
  status: FacilityStatus;
  lastUpdatedDay: number;
}

export interface InsurancePolicyState {
  id: EntityId;
  householdId: EntityId;
  kind: InsurancePlanKind;
  status: InsuranceStatus;
  insurerEntityId: EntityId;
  sponsorOrganizationId?: EntityId;
  premiumPerWeek: number;
  deductible: number;
  coveragePercent: number;
  annualLimit: number;
  usedThisYear: number;
  lastPremiumDay: number;
}

export interface MedicalDebtState {
  id: EntityId;
  householdId: EntityId;
  providerEntityId: EntityId;
  principal: number;
  weeklyInterestRate: number;
  status: DebtStatus;
  createdDay: number;
  lastPaymentDay: number;
}

export interface CyberwareModelState {
  id: EntityId;
  name: string;
  manufacturerOrganizationId: EntityId;
  category: CyberwareCategory;
  licensed: boolean;
  quality: number;
  basePrice: number;
  installationMedicalUnits: number;
  installationPartsUnits: number;
  maintenanceIntervalDays: number;
  expectedServiceDays: number;
  baseFailureRisk: number;
  rejectionRisk: number;
  minimumMedicalSkill: number;
  workSkillBonus: number;
}

export interface CyberwareInstallationState {
  id: EntityId;
  residentId: EntityId;
  modelId: EntityId;
  providerFacilityId: EntityId;
  installedDay: number;
  condition: number;
  maintenanceDueDay: number;
  lastMaintenanceDay: number;
  licensedSerial: boolean;
  financedBy: "cash" | "insurance" | "employer" | "medical-debt" | "criminal-credit";
  debtId?: EntityId;
  status: CyberwareStatus;
  failures: number;
}

export interface HealthDailySnapshot {
  dayIndex: number;
  activeConditions: number;
  waitingCases: number;
  treatedCases: number;
  occupiedBeds: number;
  uninsuredResidents: number;
  medicalDebt: number;
  installations: number;
  failedImplants: number;
}

export interface HealthCyberwareTotals {
  conditionsCreated: number;
  casesCreated: number;
  casesTreated: number;
  inpatientAdmissions: number;
  procedures: number;
  deathsLinkedToCareDelay: number;
  insuranceClaimsPaid: number;
  patientPayments: number;
  debtCreated: number;
  debtRepaid: number;
  cyberwareInstalled: number;
  cyberwareMaintained: number;
  cyberwareFailures: number;
  undergroundProcedures: number;
  medicalUnitsConsumed: number;
  partsUnitsConsumed: number;
}

export interface HealthCyberwareState {
  version: 1;
  facilities: HealthFacilityState[];
  conditions: ClinicalConditionState[];
  cases: PatientCaseState[];
  policies: InsurancePolicyState[];
  debts: MedicalDebtState[];
  cyberwareModels: CyberwareModelState[];
  installations: CyberwareInstallationState[];
  history: HealthDailySnapshot[];
  totals: HealthCyberwareTotals;
  dayIndex: number;
  simulatedDays: number;
  lastUpdatedAt: number;
}

export interface HealthNotice {
  districtId?: EntityId;
  residentId?: EntityId;
  title: string;
  detail: string;
  importance: 1 | 2 | 3;
}

export interface HealthAdvanceInput {
  timestamp: number;
  seed: string;
  districts: DistrictState[];
  locations: LocationState[];
  organizations: OrganizationState[];
  population: PopulationState;
  economy: LocalEconomyState;
  infrastructure: InfrastructureState;
  production: ProductionState;
  government: GovernmentCrimeState;
}

export interface HealthAdvanceResult {
  state: HealthCyberwareState;
  organizations: OrganizationState[];
  population: PopulationState;
  economy: LocalEconomyState;
  production: ProductionState;
  government: GovernmentCrimeState;
  notices: HealthNotice[];
  transactions: KernelTransactionDraft[];
}
