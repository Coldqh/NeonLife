import { createStableEntityId } from "../../core/ids/entityId";
import type { WorldMeta } from "../../core/simulation/types";
import { INITIAL_GAME_TIMESTAMP } from "../../core/time/gameTime";

export const DEMO_WORLD_SEED = "SEVEN-DAYS-BELOW-0441";

export const demoWorldMeta: WorldMeta = {
  worldId: createStableEntityId("world", DEMO_WORLD_SEED),
  seed: DEMO_WORLD_SEED,
  createdAt: new Date(INITIAL_GAME_TIMESTAMP).toISOString(),
  simulationVersion: 1,
  currentTimestamp: INITIAL_GAME_TIMESTAMP
};
