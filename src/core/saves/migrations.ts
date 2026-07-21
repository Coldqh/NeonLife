import { SAVE_SCHEMA_VERSION, type SaveEnvelope, type SaveSlotId } from "./types";
import type { GameSession } from "../../world/state/types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasBaseSessionShape(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  return typeof value.timestamp === "number"
    && isObject(value.world)
    && isObject(value.player)
    && Array.isArray(value.events)
    && isObject(value.district)
    && isObject(value.primaryContact);
}

export function migrateEnvelope(raw: unknown, slotId: SaveSlotId): SaveEnvelope | null {
  if (!isObject(raw) || !hasBaseSessionShape(raw.payload)) return null;
  const schemaVersion = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;
  if (schemaVersion > SAVE_SCHEMA_VERSION) return null;

  const payload = raw.payload;
  const world = payload.world as Record<string, unknown>;
  const meta = world.meta as Record<string, unknown> | undefined;
  const district = payload.district as Record<string, unknown>;
  const migratedPayload = {
    ...payload,
    schemaVersion: SAVE_SCHEMA_VERSION,
    eventQueue: Array.isArray(payload.eventQueue) ? payload.eventQueue : [],
    district: {
      ...district,
      seedScope: typeof district.seedScope === "string" ? district.seedScope : String(meta?.seed ?? "NEON-LIFE-MIGRATED")
    }
  } as unknown as GameSession;

  return {
    slotId,
    schemaVersion: SAVE_SCHEMA_VERSION,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    checksum: typeof raw.checksum === "string" ? raw.checksum : "",
    payload: migratedPayload
  };
}
