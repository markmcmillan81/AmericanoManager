// Keeps the app opening instantly even on a weak signal at the courts.
// Pages and code: try the network, but if it hasn't answered within 3 seconds use the saved
// copy (and keep fetching in the background so the next open is up to date).
// Data (/api) is never cached here — the app keeps its own copy of scores.
const CACHE = "padel-app-v26";
const SHELL = ["./", "index.html", "app.js", "scheduler.js", "schedules.js", "styles.css", "history.json", "manifest.webmanifest", "icons/icon-192.png"];
const TIMEOUT_MS = 3000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const isPage = e.request.mode === "navigate";
  const network = fetch(e.request).then((res) => {
    if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(isPage ? "index.html" : e.request, copy)); }
    return res;
  });
  const cached = () => caches.match(isPage ? "index.html" : e.request).then((r) => r || caches.match(e.request));
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => cached().then(finish), TIMEOUT_MS);
    network.then((r) => { clearTimeout(timer); finish(r); })
      .catch(() => { clearTimeout(timer); cached().then((r) => finish(r || new Response("Offline", { status: 503 }))); });
  }));
  e.waitUntil(network.catch(() => {}));
});
