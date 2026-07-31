import type { EntityId } from "../../../core/ids/entityId";
import type { VenueOperationsState } from "../../../simulation/venues/types";
import type { VenueState } from "../../../simulation/urban/types";

export type PlayerWorkRole = "cashier" | "cafe-crew" | "clinic-aide" | "mechanic" | "courier";
export type PlayerWorkSkill = "service" | "cooking" | "medical" | "technical";
export type PlayerWorkVacancyStatus = "open" | "offered" | "filled" | "closed";
export type PlayerWorkApplicationStatus = "interviewed" | "accepted" | "rejected" | "withdrawn";
export type PlayerWorkContractStatus = "active" | "warning" | "dismissed" | "resigned";
export type PlayerWorkShiftStatus = "scheduled" | "in-progress" | "completed" | "missed";
export type PlayerWorkTaskStatus = "pending" | "completed";
export type PlayerWorkTaskKind =
  | "serve-customer"
  | "check-shelves"
  | "reconcile-register"
  | "take-order"
  | "prepare-meal"
  | "handoff-order"
  | "register-patient"
  | "carry-supplies"
  | "assist-care"
  | "inspect-vehicle"
  | "fetch-parts"
  | "repair-vehicle"
  | "sort-cargo"
  | "scan-manifest"
  | "dispatch-run";

export interface PlayerWorkSkillsState {
  service: number;
  cooking: number;
  medical: number;
  technical: number;
}

export interface PlayerWorkVacancyState {
  id: EntityId;
  venueId: EntityId;
  buildingId: EntityId;
  unitId: EntityId;
  role: PlayerWorkRole;
  title: string;
  requiredSkill: PlayerWorkSkill;
  minimumSkill: number;
  wagePerHour: number;
  shiftStartHour: number;
  shiftDurationHours: number;
  postedAt: number;
  expiresAt: number;
  status: PlayerWorkVacancyStatus;
}

export interface PlayerWorkApplicationState {
  id: EntityId;
  vacancyId: EntityId;
  venueId: EntityId;
  status: PlayerWorkApplicationStatus;
  score: number;
  interviewedAt: number;
  decisionText: string;
}

export interface PlayerWorkContractState {
  id: EntityId;
  vacancyId: EntityId;
  venueId: EntityId;
  role: PlayerWorkRole;
  title: string;
  status: PlayerWorkContractStatus;
  wagePerHour: number;
  shiftStartHour: number;
  shiftDurationHours: number;
  workDays: number[];
  startedAt: number;
  nextShiftAt: number;
  completedShifts: number;
  probationShifts: number;
  warningCount: number;
  unpaidWages: number;
  rank: number;
  lastShiftAt?: number;
  dismissedAt?: number;
  dismissalReason?: string;
  resignedAt?: number;
}

export interface PlayerWorkTaskState {
  id: EntityId;
  shiftId: EntityId;
  kind: PlayerWorkTaskKind;
  label: string;
  description: string;
  skill: PlayerWorkSkill;
  durationMinutes: number;
  status: PlayerWorkTaskStatus;
  quality: number;
  completedAt?: number;
}

export interface PlayerWorkShiftState {
  id: EntityId;
  contractId: EntityId;
  venueId: EntityId;
  scheduledStartAt: number;
  scheduledEndAt: number;
  status: PlayerWorkShiftStatus;
  startedAt?: number;
  endedAt?: number;
  lateMinutes: number;
  taskIds: EntityId[];
  completedTaskCount: number;
  quality: number;
  grossPay: number;
  paidAmount: number;
  unpaidAmount: number;
}

export interface PlayerWorkState {
  version: 1;
  vacancies: PlayerWorkVacancyState[];
  applications: PlayerWorkApplicationState[];
  contracts: PlayerWorkContractState[];
  shifts: PlayerWorkShiftState[];
  tasks: PlayerWorkTaskState[];
  skills: PlayerWorkSkillsState;
  activeContractId?: EntityId;
  activeShiftId?: EntityId;
  totalEarned: number;
  totalUnpaid: number;
  lastVacancyRefreshDay: number;
  lastUpdatedAt: number;
}

export interface PlayerWorkInput {
  seed: string;
  playerId?: EntityId;
  timestamp: number;
  venues: VenueState[];
  venueOperations: VenueOperationsState;
}

export interface PlayerWorkInterviewInput extends PlayerWorkInput {
  playerHealth: number;
  playerFatigue: number;
  playerStress: number;
}

export interface PlayerWorkTaskResult {
  state: PlayerWorkState;
  venueOperations: VenueOperationsState;
  durationMinutes: number;
  message: string;
}

export interface PlayerWorkFinishResult {
  state: PlayerWorkState;
  venueOperations: VenueOperationsState;
  pay: number;
  unpaid: number;
  remainingMinutes: number;
  message: string;
}

export interface PlayerWorkDebtResult {
  state: PlayerWorkState;
  venueOperations: VenueOperationsState;
  paid: number;
  remaining: number;
}
