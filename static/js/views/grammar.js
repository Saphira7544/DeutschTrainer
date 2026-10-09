import { post } from "../api.js";
import { db } from "../db.js";
import { checkAnswer } from "../lib/text.js";
import { addActivity } from "../store.js";
import { h, loadJSON, mount, shuffle, speakButton, spinner, toast } from "../ui.js";

const SESSION_SIZE = 10;
const BATCH = 8;

let topicsCache;
async function loadTopics() {
  topicsCache ??= await loadJSON("/data/grammar_topics.json");
  return topicsCache;
}

async function topicRecord(id) {
  return (await db.get("grammar", id)) ?? { topic_id: id, attempts: 0, correct: 0, recent: [], queue: [] };
}

export function render(root, topicId) {
  return topicId ? practice(root, topicId) : topicList(root);
}

// ---------------------------------------------------------------- topic list

async function topicList(root) {
  const { groups, topics } = await loadTopics();
  const records = Object.fromEntries((await db.all("grammar")).map((r) => [r.topic_id, r]));

  const row = (t) => {
    const r = records[t.id];
    const pct = r?.attempts ? Math.round((r.correct / r.attempts) * 100) : null;
    return h("a.topic", { href: `#/grammar/${t.id}` },
      h("div",
        h("strong", t.title),
        h("p.muted", t.summary),
      ),
      h("div.topic-score",
        pct == null ? h("span.muted", "new") : h("span", { class: pct >= 80 ? "good" : pct >= 60 ? "ok" : "weak" }, `${pct}%`),
        r?.attempts ? h("small.muted", `${r.attempts} done`) : null,
      ),
    );
  };

  mount(root,
    h("h1", "Grammar"),
    h("a.btn.primary.block", { href: "#/grammar/mixed" }, "⚡ Mixed practice (B1.2)"),
    h("p.muted.small", "Mixed practice picks more of the topics you get wrong."),
    groups.map((g) => [h("h2.group-title", g.title), h("div.topic-list", topics.filter((t) => t.group === g.id).map(row))]),
  );
}

// ---------------------------------------------------------------- fetching exercises

const inflight = new Map();

/** Make sure a topic has at least `min` cached exercises, asking the AI for more if not. */
function ensureExercises(topicId, min) {
  if (inflight.has(topicId)) return inflight.get(topicId);
  const job = (async () => {
    const rec = await topicRecord(topicId);
    if (rec.queue.length >= min) return rec;
    const recentMistakes = rec.recent.map((m) => `${m.sentence} → wrote "${m.answer}", correct: "${m.expected}"`);
    const { exercises } = await post("/api/grammar/exercises", { topic_id: topicId, count: BATCH, recent_mistakes: recentMistakes });
    const fresh = await topicRecord(topicId); // re-read: stats may have changed meanwhile
    fresh.queue.push(...exercises);
    await db.put("grammar", fresh);
    return fresh;
  })().finally(() => inflight.delete(topicId));
  inflight.set(topicId, job);
  return job;
}

async function takeExercise(topicId) {
  const rec = await topicRecord(topicId);
  const ex = rec.queue.shift();
  await db.put("grammar", rec);
  if (rec.queue.length <= 2) ensureExercises(topicId, BATCH).catch(() => {}); // prefetch quietly
  return ex;
}

/** For mixed practice: weaker and untried topics get picked more often. */
function pickTopics(topics, records, n) {
  const weighted = topics.map((t) => {
    const r = records[t.id];
    const weight = !r?.attempts ? 2.5 : 1 + (1 - r.correct / r.attempts) * 3;
    return { id: t.id, weight };
  });
  const chosen = [];
  while (chosen.length < n && weighted.length) {
    const total = weighted.reduce((s, w) => s + w.weight, 0);
    let x = Math.random() * total;
    const i = weighted.findIndex((w) => (x -= w.weight) <= 0);
    chosen.push(weighted.splice(i === -1 ? 0 : i, 1)[0].id);
  }
  return chosen;
}

// ---------------------------------------------------------------- practice session

