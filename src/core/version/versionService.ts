export interface VersionManifest {
  version: string;
  releasedAt: string;
  forceUpdate: boolean;
  title: string;
  notes: string[];
}

export const APP_VERSION = __APP_VERSION__;
export const VERSION_MANIFEST_URL = "./version.json";

function parseVersion(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => Number.isFinite(part) ? part : 0);
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }

  return 0;
}

export async function fetchVersionManifest(signal?: AbortSignal): Promise<VersionManifest> {
  const separator = VERSION_MANIFEST_URL.includes("?") ? "&" : "?";
  const response = await fetch(`${VERSION_MANIFEST_URL}${separator}check=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal
  });

  if (!response.ok) {
    throw new Error(`Version endpoint returned ${response.status}`);
  }

  const manifest = await response.json() as Partial<VersionManifest>;
  if (!manifest.version || typeof manifest.version !== "string") {
    throw new Error("Version manifest is invalid");
  }

  return {
    version: manifest.version,
    releasedAt: manifest.releasedAt ?? "",
    forceUpdate: manifest.forceUpdate !== false,
    title: manifest.title ?? `NEON LIFE ${manifest.version}`,
    notes: Array.isArray(manifest.notes) ? manifest.notes.filter((note): note is string => typeof note === "string") : []
  };
}

async function clearNeonLifeCaches(): Promise<void> {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith("neon-life-")).map((key) => caches.delete(key)));
}

function updateUrl(version: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("nl-update", version);
  url.searchParams.set("t", String(Date.now()));
  return url.toString();
}

export async function forceApplicationUpdate(version: string): Promise<void> {
  const registrations = "serviceWorker" in navigator
    ? await navigator.serviceWorker.getRegistrations()
    : [];

  await Promise.all(registrations.map(async (registration) => {
    try {
      await registration.update();
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
      registration.active?.postMessage({ type: "CLEAR_APP_CACHES" });
    } catch {
      // A cache-busted navigation still updates the application when registration.update fails.
    }
  }));

  await clearNeonLifeCaches();
  window.location.replace(updateUrl(version));
}
