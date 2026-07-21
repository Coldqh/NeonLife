import { createSaveChecksum } from "./checksum";
import { migrateEnvelope } from "./migrations";
import {
  SAVE_SCHEMA_VERSION,
  SAVE_SLOT_IDS,
  type RecoveryRecord,
  type SaveEnvelope,
  type SaveSlotId,
  type SaveSlotSummary
} from "./types";
import type { GameSession } from "../../world/state/types";

const DB_NAME = "neon-life";
const DB_VERSION = 1;
const SAVES_STORE = "saves";
const META_STORE = "meta";
const RECOVERY_STORE = "recovery";
const ACTIVE_SLOT_KEY = "active-slot";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

export function openSaveDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SAVES_STORE)) {
        database.createObjectStore(SAVES_STORE, { keyPath: "slotId" });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(RECOVERY_STORE)) {
        database.createObjectStore(RECOVERY_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB"));
  });
}

async function archiveRecovery(database: IDBDatabase, record: RecoveryRecord): Promise<void> {
  const transaction = database.transaction(RECOVERY_STORE, "readwrite");
  transaction.objectStore(RECOVERY_STORE).add(record);
  await transactionDone(transaction);
}

export async function readActiveSlot(database: IDBDatabase): Promise<SaveSlotId> {
  const transaction = database.transaction(META_STORE, "readonly");
  const result = await requestResult<{ key: string; value: SaveSlotId } | undefined>(
    transaction.objectStore(META_STORE).get(ACTIVE_SLOT_KEY)
  );
  return result?.value && SAVE_SLOT_IDS.includes(result.value) ? result.value : "slot-1";
}

export async function writeActiveSlot(database: IDBDatabase, slotId: SaveSlotId): Promise<void> {
  const transaction = database.transaction(META_STORE, "readwrite");
  transaction.objectStore(META_STORE).put({ key: ACTIVE_SLOT_KEY, value: slotId });
  await transactionDone(transaction);
}

export async function saveSession(database: IDBDatabase, slotId: SaveSlotId, payload: GameSession): Promise<SaveEnvelope> {
  const existing = await readRawEnvelope(database, slotId);
  const now = new Date().toISOString();
  const envelope: SaveEnvelope = {
    slotId,
    schemaVersion: SAVE_SCHEMA_VERSION,
    createdAt: existing && typeof existing === "object" && "createdAt" in existing && typeof existing.createdAt === "string"
      ? existing.createdAt
      : now,
    updatedAt: now,
    checksum: createSaveChecksum(payload),
    payload: { ...payload, schemaVersion: SAVE_SCHEMA_VERSION }
  };
  const transaction = database.transaction(SAVES_STORE, "readwrite");
  transaction.objectStore(SAVES_STORE).put(envelope);
  await transactionDone(transaction);
  return envelope;
}

async function readRawEnvelope(database: IDBDatabase, slotId: SaveSlotId): Promise<unknown> {
  const transaction = database.transaction(SAVES_STORE, "readonly");
  return requestResult(transaction.objectStore(SAVES_STORE).get(slotId));
}

export async function loadSession(database: IDBDatabase, slotId: SaveSlotId): Promise<GameSession | null> {
  const raw = await readRawEnvelope(database, slotId);
  if (!raw) return null;

  const rawRecord = raw as { checksum?: unknown; payload?: unknown; schemaVersion?: unknown };
  if (typeof rawRecord.checksum === "string" && rawRecord.checksum && createSaveChecksum(rawRecord.payload) !== rawRecord.checksum) {
    await archiveRecovery(database, {
      slotId,
      capturedAt: new Date().toISOString(),
      reason: "Checksum mismatch",
      raw
    });
    return null;
  }

  const envelope = migrateEnvelope(raw, slotId);
  if (!envelope) {
    await archiveRecovery(database, {
      slotId,
      capturedAt: new Date().toISOString(),
      reason: "Save structure is invalid or from a newer schema",
      raw
    });
    return null;
  }

  const actualChecksum = createSaveChecksum(envelope.payload);
  if (rawRecord.schemaVersion !== SAVE_SCHEMA_VERSION || envelope.checksum !== actualChecksum) {
    await saveSession(database, slotId, envelope.payload);
  }
  return envelope.payload;
}

export async function deleteSession(database: IDBDatabase, slotId: SaveSlotId): Promise<void> {
  const transaction = database.transaction(SAVES_STORE, "readwrite");
  transaction.objectStore(SAVES_STORE).delete(slotId);
  await transactionDone(transaction);
}

export async function listSaveSummaries(database: IDBDatabase): Promise<SaveSlotSummary[]> {
  const transaction = database.transaction(SAVES_STORE, "readonly");
  const records = await requestResult<SaveEnvelope[]>(transaction.objectStore(SAVES_STORE).getAll());
  const bySlot = new Map(records.map((record) => [record.slotId, record]));
  return SAVE_SLOT_IDS.map((slotId) => {
    const record = bySlot.get(slotId);
    if (!record) return { slotId, exists: false };
    return {
      slotId,
      exists: true,
      updatedAt: record.updatedAt,
      playerName: record.payload.player.name,
      cityName: record.payload.world.city.name,
      seed: record.payload.world.meta.seed,
      gameTimestamp: record.payload.timestamp
    };
  });
}

export async function countRecoveryRecords(database: IDBDatabase): Promise<number> {
  const transaction = database.transaction(RECOVERY_STORE, "readonly");
  return requestResult(transaction.objectStore(RECOVERY_STORE).count());
}
