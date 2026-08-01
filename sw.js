const CACHE_NAME = "fabroses-shell-v2";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls — this app needs live data, not stale scan results.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Only handle same-origin requests; let CDN scripts (qrcode.js, html5-qrcode) load normally.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Network-first: this app changes frequently, so every load that has a
  // connection should get the current code. The cache exists purely as a
  // fallback for when there's genuinely no connection — not as the default
  // source, which would mean updates never reach anyone who already opened
  // the app once.
  event.respondWith(
    fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request))
  );
});
