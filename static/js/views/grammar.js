// Grammar practice. Exercises come from the built-in bank (static/data/grammar/<level>.json);
// the AI is only used when you ask for it (new exercises, or a second opinion on your answer).
import { checkAnswer as aiCheck, makeExercises } from "../ai.js";
import { db } from "../db.js";
import { checkAnswer } from "../lib/text.js";
import { addActivity, getSettings, setSetting } from "../store.js";
import { h, loadJSON, mount, openSheet, shuffle, speakButton, spinner, toast } from "../ui.js";
import { tappable } from "../wordsheet.js";

const SESSION_SIZE = 10;
const DEFAULT_INSTRUCTION = { choice: "Choose the right answer.", gap: "Fill in the gap." };

// ---------------------------------------------------------------- data

let topicsCache;
async function loadTopics() {
  topicsCache ??= await loadJSON("data/grammar_topics.json");
  return topicsCache;
}

const bankCache = {};
/** Exercises of one level, keyed by topic, in the app's format. */
async function loadBank(level) {
  bankCache[level] ??= Promise.all([
    loadJSON(`data/grammar/${level}.json`),
    loadJSON(`data/grammar/${level}.tr.json`).catch(() => ({})), // English + Portuguese of each answer
  ]).then(([raw, translations]) =>
    Object.fromEntries(
      Object.entries(raw).map(([topicId, items]) => [
        topicId,
        items.map((ex, i) => ({
          en: translations[topicId]?.[i]?.[0] ?? null,
          pt: translations[topicId]?.[i]?.[1] ?? null,
          id: `${topicId}#${i}`,
          topic_id: topicId,
          type: { c: "choice", g: "gap", r: "transform" }[ex.t],
          instruction: ex.i ?? DEFAULT_INSTRUCTION[{ c: "choice", g: "gap" }[ex.t]],
          sentence: ex.s,
          hint: ex.h ?? null,
          options: ex.o ?? [],
          answers: ex.t === "c" ? [ex.a] : ex.a,
          explanation: ex.e,
        })),
      ]),
    ),
  );
  return bankCache[level];
}

let rulesCache;
function loadRules() {
  rulesCache ??= loadJSON("data/grammar_rules.json");
  return rulesCache;
}

/** The grammar rule of a topic, with English and Portuguese comparisons and translated examples. */
async function showRule(topic) {
  const body = h("div.sheet-body", spinner());
  openSheet(`📖 ${topic.level}`, body, `Rule: ${topic.title}`);
  const rule = (await loadRules())[topic.id];
  if (!rule) return mount(body, h("p.muted", "No explanation for this topic yet."));
  mount(body,
    h("h2", topic.title),
    h("p.muted", topic.summary),
    h("h4", "The rule"),
    h("ul.rule-list", rule.rule.map((r) => h("li", r))),
    h("h4", "🇬🇧 Compared with English"),
    h("p", rule.en),
    h("h4", "🇵🇹 Comparado com o português"),
    h("p", rule.pt),
    h("h4", "Examples"),
    rule.examples.map((ex) =>
      h("div.rule-example",
        h("p.de", { lang: "de" }, tappable(ex.de), " ", speakButton(ex.de)),
        translations(ex),
      ),
    ),
  );
}

function translations(ex) {
  if (!ex.en && !ex.pt) return null;
  return h("div.translations",
    ex.en && h("p", { lang: "en" }, h("span.flag", "🇬🇧"), ex.en),
    ex.pt && h("p", { lang: "pt-PT" }, h("span.flag", "🇵🇹"), ex.pt),
  );
}

async function topicRecord(id) {
  const rec = (await db.get("grammar", id)) ?? { topic_id: id, attempts: 0, correct: 0, recent: [], queue: [] };
  rec.seen ??= {};
  return rec;
}

/** All exercises for a topic: the built-in ones plus any the AI made for you. */
async function exercisesFor(topic) {
  const [bank, rec] = await Promise.all([loadBank(topic.level), topicRecord(topic.id)]);
  const ai = rec.queue.map((ex, i) => ({ ...ex, id: ex.id ?? `${topic.id}#ai${i}`, ai: true }));
  return { pool: [...(bank[topic.id] ?? []), ...ai], rec };
}

