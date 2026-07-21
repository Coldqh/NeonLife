import type { EntityId } from "../../core/ids/entityId";

export interface ActionRequirement {
  type: string;
  value?: number | string | boolean;
  entityId?: EntityId;
}

export interface ActionCost {
  resource: string;
  amount: number;
}

export interface ActionRisk {
  type: string;
  probability: number;
  severity: number;
}

export interface ActionEffect {
  type: string;
  targetId?: EntityId;
  value?: number | string | boolean;
}

export type WorldActionStatus =
  | "planned"
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface WorldAction {
  id: EntityId;
  type: string;
  actorId: EntityId;
  targetIds: EntityId[];
  locationId: EntityId;
  startTimestamp: number;
  durationMinutes: number;
  requirements: ActionRequirement[];
  costs: ActionCost[];
  risks: ActionRisk[];
  effects: ActionEffect[];
  status: WorldActionStatus;
}
