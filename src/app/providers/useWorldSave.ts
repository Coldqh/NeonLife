import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createStableEntityId } from "../../core/ids/entityId";
import {
  countRecoveryRecords,
  deleteSession,
  listSaveSummaries,
  loadSession,
  openSaveDatabase,
  readActiveSlot,
  saveSession,
  writeActiveSlot
} from "../../core/saves/indexedDb";
import {
  SAVE_SLOT_IDS,
  type SaveSlotId,
  type SaveSlotSummary,
  type SaveSystemState
} from "../../core/saves/types";
import { createWorldSession } from "../../world/generation/createWorld";
import type { GameSession } from "../../world/state/types";
import { reconcileLoadedTransitJourney } from "../../gameplay/transit/reconcileTransitJourney";

const LEGACY_SESSION_KEY = "neon-life/demo-session/v1";
const AUTOSAVE_DEBOUNCE_MS = 2_500;
const AUTOSAVE_IDLE_TIMEOUT_MS = 1_500;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

interface LegacySession {
  timestamp?: number;
  player?: Partial<GameSession["player"]> & { condition?: Partial<GameSession["player"]["condition"]> };
}

export interface WorldSaveController extends SaveSystemState {
  session: GameSession | null;
  setSession: Dispatch<SetStateAction<GameSession>>;
  saveNow: () => Promise<void>;
  switchSlot: (slotId: SaveSlotId) => Promise<void>;
  createNewWorld: (slotId?: SaveSlotId) => Promise<void>;
  deleteSlot: (slotId: SaveSlotId) => Promise<void>;
}

function createSeedForSlot(slotId: SaveSlotId): string {
  const bytes = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    bytes[0] = Date.now() >>> 0;
    bytes[1] = performance.now() >>> 0;
  }
  return `NEON-LIFE-${slotId.toUpperCase()}-${bytes[0].toString(16)}${bytes[1].toString(16)}`;
}