/** Unseen first, then ones you got wrong last time, then the least practised. */
function pickFrom(pool, seen, n) {
  const priority = (ex) => {
    const s = seen[ex.id];
    if (!s) return 0;
    if (s.wrong) return 1;
    return 2 + s.n;
  };
  return shuffle(pool)
    .sort((a, b) => priority(a) - priority(b))
    .slice(0, n);
}

/** For mixed practice: weaker and untried topics get picked more often. */
function pickTopics(topics, records, n) {
  const weighted = topics.map((t) => {
    const r = records[t.id];
    return { t, weight: !r?.attempts ? 2.5 : 1 + (1 - r.correct / r.attempts) * 3 };
  });
  const chosen = [];
  while (chosen.length < n && weighted.length) {
    const total = weighted.reduce((s, w) => s + w.weight, 0);
    let x = Math.random() * total;
    const i = weighted.findIndex((w) => (x -= w.weight) <= 0);
    chosen.push(weighted.splice(i === -1 ? 0 : i, 1)[0].t);
  }
  return chosen;
}

export function render(root, topicId) {
  return topicId ? practice(root, topicId) : topicList(root);
}

// ---------------------------------------------------------------- topic list

async function topicList(root) {
  const [{ levels, topics }, settings, recordRows] = await Promise.all([loadTopics(), getSettings(), db.all("grammar")]);
  const records = Object.fromEntries(recordRows.map((r) => [r.topic_id, r]));
  const banks = Object.fromEntries(await Promise.all(levels.map(async (l) => [l, await loadBank(l)])));
  let mixLevels = settings.grammarLevels ?? levels;

  const chips = h("div.chips");
  function drawChips() {
    mount(chips, levels.map((l) =>
      h("button.chip", {
        type: "button",
        class: mixLevels.includes(l) ? "on" : null,
        onclick: async () => {
          mixLevels = mixLevels.includes(l) ? mixLevels.filter((x) => x !== l) : [...mixLevels, l];
          if (!mixLevels.length) mixLevels = [l];
          await setSetting("grammarLevels", mixLevels);
          drawChips();
        },
      }, l),
    ));
  }
  drawChips();

  const row = (t) => {
    const r = records[t.id];
    const total = (banks[t.level][t.id]?.length ?? 0) + (r?.queue?.length ?? 0);
    const seen = Object.keys(r?.seen ?? {}).length;
    const pct = r?.attempts ? Math.round((r.correct / r.attempts) * 100) : null;
    return h("a.topic", { href: `#/grammar/${t.id}` },
      h("div",
        h("strong", t.title, " ", h("button.icon-btn.rule-btn", {
          type: "button",
          title: "Read the rule",
          "aria-label": `Read the rule: ${t.title}`,
          onclick: (e) => (e.preventDefault(), e.stopPropagation(), showRule(t)),
        }, "📖")),
        h("p.muted", t.summary),
        h("div.progress.thin", h("div.bar", { style: { width: `${Math.min(100, (seen / Math.max(1, total)) * 100)}%` } })),
      ),
      h("div.topic-score",
        pct == null ? h("span.muted", "new") : h("span", { class: pct >= 80 ? "good" : pct >= 60 ? "ok" : "weak" }, `${pct}%`),
        h("small.muted", `${seen}/${total}`),
      ),
    );
  };

  mount(root,
    h("h1", "Grammar"),
    h("div.card",
      h("p.muted.small", "Mixed practice from these levels – weaker topics come up more often:"),
      chips,
      h("a.btn.primary.block", { href: "#/grammar/mixed" }, "⚡ Mixed practice"),
    ),
    levels.map((l) => [h("h2.group-title", l), h("div.topic-list", topics.filter((t) => t.level === l).map(row))]),
  );
}

// ---------------------------------------------------------------- practice session

