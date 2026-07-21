import type { EntityId } from "../../core/ids/entityId";

export type ObligationType = "rent" | "transit" | "medical" | "personal";
export type ObligationStatus = "active" | "overdue" | "paid" | "defaulted";
export type HousingAccessStatus = "active" | "restricted" | "evicted";

export interface ObligationState {
  id: EntityId;
  code: string;
  type: ObligationType;
  creditorName: string;
  creditorPersonId?: EntityId;
  amount: number;
  dueAt: number;
  status: ObligationStatus;
  consequence: string;
  extensionCount: number;
  lastNoticeStage: number;
  paidAt: number | null;
}

export type NpcRequestType = "medicine" | "supply" | "loan" | "cover-shift" | "move-load";
export type NpcRequestStatus = "open" | "accepted" | "completed" | "declined" | "missed";

export interface NpcRequestState {
  id: EntityId;
  code: string;
  personId: EntityId;
  type: NpcRequestType;
  title: string;
  detail: string;
  targetLocationId: EntityId;
  createdAt: number;
  dueAt: number;
  durationMinutes: number;
  upfrontCost: number;
  reward: number;
  status: NpcRequestStatus;
  acceptedAt: number | null;
  completedAt: number | null;
}

export interface DayMetrics {
  dayIndex: number;
  startedAt: number;
  earned: number;
  spent: number;
  deliveries: number;
  requestsCompleted: number;
  requestsMissed: number;
  relationChanges: number;
  worldEvents: number;
}

export interface DaySummary {
  id: EntityId;
  dayIndex: number;
  startedAt: number;
  closedAt: number;
  earned: number;
  spent: number;
  sleepMinutes: number;
  deliveries: number;
  requestsCompleted: number;
  requestsMissed: number;
  relationChanges: number;
  worldEvents: number;
  balanceAfter: number;
}

export interface PressureState {
  weekStartedAt: number;
  weekEndsAt: number;
  obligations: ObligationState[];
  requests: NpcRequestState[];
  housingStatus: HousingAccessStatus;
  currentDay: DayMetrics;
  summaries: DaySummary[];
  requestCycle: number;
  lastProcessedAt: number;
}

export interface PressureNotice {
  category: "finance" | "contact" | "personal";
  title: string;
  detail: string;
  importance: 1 | 2 | 3;
  personId?: EntityId;
  memorySummary?: string;
  trustDelta?: number;
  respectDelta?: number;
  irritationDelta?: number;
}

export interface PressureAdvanceResult {
  state: PressureState;
  notices: PressureNotice[];
  evicted: boolean;
}
