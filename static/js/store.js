// App-level data helpers on top of db.js: settings, XP/streak, backups.
import { db, DECK_STORES, STORES } from "./db.js";
import { computeStreak, dayKey } from "./lib/days.js";

export const DEFAULTS = {
  openaiKey: "", // stored only on this device
  openaiModel: "",
  dailyGoal: 30, // XP per day to keep the streak
  newCardsPerDay: 10,
  vocabDirection: "production", // production (EN→DE) | recognition (DE→EN) | mixed
  autoSpeak: true,
  grammarLevels: null, // levels used in mixed grammar practice; null = all
  goetheDeckLoaded: false,
  notifications: false,
  reminderTimes: null, // null = the defaults in lib/nag.js
};

// XP per activity. Speaking is worth the most because it's the hardest and most useful.
export const XP = { vocab: 1, grammar: 2, speaking: 5 };

export async function getSettings() {
  const rows = await db.all("settings");
  return { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export async function setSetting(key, value) {
  await db.put("settings", { key, value });
}

export async function today() {
  const date = dayKey();
  return (await db.get("activity", date)) ?? { date, xp: 0, vocab: 0, grammar: 0, speaking: 0, newCards: 0 };
}

/** Record one finished item (a card review, an exercise, a spoken answer). */
export async function addActivity(kind, extra = {}) {
  const day = await today();
  day.xp += XP[kind] ?? 0;
  day[kind] = (day[kind] ?? 0) + 1;
  for (const [k, v] of Object.entries(extra)) day[k] = (day[k] ?? 0) + v;
  await db.put("activity", day);
  window.dispatchEvent(new CustomEvent("xp", { detail: day }));
  return day;
}

export async function streakInfo() {
  const [days, settings] = await Promise.all([db.all("activity"), getSettings()]);
  const xpByDay = Object.fromEntries(days.map((d) => [d.date, d.xp]));
  return { ...computeStreak(xpByDay, settings.dailyGoal), goal: settings.dailyGoal, xpByDay };
}

// ---------------------------------------------------------------- backup

export async function exportBackup() {
  const data = {};
  for (const store of Object.keys(STORES)) data[store] = await db.all(store);
  // The API key never goes into a backup file.
  data.settings = data.settings.filter((s) => s.key !== "openaiKey");
  return { app: "deutsch-trainer", version: 1, exported: new Date().toISOString(), data };
}

export async function importBackup(backup) {
  if (backup?.app !== "deutsch-trainer" || !backup.data) throw new Error("This isn't a Deutsch Trainer backup file.");
  for (const store of Object.keys(STORES)) {
    const rows = backup.data[store];
    if (!Array.isArray(rows)) continue;
    if (store === "settings") {
      await db.putMany(store, rows.filter((r) => r.key !== "openaiKey"));
    } else {
      await db.clear(store);
      await db.putMany(store, rows);
    }
  }
}

export async function wipeAll() {
  for (const store of Object.keys({ ...STORES, ...DECK_STORES })) await db.clear(store);
}
