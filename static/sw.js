// Service worker: lets the app open offline. Network first (so updates show up right away),
// falling back to the cached copy. API calls are never cached.
const CACHE = "deutsch-trainer-v1";

const SHELL = [
  "/",
  "/index.html",
  "/css/app.css",
  "/js/app.js",
  "/js/api.js",
  "/js/db.js",
  "/js/store.js",
  "/js/srs.js",
  "/js/ui.js",
  "/js/lib/text.js",
  "/js/lib/days.js",
  "/js/lib/anki.js",
  "/js/vendor/ts-fsrs.mjs",
  "/js/views/home.js",
  "/js/views/vocab.js",
  "/js/views/grammar.js",
  "/js/views/speaking.js",
  "/js/views/notebook.js",
  "/js/views/settings.js",
  "/data/grammar_topics.json",
  "/data/speaking_prompts.json",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((hit) => hit ?? caches.match("/index.html"))),
  );
});
