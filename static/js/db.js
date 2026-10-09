// Tiny promise wrapper around IndexedDB. All learning data lives on the phone.

const DB_NAME = "deutsch-trainer";
const VERSION = 1;

export const STORES = {
  cards: "id", // vocab cards with their FSRS schedule
  grammar: "topic_id", // per-topic stats, recent mistakes and cached exercises
  mistakes: "id", // fixes from speaking feedback (the "notebook")
  activity: "date", // XP and counts per day
  settings: "key",
};

let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let result;
    const req = fn(tx.objectStore(store));
    if (req) req.onsuccess = () => (result = req.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  get: (store, key) => run(store, "readonly", (s) => s.get(key)),
  all: (store) => run(store, "readonly", (s) => s.getAll()),
  put: (store, value) => run(store, "readwrite", (s) => s.put(value)),
  del: (store, key) => run(store, "readwrite", (s) => s.delete(key)),
  clear: (store) => run(store, "readwrite", (s) => s.clear()),
  putMany: (store, values) =>
    run(store, "readwrite", (s) => {
      for (const v of values) s.put(v);
    }),
};

/** Ask the browser not to evict our data when storage runs low. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Not critical; backups cover the rest.
  }
}