async function practice(root, topicId) {
  const { topics } = await loadTopics();
  const byId = Object.fromEntries(topics.map((t) => [t.id, t]));
  const mixed = topicId === "mixed";
  if (!mixed && !byId[topicId]) {
    location.hash = "#/grammar";
    return;
  }

  mount(root, spinner("Preparing exercises…"));

  let plan; // topic id for each exercise in the session
  try {
    if (mixed) {
      const records = Object.fromEntries((await db.all("grammar")).map((r) => [r.topic_id, r]));
      const chosen = pickTopics(topics.filter((t) => t.group === "focus"), records, 3);
      await Promise.all(chosen.map((id) => ensureExercises(id, 4)));
      plan = shuffle(Array.from({ length: SESSION_SIZE }, (_, i) => chosen[i % chosen.length]));
    } else {
      await ensureExercises(topicId, SESSION_SIZE);
      plan = Array(SESSION_SIZE).fill(topicId);
    }
  } catch (err) {
    mount(root,
      h("a.back", { href: "#/grammar" }, "‹ Grammar"),
      h("div.card.error", h("h2", "Couldn't load exercises"), h("p", err.message), h("a.btn", { href: "#/settings" }, "Settings")),
    );
    return;
  }

  let index = 0;
  let score = 0;

  async function next() {
    if (index >= plan.length) return finish();
    let ex = await takeExercise(plan[index]);
    if (!ex) {
      mount(root, spinner("Getting more exercises…"));
      try {
        await ensureExercises(plan[index], 1);
        ex = await takeExercise(plan[index]);
      } catch (err) {
        toast(err.message, "error");
      }
    }
    if (!ex) return finish();
    showExercise(ex);
  }

  function showExercise(ex) {
    const topic = byId[ex.topic_id];
    const header = h("div.session-head",
      h("a.muted", { href: "#/grammar" }, "✕"),
      h("div.progress.slim", h("div.bar", { style: { width: `${(index / plan.length) * 100}%` } })),
      h("span.muted", `${index + 1}/${plan.length}`),
    );
    const sentence = h("p.exercise-sentence", { lang: "de" }, renderGap(ex.sentence));
    const body = h("div.card.exercise",
      h("span.badge", topic?.title ?? ex.topic_id),
      h("p.instruction", ex.instruction),
      sentence,
      ex.hint && h("p.hint", ex.hint),
    );
    const answerArea = h("div");
    body.append(answerArea);
    mount(root, header, body);

    if (ex.type === "choice") {
      mount(answerArea, h("div.choices",
        shuffle(ex.options).map((opt) => h("button.choice", { type: "button", lang: "de", onclick: (e) => submit(opt, e.currentTarget) }, opt)),
      ));
    } else {
      const input = ex.type === "transform"
        ? h("textarea.answer", { rows: 3, lang: "de", placeholder: "Write the new sentence…", spellcheck: false, autocapitalize: "sentences" })
        : h("input.answer", { lang: "de", placeholder: "Your answer…", autocomplete: "off", autocapitalize: "off", spellcheck: false, enterkeyhint: "done" });
      const form = h("form", { onsubmit: (e) => (e.preventDefault(), input.value.trim() && submit(input.value)) },
        input,
        h("button.btn.primary.block", { type: "submit" }, "Check"),
      );
      mount(answerArea, form);
      input.focus();
    }

    async function submit(answer, button) {
      for (const el of answerArea.querySelectorAll("button, input, textarea")) el.disabled = true;
      let verdict = checkAnswer(answer, ex.answers);
      let aiFeedback = null;

      if (verdict.status === "wrong" && ex.type !== "choice") {
        mount(answerArea, answerArea.firstChild, spinner("Checking your answer…"));
        try {
          aiFeedback = await post("/api/grammar/check", { exercise: ex, answer });
          if (aiFeedback.correct) verdict = { status: "correct", expected: answer };
        } catch {
          // Offline or server trouble: fall back to the reference answers.
        }
      }
      if (button) {
        button.classList.add(verdict.status === "correct" ? "right" : "wrong");
        if (verdict.status !== "correct") {
          for (const b of answerArea.querySelectorAll("button.choice")) if (ex.answers.includes(b.textContent)) b.classList.add("right");
        }
      }
      await record(ex, answer, verdict.status === "correct");
      showResult(ex, answer, verdict, aiFeedback);
    }

    function showResult(ex, answer, verdict, ai) {
      answerArea.querySelector(".loading")?.remove();
      const ok = verdict.status === "correct";
      const full = ex.type === "transform" ? ex.answers[0] : ex.sentence.replace("___", ok ? verdict.expected.trim() : ex.answers[0]);
      const overrideBtn = !ok && h("button.btn.small", {
        type: "button",
        onclick: async () => {
          await record(ex, answer, true, true);
          overrideBtn.replaceWith(h("span.muted", "Counted as correct 👍"));
        },
      }, "I was right");
      const result = h(`div.result-box.${ok ? "correct" : "wrong"}`,
        h("p.result-title", ok ? (verdict.expected === answer && ai ? "✓ Also correct!" : "✓ Richtig!") : "✗ Not quite"),
        verdict.note && h("p.muted", verdict.note),
        ai?.feedback && h("p", ai.feedback),
        !ok && ai?.corrected && ai.corrected !== answer && h("p", { lang: "de" }, h("span.muted", "Your answer, fixed: "), ai.corrected),
        h("p.full-sentence", { lang: "de" }, full, " ", speakButton(full)),
        ex.answers.length > 1 && ex.type === "transform" && h("p.muted.small", "Also possible: ", ex.answers.slice(1).join(" · ")),
        h("p.explanation", ex.explanation),
        h("div.row", overrideBtn, h("button.btn.primary", { type: "button", onclick: () => (index++, next()) }, "Next")),
      );
      answerArea.append(result);
      result.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  async function record(ex, answer, correct, override = false) {
    const rec = await topicRecord(ex.topic_id);
    if (override) {
      // Undo the mistake we just stored.
      rec.correct++;
      rec.recent = rec.recent.filter((m) => m.sentence !== ex.sentence);
      score++;
    } else {
      rec.attempts++;
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

  function finish() {
    mount(root,
      h("div.card.center.done",
        h("div.big-emoji", score >= index * 0.8 ? "🏆" : "💪"),
        h("h2", `${score} / ${index}`),
        h("p", score >= index * 0.8 ? "Super gemacht!" : "Every mistake here is one you won't make while speaking."),
        h("div.row",
          h("button.btn.primary", { type: "button", onclick: () => practice(root, topicId) }, "Again"),
          h("a.btn", { href: "#/grammar" }, "Topics"),
        ),
      ),
    );
  }

  next();
}

function renderGap(sentence) {
  const parts = String(sentence).split("___");
  return parts.flatMap((p, i) => (i ? [h("span.gap", "  "), p] : [p]));
}
