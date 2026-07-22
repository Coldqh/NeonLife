import type { EntityId } from "../../core/ids/entityId";
import type { KernelTransactionDraft } from "../kernel/types";
import type {
  BackgroundResident,
  EmploymentRecord,
  HouseholdState,
  HousingMarketState,
  OrganizationBudgetDelta,
  PopulationNotice
} from "../population/types";

export type ResidentSex = "female" | "male";
export type EducationLevel = "none" | "basic" | "secondary" | "vocational" | "higher";
export type EducationTrack = "comprehensive" | "technical" | "academy";
export type EducationStatus = "stable" | "strained" | "overloaded";
export type ArchivedResidentStatus = "deceased" | "emigrated";
export type LifecycleEventType =
  | "birth"
  | "adulthood"
  | "graduation"
  | "partnership"
  | "separation"
  | "household-formation"
  | "retirement"
  | "death"
  | "migration-in"
  | "migration-out";

export interface EducationInstitutionState {
  id: EntityId;
  locationId: EntityId;
  districtId: EntityId;
  ownerOrganizationId?: EntityId;
  track: EducationTrack;
  capacity: number;
  enrolled: number;
  quality: number;
  tuitionPerDay: number;
  publicCostPerStudentDay: number;
  waitlist: number;
  status: EducationStatus;
  lastUpdatedDay: number;
}

export interface ArchivedResidentRecord {
  residentId: EntityId;
  activePersonId?: EntityId;
  name: string;
  age: number;
  districtId: EntityId;
  householdId: EntityId;
  status: ArchivedResidentStatus;
  dayIndex: number;
  cause: string;
  destination?: string;
  educationLevel: EducationLevel;
  partnerId?: EntityId | null;
  parentIds: EntityId[];
  childIds: EntityId[];
}

export interface LifecycleEventState {
  id: EntityId;
  dayIndex: number;
  type: LifecycleEventType;
  residentIds: EntityId[];
  householdIds: EntityId[];
  districtId: EntityId;
  summary: string;
}

export interface PopulationLifecycleTotals {
  births: number;
  deaths: number;
  immigrants: number;
  emigrants: number;
  partnerships: number;
  separations: number;
  householdsFormed: number;
  graduates: number;
  retirements: number;
}

export interface PopulationLifecycleState {
  version: 1;
  institutions: EducationInstitutionState[];
  archive: ArchivedResidentRecord[];
  events: LifecycleEventState[];
  representedPopulationByDistrict: Record<EntityId, number>;
  totals: PopulationLifecycleTotals;
  lastProcessedDay: number;
}

export interface LifecycleAdvanceInput {
  state: PopulationLifecycleState;
  dayIndex: number;
  seed: string;
  residents: BackgroundResident[];
  households: HouseholdState[];
  employments: EmploymentRecord[];
  housing: HousingMarketState[];
  districts: Array<{ id: EntityId; population: number; pollution: number; infrastructure: number; employmentRate: number }>;
  locations: Array<{ id: EntityId; districtId: EntityId; organizationId?: EntityId; name: string; type: string }>;
  organizations: Array<{ id: EntityId; budget: number }>;
}

export interface LifecycleAdvanceResult {
  state: PopulationLifecycleState;
  residents: BackgroundResident[];
  households: HouseholdState[];
  employments: EmploymentRecord[];
  housing: HousingMarketState[];
  notices: PopulationNotice[];
  organizationBudgetDeltas: OrganizationBudgetDelta[];
  transactions: KernelTransactionDraft[];
}
