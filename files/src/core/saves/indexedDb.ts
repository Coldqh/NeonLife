import { createSaveChecksum, createSaveChecksumFromJson } from "./checksum";
import { migrateEnvelope } from "./migrations";
import {
  GZIP_JSON_ENCODING,
  PLAIN_JSON_ENCODING,
  decodeSavePayloadJson,
  encodeSavePayloadJson,
  type EncodedSavePayload,
  type SavePayloadEncoding
} from "./saveCodec";
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
type StoredSaveSummary = Omit<SaveSlotSummary, "exists">;

interface EncodedSaveEnvelope {
  slotId: SaveSlotId;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  checksum: string;
  payloadEncoding: SavePayloadEncoding;
  payloadData: Blob | string;
  summary: StoredSaveSummary;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEncodedEnvelope(value: unknown): value is EncodedSaveEnvelope {
  if (!isRecord(value)) return false;
  return value.payloadEncoding === GZIP_JSON_ENCODING || value.payloadEncoding === PLAIN_JSON_ENCODING;
}


function isCurrentGameSession(value: unknown): value is GameSession {
  if (!isRecord(value)) return false;
  return value.schemaVersion === SAVE_SCHEMA_VERSION
    && typeof value.timestamp === "number"
    && isRecord(value.world)
    && isRecord(value.player)
    && isRecord(value.playerLoop)
    && Array.isArray(value.events)
    && isRecord(value.district);
}

function summaryFor(slotId: SaveSlotId, updatedAt: string, payload: GameSession): StoredSaveSummary {
  return {
    slotId,
    updatedAt,
    playerName: payload.player.name,
    cityName: payload.world.city.name,
    seed: payload.world.meta.seed,
    gameTimestamp: payload.timestamp
  };
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
  const normalizedPayload = { ...payload, schemaVersion: SAVE_SCHEMA_VERSION };
  const payloadJson = JSON.stringify(normalizedPayload);
  const checksum = createSaveChecksumFromJson(payloadJson);
  const encoded = await encodeSavePayloadJson(payloadJson);
  const createdAt = isRecord(existing) && typeof existing.createdAt === "string" ? existing.createdAt : now;
  const stored: EncodedSaveEnvelope = {
    slotId,
    schemaVersion: SAVE_SCHEMA_VERSION,
    createdAt,
    updatedAt: now,
    checksum,
    ...encoded,
    summary: summaryFor(slotId, now, normalizedPayload)
  };
  const transaction = database.transaction(SAVES_STORE, "readwrite");
  transaction.objectStore(SAVES_STORE).put(stored);
  await transactionDone(transaction);
  return {
    slotId,
    schemaVersion: SAVE_SCHEMA_VERSION,
    createdAt,
    updatedAt: now,
    checksum,
    payload: normalizedPayload
  };
}

async function readRawEnvelope(database: IDBDatabase, slotId: SaveSlotId): Promise<unknown> {
  const transaction = database.transaction(SAVES_STORE, "readonly");
  return requestResult(transaction.objectStore(SAVES_STORE).get(slotId));
}

export async function loadSession(database: IDBDatabase, slotId: SaveSlotId): Promise<GameSession | null> {
  const raw = await readRawEnvelope(database, slotId);
  if (!raw) return null;

  let decodedRaw = raw;
  let encodedPayloadJson: string | null = null;
  try {
    if (isEncodedEnvelope(raw)) {
      encodedPayloadJson = await decodeSavePayloadJson(raw as EncodedSavePayload);
      if (raw.checksum && createSaveChecksumFromJson(encodedPayloadJson) !== raw.checksum) {
        throw new Error("Checksum mismatch");
      }
      decodedRaw = { ...raw, payload: JSON.parse(encodedPayloadJson) };
    } else {
      const rawRecord = raw as { checksum?: unknown; payload?: unknown };
      if (typeof rawRecord.checksum === "string" && rawRecord.checksum && createSaveChecksum(rawRecord.payload) !== rawRecord.checksum) {
        throw new Error("Checksum mismatch");
      }
    }
  } catch (error) {
    await archiveRecovery(database, {
      slotId,
      capturedAt: new Date().toISOString(),
      reason: error instanceof Error ? error.message : "Save payload is unreadable",
      raw
    });
    return null;
  }

  const rawSchemaVersion = isRecord(raw) && typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
  const decodedPayload = isRecord(decodedRaw) ? decodedRaw.payload : null;
  if (rawSchemaVersion === SAVE_SCHEMA_VERSION && isCurrentGameSession(decodedPayload)) {
    if (!isEncodedEnvelope(raw)) await saveSession(database, slotId, decodedPayload);
    return decodedPayload;
  }

  const envelope = migrateEnvelope(decodedRaw, slotId);
  if (!envelope) {
    await archiveRecovery(database, {
      slotId,
      capturedAt: new Date().toISOString(),
      reason: "Save structure is invalid or from a newer schema",
      raw
    });
    return null;
  }

  await saveSession(database, slotId, envelope.payload);
  return envelope.payload;
}

export async function deleteSession(database: IDBDatabase, slotId: SaveSlotId): Promise<void> {
  const transaction = database.transaction(SAVES_STORE, "readwrite");
  transaction.objectStore(SAVES_STORE).delete(slotId);
  await transactionDone(transaction);
}

export async function listSaveSummaries(database: IDBDatabase): Promise<SaveSlotSummary[]> {
  const transaction = database.transaction(SAVES_STORE, "readonly");
  const records = await requestResult<unknown[]>(transaction.objectStore(SAVES_STORE).getAll());
  const bySlot = new Map<SaveSlotId, SaveSlotSummary>();
  for (const raw of records) {
    if (!isRecord(raw) || !SAVE_SLOT_IDS.includes(raw.slotId as SaveSlotId)) continue;
    const slotId = raw.slotId as SaveSlotId;
    if (isEncodedEnvelope(raw) && isRecord(raw.summary)) {
      bySlot.set(slotId, { ...raw.summary, slotId, exists: true } as SaveSlotSummary);
      continue;
    }
    const payload = raw.payload;
    if (!isRecord(payload)) continue;
    const player = isRecord(payload.player) ? payload.player : {};
    const world = isRecord(payload.world) ? payload.world : {};
    const city = isRecord(world.city) ? world.city : {};
    const meta = isRecord(world.meta) ? world.meta : {};
    bySlot.set(slotId, {
      slotId,
      exists: true,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
      playerName: typeof player.name === "string" ? player.name : undefined,
      cityName: typeof city.name === "string" ? city.name : undefined,
      seed: typeof meta.seed === "string" ? meta.seed : undefined,
      gameTimestamp: typeof payload.timestamp === "number" ? payload.timestamp : undefined
    });
  }
  return SAVE_SLOT_IDS.map((slotId) => bySlot.get(slotId) ?? { slotId, exists: false });
}

export async function countRecoveryRecords(database: IDBDatabase): Promise<number> {
  const transaction = database.transaction(RECOVERY_STORE, "readonly");
  return requestResult(transaction.objectStore(RECOVERY_STORE).count());
}
