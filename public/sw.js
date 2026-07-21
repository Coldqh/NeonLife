const VERSION = "0.7.0";
const CACHE = `neon-life-v${VERSION}`;
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./version.json", "./icons/icon-192.png", "./icons/icon-512.png"];

function scopedUrl(path) {
  return new URL(path, self.registration.scope).toString();
}

async function fetchFresh(request) {
  return fetch(request, { cache: "no-store" });
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE);

  await Promise.all(CORE.map(async (path) => {
    try {
      const request = new Request(scopedUrl(path), { cache: "reload" });
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response);
    } catch {
      // Optional shell files must not cancel service-worker installation.
    }
  }));

  try {
    const indexRequest = new Request(scopedUrl("./index.html"), { cache: "reload" });
    const indexResponse = await fetch(indexRequest);
    if (!indexResponse.ok) return;

    const html = await indexResponse.clone().text();
    await cache.put(indexRequest, indexResponse);

    const assetPaths = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
      .map((match) => match[1])
      .filter((path) => path.includes("assets/"));

    await Promise.all(assetPaths.map(async (path) => {
      try {
        const request = new Request(scopedUrl(path), { cache: "reload" });
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response);
      } catch {
        // Missing optional assets do not break installation.
      }
    }));
  } catch {
    // The existing cache remains available when the network drops during installation.
  }
}

async function deleteOldCaches(includeCurrent = false) {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith("neon-life-") && (includeCurrent || key !== CACHE))
      .map((key) => caches.delete(key))
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheKeys = await caches.keys();
    const upgradingExistingInstall = cacheKeys.some((key) => key.startsWith("neon-life-") && key !== CACHE);

    await deleteOldCaches(false);
    await self.clients.claim();

    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: "NEON_LIFE_UPDATE_AVAILABLE", version: VERSION });
      if (upgradingExistingInstall && "navigate" in client) {
        await client.navigate(client.url);
      }
    }
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === "CLEAR_APP_CACHES") {
    event.waitUntil(deleteOldCaches(true));
  }
});

async function networkFirst(request, fallbackPath) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetchFresh(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (await cache.match(scopedUrl(fallbackPath)));
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type !== "opaque") await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("/version.json")) {
    event.respondWith(networkFirst(event.request, "./version.json"));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "./index.html"));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