function readLegacySession(): LegacySession | null {
  try {
    const raw = localStorage.getItem(LEGACY_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LegacySession;
  } catch {
    return null;
  }
}

function migrateLegacySession(slotId: SaveSlotId): GameSession | null {
  const legacy = readLegacySession();
  if (!legacy) return null;
  const session = createWorldSession(createSeedForSlot(slotId));
  if (typeof legacy.timestamp === "number") {
    session.timestamp = legacy.timestamp;
    session.world.meta.currentTimestamp = legacy.timestamp;
    session.district = { ...session.district, lastProcessedBucket: Math.floor(legacy.timestamp / (30 * 60_000)) };
  }
  if (legacy.player) {
    session.player = {
      ...session.player,
      balance: typeof legacy.player.balance === "number" ? legacy.player.balance : session.player.balance,
      housingDaysLeft: typeof legacy.player.housingDaysLeft === "number" ? legacy.player.housingDaysLeft : session.player.housingDaysLeft,
      condition: {
        ...session.player.condition,
        ...(legacy.player.condition ?? {})
      }
    };
  }
  session.events.unshift({
    id: createStableEntityId("event", `${session.world.meta.seed}:legacy-migration`),
    timestamp: session.timestamp,
    category: "system",
    title: "Сохранение перенесено в новый мир NEON LIFE.",
    detail: "Сохранены механические параметры. Персонажи, организации и лор старой демонстрации удалены.",
    importance: 3,
    pinned: true
  });
  localStorage.removeItem(LEGACY_SESSION_KEY);
  return session;
}

export function useWorldSave(): WorldSaveController {
  const databaseRef = useRef<IDBDatabase | null>(null);
  const activeSlotRef = useRef<SaveSlotId>("slot-1");
  const sessionRef = useRef<GameSession | null>(null);
  const lastPersistedSessionRef = useRef<GameSession | null>(null);
  const lastQueuedSessionRef = useRef<GameSession | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [session, setSessionState] = useState<GameSession | null>(null);
  const [state, setState] = useState<SaveSystemState>({
    activeSlotId: "slot-1",
    summaries: SAVE_SLOT_IDS.map((slotId) => ({ slotId, exists: false })),
    lastSavedAt: null,
    recoveryCount: 0,
    status: "booting",
    error: null
  });

  const setSession: Dispatch<SetStateAction<GameSession>> = useCallback((next) => {
    setSessionState((current) => {
      const resolved = typeof next === "function"
        ? (next as (previous: GameSession) => GameSession)(current ?? createWorldSession(createSeedForSlot(activeSlotRef.current)))
        : next;
      sessionRef.current = resolved;
      return resolved;
    });
  }, []);

  const refreshMetadata = useCallback(async (database: IDBDatabase, savedAt?: string) => {
    const [summaries, recoveryCount] = await Promise.all([
      listSaveSummaries(database),
      countRecoveryRecords(database)
    ]);
    setState((current) => ({
      ...current,
      summaries,
      recoveryCount,
      lastSavedAt: savedAt ?? current.lastSavedAt,
      status: "ready",
      error: null
    }));
  }, []);

  const persist = useCallback((targetSession: GameSession, slotId: SaveSlotId): Promise<void> => {
    const database = databaseRef.current;
    if (!database) return Promise.resolve();
    if (lastPersistedSessionRef.current === targetSession || lastQueuedSessionRef.current === targetSession) {
      return saveQueueRef.current;
    }

    lastQueuedSessionRef.current = targetSession;
    const write = async () => {
      setState((current) => ({ ...current, status: "saving", error: null }));
      try {
        const envelope = await saveSession(database, slotId, targetSession);
        lastPersistedSessionRef.current = targetSession;
        await refreshMetadata(database, envelope.updatedAt);
      } catch (error) {
        setState((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : "Save failed"
        }));
      } finally {
        if (lastQueuedSessionRef.current === targetSession) lastQueuedSessionRef.current = null;
      }
    };

    const queued = saveQueueRef.current.then(write, write);
    saveQueueRef.current = queued;
    return queued;
  }, [refreshMetadata]);

  const saveNow = useCallback(async () => {
    if (!sessionRef.current) return;
    await persist(sessionRef.current, activeSlotRef.current);
  }, [persist]);

  const loadOrCreate = useCallback(async (database: IDBDatabase, slotId: SaveSlotId): Promise<GameSession> => {
    const loaded = await loadSession(database, slotId);
    if (loaded) {
      const reconciled = reconcileLoadedTransitJourney(loaded);
      if (reconciled !== loaded) await saveSession(database, slotId, reconciled);
      return reconciled;
    }
    const fresh = slotId === "slot-1" ? migrateLegacySession(slotId) ?? createWorldSession(createSeedForSlot(slotId)) : createWorldSession(createSeedForSlot(slotId));
    await saveSession(database, slotId, fresh);
    return fresh;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const database = await openSaveDatabase();
        if (cancelled) {
          database.close();
          return;
        }
        databaseRef.current = database;
        const activeSlotId = await readActiveSlot(database);
        const loaded = await loadOrCreate(database, activeSlotId);
        activeSlotRef.current = activeSlotId;
        sessionRef.current = loaded;
        lastPersistedSessionRef.current = loaded;
        setSessionState(loaded);
        setState((current) => ({ ...current, activeSlotId }));
        await refreshMetadata(database);
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            status: "error",
            error: error instanceof Error ? error.message : "IndexedDB boot failed"
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
      databaseRef.current?.close();
    };
  }, [loadOrCreate, refreshMetadata]);

  useEffect(() => {
    if (!session || state.status === "booting") return;
    sessionRef.current = session;

    const idleWindow = window as IdleWindow;
    let idleHandle: number | null = null;
    let fallbackHandle: number | null = null;
    const timer = window.setTimeout(() => {
      const save = () => void persist(session, activeSlotRef.current);
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(save, { timeout: AUTOSAVE_IDLE_TIMEOUT_MS });
      } else {
        fallbackHandle = window.setTimeout(save, 0);
      }
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle);
      if (fallbackHandle !== null) window.clearTimeout(fallbackHandle);
    };
  }, [persist, session, state.status]);

  const switchSlot = useCallback(async (slotId: SaveSlotId) => {
    const database = databaseRef.current;
    if (!database || slotId === activeSlotRef.current) return;
    if (sessionRef.current) await saveSession(database, activeSlotRef.current, sessionRef.current);
    setState((current) => ({ ...current, status: "booting", error: null }));
    const loaded = await loadOrCreate(database, slotId);
    await writeActiveSlot(database, slotId);
    activeSlotRef.current = slotId;
    sessionRef.current = loaded;
    lastPersistedSessionRef.current = loaded;
    setSessionState(loaded);
    setState((current) => ({ ...current, activeSlotId: slotId }));
    await refreshMetadata(database);
  }, [loadOrCreate, refreshMetadata]);

  const createNewWorld = useCallback(async (slotId = activeSlotRef.current) => {
    const database = databaseRef.current;
    if (!database) return;
    const fresh = createWorldSession(createSeedForSlot(slotId));
    await saveSession(database, slotId, fresh);
    if (slotId === activeSlotRef.current) {
      sessionRef.current = fresh;
      lastPersistedSessionRef.current = fresh;
      setSessionState(fresh);
    }
    await refreshMetadata(database, new Date().toISOString());
  }, [refreshMetadata]);

  const deleteSlot = useCallback(async (slotId: SaveSlotId) => {
    const database = databaseRef.current;
    if (!database) return;
    await deleteSession(database, slotId);
    if (slotId === activeSlotRef.current) {
      const fresh = createWorldSession(createSeedForSlot(slotId));
      await saveSession(database, slotId, fresh);
      sessionRef.current = fresh;
      lastPersistedSessionRef.current = fresh;
      setSessionState(fresh);
    }
    await refreshMetadata(database);
  }, [refreshMetadata]);

  return {
    ...state,
    session,
    setSession,
    saveNow,
    switchSlot,
    createNewWorld,
    deleteSlot
  };
}
