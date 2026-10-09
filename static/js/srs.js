// Vocab cards + spaced repetition (FSRS, the algorithm modern Anki uses).
import { createEmptyCard, fsrs, Rating, State } from "./vendor/ts-fsrs.mjs";
import { db } from "./db.js";
import { mainForm } from "./lib/text.js";

export { Rating, State };

const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: true });

/** Dates turn into strings in JSON backups; turn them back. */
function revive(f) {
  return { ...f, due: new Date(f.due), last_review: f.last_review ? new Date(f.last_review) : undefined };
}

export function newCard({ de, en, example = "", source = "manual", tags = [] }) {
  return {
    id: crypto.randomUUID(),
    de: de.trim(),
    en: en.trim(),
    example: example.trim(),
    source,
    tags,
    created: new Date().toISOString(),
    order: Math.random(), // new words are introduced in random order, not alphabetically
    suspended: false,
    fsrs: createEmptyCard(new Date()),
  };
}

export async function allCards() {
  return (await db.all("cards")).map((c) => ({ ...c, fsrs: revive(c.fsrs) }));
}

/** Add cards, skipping German words that already exist. Returns how many were added. */
export async function addCards(entries) {
  const existing = new Set((await db.all("cards")).map((c) => mainForm(c.de).toLowerCase()));
  const fresh = [];
  for (const e of entries) {
    const key = mainForm(e.de).toLowerCase();
    if (!key || !e.en?.trim() || existing.has(key)) continue;
    existing.add(key);
    fresh.push(newCard(e));
  }
  await db.putMany("cards", fresh);
  return fresh.length;
}

/** Interval labels for each grade button, e.g. { 1: "1m", 3: "3d" }. */
export function previews(card, now = new Date()) {
  const result = scheduler.repeat(card.fsrs, now);
  const out = {};
  for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) out[r] = formatInterval(result[r].card.due - now);
  return out;
}

export async function grade(card, rating, now = new Date()) {
  const { card: next } = scheduler.next(card.fsrs, now, rating);
  const updated = { ...card, fsrs: next };
  await db.put("cards", updated);
  return updated;
}

function formatInterval(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)}m`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo` : `${(days / 365).toFixed(1)}y`;
}

/**
 * Today's queue: due reviews first (most overdue first), then new cards up to the daily limit.
 */
export function buildQueue(cards, newAllowed, now = new Date()) {
  const active = cards.filter((c) => !c.suspended);
  const due = active
    .filter((c) => c.fsrs.state !== State.New && c.fsrs.due <= now)
    .sort((a, b) => a.fsrs.due - b.fsrs.due);
  const fresh = active
    .filter((c) => c.fsrs.state === State.New)
    .sort((a, b) => a.order - b.order)
    .slice(0, Math.max(0, newAllowed));
  return { due, fresh };
}
