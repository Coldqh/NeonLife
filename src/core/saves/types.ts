import type { GameSession } from "../../world/state/types";

export const SAVE_SCHEMA_VERSION = 10;
export const SAVE_SLOT_IDS = ["slot-1", "slot-2", "slot-3"] as const;

export type SaveSlotId = typeof SAVE_SLOT_IDS[number];

export interface SaveEnvelope {
  slotId: SaveSlotId;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  checksum: string;
  payload: GameSession;
}

export interface SaveSlotSummary {
  slotId: SaveSlotId;
  exists: boolean;
  updatedAt?: string;
  playerName?: string;
  cityName?: string;
  seed?: string;
  gameTimestamp?: number;
}

export interface RecoveryRecord {
  id?: number;
  slotId: SaveSlotId;
  capturedAt: string;
  reason: string;
  raw: unknown;
}

export interface SaveSystemState {
  activeSlotId: SaveSlotId;
  summaries: SaveSlotSummary[];
  lastSavedAt: string | null;
  recoveryCount: number;
  status: "booting" | "ready" | "saving" | "error";
  error: string | null;
}
