const CACHE = "neon-life-v0.1.0";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

async function precacheAppShell() {
  const cache = await caches.open(CACHE);
  await cache.addAll(CORE);

  const indexResponse = await fetch("./index.html", { cache: "no-store" });
  const html = await indexResponse.clone().text();
  await cache.put("./index.html", indexResponse);

  const assetPaths = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
    .map((match) => match[1])
    .filter((path) => path.startsWith("./assets/"));

  await Promise.all(assetPaths.map(async (path) => {
    try {
      await cache.add(path);
    } catch {
      // A missing optional asset must not break service-worker installation.
    }
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === "opaque") {
            return response;
          }
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