async function practice(root, topicId) {
  const [{ levels, topics }, settings] = await Promise.all([loadTopics(), getSettings()]);
  const byId = Object.fromEntries(topics.map((t) => [t.id, t]));
  const mixed = topicId === "mixed";
  if (!mixed && !byId[topicId]) {
    location.hash = "#/grammar";
    return;
  }

  mount(root, spinner("Preparing exercises…"));

  let plan;
  if (mixed) {
    const mixLevels = settings.grammarLevels ?? levels;
    const records = Object.fromEntries((await db.all("grammar")).map((r) => [r.topic_id, r]));
    const chosen = pickTopics(topics.filter((t) => mixLevels.includes(t.level)), records, 4);
    const per = Math.ceil(SESSION_SIZE / chosen.length);
    const picks = await Promise.all(chosen.map(async (t) => {
      const { pool, rec } = await exercisesFor(t);
      return pickFrom(pool, rec.seen, per);
    }));
    plan = shuffle(picks.flat()).slice(0, SESSION_SIZE);
  } else {
    const { pool, rec } = await exercisesFor(byId[topicId]);
    plan = pickFrom(pool, rec.seen, SESSION_SIZE);
  }

  let index = 0;
  let score = 0;

  function next() {
    if (index >= plan.length) return finish();
    showExercise(plan[index]);
  }

  function showExercise(ex) {
    const topic = byId[ex.topic_id];
    const header = h("div.session-head",
      h("a.muted", { href: "#/grammar" }, "✕"),
      h("div.progress.slim", h("div.bar", { style: { width: `${(index / plan.length) * 100}%` } })),
      h("span.muted", `${index + 1}/${plan.length}`),
    );
    const body = h("div.card.exercise",
      h("div.exercise-head",
        h("span.badge", `${topic?.level ?? ""} · ${topic?.title ?? ex.topic_id}`),
        ex.ai && h("span.badge.new", "✨ AI"),
        topic && h("button.btn.small.rule-open", { type: "button", onclick: () => showRule(topic) }, "📖 Rule"),
      ),
      h("p.instruction", ex.instruction),
      h("p.exercise-sentence", { lang: "de" }, ex.type === "transform" ? tappable(ex.sentence) : renderGap(ex.sentence)),
      ex.hint && h("p.hint", ex.hint),
    );
    const answerArea = h("div");
    body.append(answerArea, h("p.tap-hint", "Tap any word to see what it means"));
    mount(root, header, body);

    if (ex.type === "choice") {
      mount(answerArea, h("div.choices",
        shuffle(ex.options).map((opt) => h("button.choice", { type: "button", lang: "de", onclick: (e) => submit(opt, e.currentTarget) }, opt)),
      ));
    } else {
      const input = ex.type === "transform"
        ? h("textarea.answer", { rows: 3, lang: "de", placeholder: "Write the sentence…", spellcheck: false, autocapitalize: "sentences" })
        : h("input.answer", { lang: "de", placeholder: "Your answer…", autocomplete: "off", autocapitalize: "off", spellcheck: false, enterkeyhint: "done" });
      mount(answerArea,
        h("form", { onsubmit: (e) => (e.preventDefault(), input.value.trim() && submit(input.value)) },
          input,
          h("button.btn.primary.block", { type: "submit" }, "Check"),
        ),
      );
      input.focus();
    }

    async function submit(answer, button) {
      for (const el of answerArea.querySelectorAll("button, input, textarea")) el.disabled = true;
      const verdict = checkAnswer(answer, ex.answers);
      const ok = verdict.status === "correct";
      if (button) {
        button.classList.add(ok ? "right" : "wrong");
        if (!ok) for (const b of answerArea.querySelectorAll("button.choice")) if (ex.answers.includes(b.textContent)) b.classList.add("right");
      }
      await record(ex, answer, ok);
      showResult(answer, verdict);
    }

    function showResult(answer, verdict) {
      const ok = verdict.status === "correct";
      const full = ex.type === "transform" ? ex.answers[0] : ex.sentence.replace("___", ok ? verdict.expected : ex.answers[0]);
      const extra = h("div");

      const overrideBtn = !ok && h("button.btn.small", {
        type: "button",
        onclick: async () => {
          await record(ex, answer, true, true);
          extra.replaceChildren(h("p.muted.small", "Counted as correct 👍"));
        },
      }, "I was right");

      // Typed answers can be right in a way the answer key doesn't list. Asking costs a fraction of a cent, so it's your call.
      const askBtn = !ok && ex.type !== "choice" && h("button.btn.small", {
        type: "button",
        onclick: async () => {
          extra.replaceChildren(spinner("Asking the AI…"));
          try {
            const ai = await aiCheck(ex, answer);
            extra.replaceChildren(
              h("p", h("strong", ai.correct ? "✓ The AI says yours is also correct. " : "✗ "), ai.feedback),
              !ai.correct && ai.corrected && ai.corrected !== answer && h("p", { lang: "de" }, h("span.muted", "Your answer, fixed: "), ai.corrected),
            );
            if (ai.correct) await record(ex, answer, true, true);
          } catch (err) {
            extra.replaceChildren(h("p.muted.small", err.message));
          }
        },
      }, "🤖 Is mine right too?");

      const result = h(`div.result-box.${ok ? "correct" : "wrong"}`,
        h("p.result-title", ok ? "✓ Richtig!" : "✗ Not quite"),
        verdict.note && h("p.muted", verdict.note),
        !ok && h("p.muted.small", { lang: "de" }, "You wrote: ", answer),
        h("p.full-sentence", { lang: "de" }, tappable(full), " ", speakButton(full)),
        translations(ex),
        ex.answers.length > 1 && h("p.muted.small", { lang: "de" }, "Also correct: ", ex.answers.filter((a) => a !== verdict.expected).join(" · ")),
        h("p.explanation", ex.explanation, " ", topic && h("button.link.small", { type: "button", onclick: () => showRule(topic) }, "📖 See the rule")),
        extra,
        h("div.row", overrideBtn, askBtn, h("button.btn.primary", { type: "button", onclick: () => (index++, next()) }, "Next")),
      );
      answerArea.append(result);
      result.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  async function record(ex, answer, correct, override = false) {
    const rec = await topicRecord(ex.topic_id);
    const prev = rec.seen[ex.id] ?? { n: 0 };
    if (override) {
      // Undo the mistake we just stored.
      rec.correct++;
      rec.recent = rec.recent.filter((m) => m.sentence !== ex.sentence);
      rec.seen[ex.id] = { ...prev, wrong: false };
      score++;
    } else {
      rec.attempts++;
      rec.seen[ex.id] = { n: prev.n + 1, wrong: !correct, last: Date.now() };
      if (correct) {
        rec.correct++;
        score++;
      } else {
        rec.recent = [...rec.recent, { sentence: ex.sentence, answer, expected: ex.answers[0] }].slice(-5);
      }
      await addActivity("grammar");
    }
    await db.put("grammar", rec);
  }

  async function finish() {
    const done = index;
    let moreBox = null;
    if (!mixed) {
      const { pool, rec } = await exercisesFor(byId[topicId]);
      const unseen = pool.filter((ex) => !rec.seen[ex.id]).length;
      moreBox = h("div.card",
        h("p.muted.small", unseen ? `${unseen} exercises in this topic you haven't seen yet.` : "You've done every exercise in this topic. Repeats focus on the ones you got wrong."),
        h("button.btn.small", { type: "button", onclick: (e) => generateMore(e, topicId) }, "✨ Make 8 new ones with AI"),
      );
    }
    mount(root,
      h("div.card.center.done",
        h("div.big-emoji", score >= done * 0.8 ? "🏆" : "💪"),
        h("h2", `${score} / ${done}`),
        h("p", score >= done * 0.8 ? "Super gemacht!" : "Every mistake here is one you won't make while speaking."),
        h("div.row",
          h("button.btn.primary", { type: "button", onclick: () => practice(root, topicId) }, "Again"),
          h("a.btn", { href: "#/grammar" }, "Topics"),
        ),
      ),
      moreBox,
    );
  }

  async function generateMore(e, id) {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.replaceChildren(spinner("Writing exercises…"));
    try {
      const rec = await topicRecord(id);
      const recentMistakes = rec.recent.map((m) => `${m.sentence} → wrote "${m.answer}", correct: "${m.expected}"`);
      const exercises = await makeExercises(id, 8, recentMistakes);
      const fresh = await topicRecord(id);
      const stamp = Date.now();
      fresh.queue.push(...exercises.map((ex, i) => ({ ...ex, id: `${id}#ai${stamp}-${i}` })));
      await db.put("grammar", fresh);
      toast(`Added ${exercises.length} new exercises ✨`);
      practice(root, id);
    } catch (err) {
      toast(err.message, "error");
      btn.disabled = false;
      btn.textContent = "✨ Make 8 new ones with AI";
    }
  }

  if (!plan.length) {
    mount(root, h("div.card", h("p", "No exercises found for this selection."), h("a.btn", { href: "#/grammar" }, "Topics")));
    return;
  }
  next();
}

function renderGap(sentence) {
  const parts = String(sentence).split("___");
  return parts.flatMap((p, i) => (i ? [h("span.gap", "  "), tappable(p, sentence)] : [tappable(p, sentence)]));
}
