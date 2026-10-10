import { addDays, dayKey } from "../lib/days.js";
import { allCards, buildQueue } from "../srs.js";
import { getSettings, streakInfo, today } from "../store.js";
import { h, mount } from "../ui.js";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export async function render(root) {
  const [settings, day, { streak, todayDone, goal, xpByDay }, cards] = await Promise.all([
    getSettings(),
    today(),
    streakInfo(),
    allCards(),
  ]);
  const { due, fresh } = buildQueue(cards, settings.newCardsPerDay - day.newCards);
  const pct = Math.min(100, Math.round((day.xp / goal) * 100));

  // Monday-based strip of the current week.
  const now = new Date();
  const monday = addDays(now, -((now.getDay() + 6) % 7));
  const week = WEEKDAYS.map((label, i) => {
    const d = addDays(monday, i);
    const key = dayKey(d);
    const state = (xpByDay[key] ?? 0) >= goal ? "met" : key === dayKey(now) ? "today" : d > now ? "future" : "missed";
    return h(`div.day.${state}`, h("span", label), h("i"));
  });

  const greeting = now.getHours() < 11 ? "Guten Morgen" : now.getHours() < 18 ? "Hallo" : "Guten Abend";

  mount(
    root,
    h("section.hero",
      h("p.muted", greeting),
      h("h1", todayDone ? "Ziel erreicht! 🎉" : streak ? `${streak} Tage am Stück` : "Los geht's!"),
      h("div.progress", h("div.bar", { style: { width: `${pct}%` } })),
      h("p.muted", `${day.xp} / ${goal} XP today · 🃏 ${day.vocab} · 🧩 ${day.grammar} · 🎙️ ${day.speaking}`),
      h("div.week", week),
    ),
    h("a.tile", { href: "#/vocab/review" },
      h("span.tile-icon", "🃏"),
      h("div", h("h3", "Words"), h("p.muted", cards.length ? `${due.length} to review · ${fresh.length} new` : "Import your Anki words to start")),
    ),
    h("a.tile", { href: "#/grammar/mixed" },
      h("span.tile-icon", "🧩"),
      h("div", h("h3", "Grammar"), h("p.muted", "10 quick mixed exercises")),
    ),
    h("a.tile", { href: "#/speak" },
      h("span.tile-icon", "🎙️"),
      h("div", h("h3", "Speak"), h("p.muted", "Answer a question out loud, get friendly feedback")),
    ),
    !settings.accessToken &&
      h("a.card.notice", { href: "#/settings" }, "⚠️ Add your access token in Settings to use speaking feedback and the AI extras."),
  );
}
