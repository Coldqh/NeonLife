import type { EntityId } from "../../core/ids/entityId";
import type { ShiftType } from "../population/types";

export type SkillDomain = "logistics" | "technical" | "medical" | "service" | "administration" | "security";
export type CareerPreference = "income" | "stability" | "distance" | "day-shift" | "advancement";
export type JobSearchStatus = "inactive" | "open" | "urgent";
export type VacancyStatus = "open" | "filled" | "cancelled";
export type VacancyReason = "expansion" | "replacement" | "turnover" | "chronic-shortage";
export type ApplicationStatus = "submitted" | "rejected" | "accepted" | "withdrawn";

export interface ResidentSkillProfile {
  logistics: number;
  technical: number;
  medical: number;
  service: number;
  administration: number;
  security: number;
}

export interface VacancyState {
  id: EntityId;
  businessId: EntityId;
  organizationId?: EntityId;
  locationId: EntityId;
  title: string;
  requiredSkill: SkillDomain;
  minimumSkill: number;
  wagePerDay: number;
  shift: ShiftType;
  openedDay: number;
  expiresDay: number;
  status: VacancyStatus;
  reason: VacancyReason;
  applicationIds: EntityId[];
  hiredResidentId?: EntityId;
  filledDay?: number;
}

export interface JobApplicationState {
  id: EntityId;
  vacancyId: EntityId;
  residentId: EntityId;
  submittedDay: number;
  score: number;
  skillScore: number;
  wageGain: number;
  commutePenalty: number;
  status: ApplicationStatus;
}

export interface LaborMarketDailySnapshot {
  dayIndex: number;
  openVacancies: number;
  applications: number;
  hires: number;
  quits: number;
  averageOffer: number;
  averageDaysOpen: number;
}

export interface LaborMarketState {
  vacancies: VacancyState[];
  applications: JobApplicationState[];
  history: LaborMarketDailySnapshot[];
  lastUpdatedDay: number;
  totalHires: number;
  totalQuits: number;
  totalLayoffs: number;
  totalJobChanges: number;
  totalRejectedApplications: number;
  wagePressureByDistrict: Record<EntityId, number>;
}
