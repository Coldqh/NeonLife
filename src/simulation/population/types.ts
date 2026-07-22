import type { EntityId } from "../../core/ids/entityId";
import type { FoodState } from "../../gameplay/food/foodSystem";
import type { LocalEconomyState } from "../../gameplay/economy/types";
import type { CareerPreference, JobSearchStatus, LaborMarketState, ResidentSkillProfile, SkillDomain } from "../labor/types";
import type { KernelTransactionDraft } from "../kernel/types";
import type { EducationLevel, PopulationLifecycleState, ResidentSex } from "../lifecycle/types";

export type HouseholdKind = "single" | "couple" | "family" | "shared" | "dormitory" | "temporary" | "unhoused";
export type HouseholdStatus = "stable" | "strained" | "arrears" | "displaced";
export type HouseholdSpendingMode = "survival" | "restricted" | "standard" | "comfortable";
export type ResidentLifeStage = "child" | "working-age" | "elderly";
export type ResidentHealth = "healthy" | "strained" | "ill" | "disabled";
export type EmploymentStatus = "active" | "absent" | "unemployed";
export type ShiftType = "day" | "night" | "rotating";
export type HousingMarketStatus = "stable" | "degraded" | "critical";

export interface BackgroundResident {
  id: EntityId;
  name: string;
  age: number;
  lifeStage: ResidentLifeStage;
  districtId: EntityId;
  householdId: EntityId;
  homeLocationId: EntityId | null;
  employmentId: EntityId | null;
  health: ResidentHealth;
  healthScore: number;
  skillLevel: number;
  savings: number;
  transportAccess: number;
  activePersonId?: EntityId;
  skills?: ResidentSkillProfile;
  careerPreference?: CareerPreference;
  jobSearchStatus?: JobSearchStatus;
  experienceDays?: number;
  lastJobChangeDay?: number | null;
  birthDay?: number;
  sex?: ResidentSex;
  educationLevel?: EducationLevel;
  educationProgressDays?: number;
  enrolledInstitutionId?: EntityId | null;
  partnerId?: EntityId | null;
  parentIds?: EntityId[];
  childIds?: EntityId[];
  generation?: number;
  retired?: boolean;
}

export interface HouseholdPantryItem {
  productId: string;
  units: number;
}

export interface HouseholdPurchase {
  productId: string;
  units: number;
  locationId: EntityId;
  paid: number;
}

export interface HouseholdDailyLedger {
  dayIndex: number;
  income: number;
  rentPaid: number;
  foodSpent: number;
  transportSpent: number;
  medicalSpent: number;
  discretionarySpent: number;
  utilitySpent: number;
  debtPaid: number;
  unmetFoodUnits: number;
  purchases: HouseholdPurchase[];
}

export interface HouseholdState {
  id: EntityId;
  districtId: EntityId;
  homeLocationId: EntityId | null;
  kind: HouseholdKind;
  memberIds: EntityId[];
  balance: number;
  debt: number;
  foodUnits: number;
  pantry: HouseholdPantryItem[];
  rentPerWeek: number;
  dailyIncome: number;
  dailyExpenses: number;
  housingSecurity: number;
  status: HouseholdStatus;
  spendingMode: HouseholdSpendingMode;
  consecutiveDeficitDays: number;
  consecutiveRentMisses: number;
  moveCount: number;
  lastLedger: HouseholdDailyLedger | null;
  foundedDay?: number;
  originHouseholdIds?: EntityId[];
}

export interface EmploymentRecord {
  id: EntityId;
  residentId: EntityId;
  organizationId?: EntityId;
  locationId: EntityId;
  title: string;
  wagePerDay: number;
  shift: ShiftType;
  status: EmploymentStatus;
  absenceDays: number;
  unpaidDays: number;
  roleId?: string;
  skillDomain?: SkillDomain;
  minimumSkill?: number;
  startedDay?: number;
  satisfaction?: number;
  performance?: number;
  quitPressure?: number;
  separationReason?: "quit" | "layoff" | "nonpayment" | "closure" | "retirement" | "death" | "migration";
  endedDay?: number;
}

export interface HousingMarketState {
  id: EntityId;
  locationId: EntityId;
  districtId: EntityId;
  ownerOrganizationId?: EntityId;
  capacity: number;
  occupied: number;
  baseRentPerBedWeek: number;
  quality: number;
  condition: number;
  maintenanceFund: number;
  rentCollectedToday: number;
  arrearsHouseholds: number;
  status: HousingMarketStatus;
  lastUpdatedAt: number;
}

export interface DistrictPopulationCohort {
  districtId: EntityId;
  sampleSize: number;
  representedPopulation: number;
  children: number;
  workingAge: number;
  elderly: number;
  employed: number;
  unemployed: number;
  ill: number;
  unhoused: number;
  households: number;
  householdsInArrears: number;
  averageHouseholdBalance: number;
  averageRent: number;
  foodSecureHouseholds: number;
}

export interface PopulationTransactionTotals {
  wagesPaid: number;
  unpaidWages: number;
  rentPaid: number;
  foodSales: number;
  medicalSales: number;
  transportSales: number;
  discretionarySales: number;
  utilitySales: number;
  debtRepaid: number;
  maintenanceSpent: number;
  moves: number;
}

export interface PopulationState {
  residents: BackgroundResident[];
  households: HouseholdState[];
  employments: EmploymentRecord[];
  housing: HousingMarketState[];
  cohorts: DistrictPopulationCohort[];
  laborMarket: LaborMarketState;
  lifecycle: PopulationLifecycleState;
  totals: PopulationTransactionTotals;
  lastUpdatedAt: number;
  dayIndex: number;
  simulatedDays: number;
}

export interface PopulationNotice {
  districtId: EntityId;
  title: string;
  detail: string;
  importance: 1 | 2 | 3;
}

export interface OrganizationBudgetDelta {
  organizationId: EntityId;
  delta: number;
}

export interface PopulationAdvanceResult {
  state: PopulationState;
  economy: LocalEconomyState;
  food: FoodState;
  notices: PopulationNotice[];
  organizationBudgetDeltas: OrganizationBudgetDelta[];
  transactions: KernelTransactionDraft[];
}
