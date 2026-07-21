import type { EntityId } from "../ids/entityId";

export interface WorldMeta {
  worldId: EntityId;
  seed: string;
  createdAt: string;
  simulationVersion: number;
  currentTimestamp: number;
}

export interface ScheduledSimulationEvent {
  id: EntityId;
  executeAt: number;
  type: string;
  entityIds: EntityId[];
  payload: Record<string, unknown>;
}
