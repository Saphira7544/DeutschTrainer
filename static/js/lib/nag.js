// Reminder logic shared by the app and the service worker. Pure, no DOM.
import { dayKey } from "./days.js";

export const DEFAULT_TIMES = ["08:30", "13:00", "20:30"];

// Dramatic on purpose. {streak} and {left} are filled in.
const MESSAGES = {
  morning: [
    ["☕ Guten Morgen. Your German is awake.", "Are you? 10 minutes before the day eats you alive."],
    ["🌅 The verbs waited all night for you.", "Standing in position 2. Patiently. Like idiots."],
    ["🥐 Breakfast without German?", "Your {streak}-day streak just choked on its croissant."],
  ],
  midday: [
    ["🥨 Mittagspause = Deutschpause.", "Your {streak}-day streak is watching you eat that sandwich."],
    ["😢 Konjunktiv II misses you.", "Wenn du nur Zeit hättest… oh wait. You do."],
    ["🧀 The Swiss are speaking German all around you.", "And you're scrolling. {left} XP to go."],
  ],
  evening: [
    ["🔥 Your streak is on life support.", "{left} XP left. Midnight is coming. Don't let der, die, das win."],
    ["💀 This is your German speaking.", "I'm fading. Just 5 minutes. Bitte. Por favor. Please."],
    ["📉 Your German is quietly packing its bags.", "Leaving you for someone who practises. {left} XP could stop it."],
    ["🕯️ A minute of silence for your {streak}-day streak.", "Unless… you open the app right now."],
  ],
};

const NO_STREAK = {
  morning: ["☕ New day, new streak?", "Day 1 starts with one tiny session. Go on."],
  midday: ["🥨 Mittagspause = Deutschpause.", "Zero-day streak. Zero. Let's fix that."],
  evening: ["🫠 Another day without German?", "{left} XP and you're back in the game. Before midnight."],
};

function part(i, total) {
  if (total === 1 || i === total - 1) return i === 0 && total > 1 ? "morning" : "evening";
  return i === 0 ? "morning" : "midday";
}

/** Today's reminder times as Date objects, sorted. "20:30" → today 20:30. */
function todaysSlots(times, now) {
  return times
    .map((t) => /^(\d{1,2}):(\d{2})$/.exec(t))
    .filter(Boolean)
    .map(([, hh, mm]) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(hh), Number(mm)))
    .sort((a, b) => a - b);
}

/**
 * Should we nag now? Only when the daily goal isn't reached, a reminder time has passed,
 * and we haven't nagged for that time yet.
 * @returns {null | { slotKey: string, title: string, body: string }}
 */
export function nagFor({ now = new Date(), times = DEFAULT_TIMES, xpToday = 0, goal = 30, streak = 0, lastSlotKey = null, random = Math.random }) {
  if (xpToday >= goal) return null;
  const slots = todaysSlots(times, now);
  let index = -1;
  slots.forEach((s, i) => {
    if (s <= now) index = i;
  });
  if (index === -1) return null;
  const slotKey = `${dayKey(now)}#${index}`;
  if (slotKey === lastSlotKey) return null;

  const when = part(index, slots.length);
  const [title, body] = streak > 0 ? MESSAGES[when][Math.floor(random() * MESSAGES[when].length)] : NO_STREAK[when];
  const fill = (s) => s.replaceAll("{streak}", String(streak)).replaceAll("{left}", String(Math.max(0, goal - xpToday)));
  return { slotKey, title: fill(title), body: fill(body) };
}

// Calendar events can't know your progress, so they get one fixed message per time of day.
const CALENDAR_TEXT = {
  morning: ["☕ Deutsch, bevor der Tag dich frisst", "10 minutes: words + one grammar round. Your future self in a Swiss meeting will thank you."],
  midday: ["🥨 Mittagspause = Deutschpause", "Konjunktiv II misses you. Wenn du nur Zeit hättest… oh wait, you do."],
  evening: ["🔥 Your German streak is on life support", "Haven't practised today? Now's the time. Don't let der, die, das win."],
};

function stamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}

/** A Google Calendar link that creates a daily repeating 10-minute event at `time`. */
export function calendarLink({ time, index, total, appUrl, timeZone, now = new Date() }) {
  const [start] = todaysSlots([time], now);
  const end = new Date(start.getTime() + 10 * 60 * 1000);
  const [title, details] = CALENDAR_TEXT[part(index, total)];
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    details: `${details}\n\n${appUrl}`,
    dates: `${stamp(start)}/${stamp(end)}`,
    recur: "RRULE:FREQ=DAILY",
  });
  if (timeZone) params.set("ctz", timeZone);
  return `https://calendar.google.com/calendar/render?${params}`;
}
