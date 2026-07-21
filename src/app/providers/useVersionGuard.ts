import { useCallback, useEffect, useRef, useState } from "react";
import {
  APP_VERSION,
  compareVersions,
  fetchVersionManifest,
  forceApplicationUpdate,
  type VersionManifest
} from "../../core/version/versionService";

export type VersionGuardStatus = "checking" | "current" | "offline" | "error" | "update-required" | "updating";

export interface VersionGuardState {
  status: VersionGuardStatus;
  localVersion: string;
  remoteVersion?: string;
  manifest?: VersionManifest;
  lastCheckedAt?: number;
  error?: string;
}

export interface VersionGuardController extends VersionGuardState {
  checkNow: () => Promise<void>;
  installUpdate: () => Promise<void>;
}

const CHECK_INTERVAL_MS = 5 * 60_000;

export function useVersionGuard(): VersionGuardController {
  const [state, setState] = useState<VersionGuardState>({
    status: "checking",
    localVersion: APP_VERSION
  });
  const mountedRef = useRef(true);

  const checkNow = useCallback(async () => {
    if (!navigator.onLine) {
      setState((current) => ({ ...current, status: "offline", error: undefined }));
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);

    setState((current) => ({ ...current, status: current.status === "update-required" ? current.status : "checking", error: undefined }));

    try {
      const manifest = await fetchVersionManifest(controller.signal);
      if (!mountedRef.current) return;

      const hasNewerVersion = compareVersions(manifest.version, APP_VERSION) > 0;
      setState({
        status: hasNewerVersion ? "update-required" : "current",
        localVersion: APP_VERSION,
        remoteVersion: manifest.version,
        manifest,
        lastCheckedAt: Date.now()
      });
    } catch (error) {
      if (!mountedRef.current) return;
      setState((current) => ({
        ...current,
        status: navigator.onLine ? "error" : "offline",
        lastCheckedAt: Date.now(),
        error: error instanceof Error ? error.message : "Version check failed"
      }));
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const version = state.remoteVersion ?? state.manifest?.version;
    if (!version) {
      await checkNow();
      return;
    }

    setState((current) => ({ ...current, status: "updating", error: undefined }));
    try {
      await forceApplicationUpdate(version);
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "update-required",
        error: error instanceof Error ? error.message : "Update failed"
      }));
    }
  }, [checkNow, state.manifest?.version, state.remoteVersion]);

  useEffect(() => {
    mountedRef.current = true;
    void checkNow();

    const interval = window.setInterval(() => void checkNow(), CHECK_INTERVAL_MS);
    const onOnline = () => void checkNow();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkNow();
    };
    const onServiceWorkerMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === "NEON_LIFE_UPDATE_AVAILABLE") void checkNow();
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    navigator.serviceWorker?.addEventListener("message", onServiceWorkerMessage);

    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      navigator.serviceWorker?.removeEventListener("message", onServiceWorkerMessage);
    };
  }, [checkNow]);

  return { ...state, checkNow, installUpdate };
}
