import type { EntityId } from "../../core/ids/entityId";

export type SituationType =
  | "courier-inspection"
  | "delivery-dispute"
  | "staff-shortage"
  | "personal-pressure";

export interface SituationChoice {
  id: string;
  label: string;
  detail: string;
  consequence: string;
  timeMinutes: number;
  cost?: number;
  payout?: number;
  requiredBalance?: number;
}

export interface CitySituation {
  id: EntityId;
  type: SituationType;
  createdAt: number;
  locationId: EntityId;
  personId?: EntityId;
  businessId?: EntityId;
  courierOrderId?: EntityId;
  title: string;
  prompt: string;
  context: string[];
  choices: SituationChoice[];
  payload: Record<string, string | number | boolean>;
}

export interface SituationHistoryEntry {
  id: EntityId;
  situationId: EntityId;
  type: SituationType;
  title: string;
  resolvedAt: number;
  personId?: EntityId;
  locationId: EntityId;
  choiceId: string;
  choiceLabel: string;
  outcome: string;
}

export interface SituationState {
  pending: CitySituation | null;
  history: SituationHistoryEntry[];
  generation: number;
  cooldownUntil: number;
  lastTriggeredAt: number;
}
