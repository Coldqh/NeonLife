import { createStableEntityId } from "../../core/ids/entityId";
import type { WorldMeta } from "../../core/simulation/types";
import { INITIAL_GAME_TIMESTAMP } from "../../core/time/gameTime";

export const DEFAULT_WORLD_SEED = "LYSARA-UNDERLINE-0701";
export const DEMO_WORLD_SEED = DEFAULT_WORLD_SEED;

export function createWorldMeta(seed: string): WorldMeta {
  return {
    worldId: createStableEntityId("world", seed),
    seed,
    createdAt: new Date(INITIAL_GAME_TIMESTAMP).toISOString(),
    simulationVersion: 2,
    currentTimestamp: INITIAL_GAME_TIMESTAMP
  };
}

export const demoWorldMeta = createWorldMeta(DEFAULT_WORLD_SEED);
