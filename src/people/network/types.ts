import type { EntityId } from "../../core/ids/entityId";

export type PersonRole =
  | "dispatcher"
  | "courier"
  | "vendor"
  | "housing-manager"
  | "clinic-assistant"
  | "transit-guard"
  | "cook"
  | "technician"
  | "office-clerk"
  | "neighbor"
  | "loader"
  | "independent";

export type PersonProblemType =
  | "rent"
  | "medical-debt"
  | "family-care"
  | "job-risk"
  | "missing-supply"
  | "work-conflict"
  | "exhaustion"
  | "unsafe-housing";

export interface PersonScheduleBlock {
  startHour: number;
  endHour: number;
  activity: "home" | "work" | "commute" | "errand" | "rest";
  locationId: EntityId;
}

export interface PersonProblem {
  type: PersonProblemType;
  title: string;
  detail: string;
  severity: number;
  progress: number;
}

export interface PersonRelationLink {
  personId: EntityId;
  kind: "family" | "friend" | "coworker" | "debtor" | "rival" | "client";
  strength: number;
}

export interface PersonMemory {
  id: EntityId;
  timestamp: number;
  type: "player-action" | "work" | "personal" | "rumor";
  summary: string;
  importance: number;
  emotionalValue: number;
  confidence: number;
}

export interface PersonState {
  id: EntityId;
  profileCode: string;
  name: string;
  age: number;
  role: PersonRole;
  roleLabel: string;
  homeLocationId: EntityId;
  workLocationId: EntityId;
  currentLocationId: EntityId;
  status: string;
  lifeStatus?: "alive" | "deceased" | "migrated";
  lifecycleNote?: string;
  money: number;
  fatigue: number;
  stress: number;
  trustToPlayer: number;
  respectToPlayer: number;
  irritationToPlayer: number;
  debtToPlayer: number;
  playerDebt: number;
  knownFacts: string[];
  problem: PersonProblem;
  schedule: PersonScheduleBlock[];
  relations: PersonRelationLink[];
  memories: PersonMemory[];
  lastAdvancedAt: number;
}

export interface HumanNetworkState {
  people: PersonState[];
  lastUpdatedAt: number;
  cycle: number;
  selectedPersonId: EntityId | null;
}

export interface HumanNetworkNotice {
  personId: EntityId;
  title: string;
  detail: string;
  importance: 1 | 2 | 3;
}

export interface HumanNetworkAdvanceResult {
  state: HumanNetworkState;
  notices: HumanNetworkNotice[];
}
