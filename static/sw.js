// Service worker (a module): lets the app open offline, and nags you when you haven't practised.
// Network first (so updates show up right away), falling back to the cached copy.
// All paths are relative to this file, so the app works wherever it's hosted (e.g. github.io/DeutschTrainer/).
import { computeStreak, dayKey } from "./js/lib/days.js";
import { nagFor } from "./js/lib/nag.js";

// Bump the version when the file list changes. Vendor libraries for the deck import are cached when first used.
const CACHE = "deutsch-trainer-v6";

const SHELL = [
  "./",
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/ai.js",
  "js/db.js",
  "js/store.js",
  "js/srs.js",
  "js/ui.js",
  "js/deckimport.js",
  "js/wordsheet.js",
  "js/reminders.js",
  "js/lib/text.js",
  "js/lib/days.js",
  "js/lib/anki.js",
  "js/lib/goethe.js",
  "js/lib/lexicon.js",
  "js/lib/nag.js",
  "js/lib/prompts.js",
  "js/vendor/ts-fsrs.mjs",
  "js/views/home.js",
  "js/views/vocab.js",
  "js/views/grammar.js",
  "js/views/speaking.js",
  "js/views/notebook.js",
  "js/views/settings.js",
  "data/grammar_topics.json",
  "data/grammar_rules.json",
  "data/speaking_prompts.json",
  "data/goethe_fixes.json",
  "data/grammar/A1.2.json",
  "data/grammar/A2.1.json",
  "data/grammar/A2.2.json",
  "data/grammar/B1.1.json",
  "data/grammar/B1.2.json",
  "data/grammar/A1.2.tr.json",
  "data/grammar/A2.1.tr.json",
  "data/grammar/A2.2.tr.json",
  "data/grammar/B1.1.tr.json",
  "data/grammar/B1.2.tr.json",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
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
  // Only our own files; calls to OpenAI (another origin) go straight to the network.
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((hit) => hit ?? caches.match("index.html"))),
  );
});

// ---------------------------------------------------------------- reminders

/** Read a whole object store from the app's IndexedDB (same database the app uses). */
function readAll(store) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("deutsch-trainer");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(store)) return resolve([]);
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

function saveSetting(key, value) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("deutsch-trainer");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("settings", "readwrite");
      tx.objectStore("settings").put({ key, value });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
  });
}

/** Called when Chrome wakes the app in the background: nag only if today's goal isn't reached. */
async function maybeNag() {
  const [settingRows, days] = await Promise.all([readAll("settings"), readAll("activity")]);
  const settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));
  if (!settings.notifications) return;
  const goal = settings.dailyGoal ?? 30;
  const xpByDay = Object.fromEntries(days.map((d) => [d.date, d.xp]));
  const nag = nagFor({
    times: settings.reminderTimes ?? undefined,
    xpToday: xpByDay[dayKey()] ?? 0,
    goal,
    streak: computeStreak(xpByDay, goal).streak,
    lastSlotKey: settings.lastNagSlot ?? null,
  });
  if (!nag) return;
  await saveSetting("lastNagSlot", nag.slotKey);
  await self.registration.showNotification(nag.title, {
    body: nag.body,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "nag",
    data: { url: new URL("./#/", self.registration.scope).href },
  });
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "nag") event.waitUntil(maybeNag());
});

// Tapping a notification opens the app (or focuses it if it's already open).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => w.url.startsWith(self.registration.scope));
      return win ? win.focus() : self.clients.openWindow(event.notification.data?.url ?? self.registration.scope);
    }),
  );
});
