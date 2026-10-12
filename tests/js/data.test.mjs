// Checks the built-in content (grammar bank, translations, rules, prompts) and the deck/AI helpers.
// Run with: node --test "tests/js/*.test.mjs"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { applyFixes, compact, parseNote } from "../../static/js/lib/goethe.js";
import * as P from "../../static/js/lib/prompts.js";

const data = (path) => JSON.parse(readFileSync(new URL(`../../static/data/${path}`, import.meta.url), "utf8"));
const { levels, topics } = data("grammar_topics.json");
const topicIds = new Set(topics.map((t) => t.id));

test("every topic has a bank in its level with at least 15 exercises", () => {
  for (const level of levels) {
    const bank = data(`grammar/${level}.json`);
    const expected = topics.filter((t) => t.level === level).map((t) => t.id).sort();
    assert.deepEqual(Object.keys(bank).sort(), expected, level);
    for (const [id, items] of Object.entries(bank)) assert.ok(items.length >= 15, id);
  }
});

test("every exercise is well formed", () => {
  for (const level of levels) {
    for (const [id, items] of Object.entries(data(`grammar/${level}.json`))) {
      items.forEach((ex, i) => {
        const where = `${id}#${i}`;
        assert.ok(["c", "g", "r"].includes(ex.t), where);
        assert.ok(ex.s.trim() && ex.e.trim(), where);
        if (ex.t === "c") {
          assert.equal(ex.s.split("___").length, 2, where);
          assert.equal(new Set(ex.o).size, 3, where);
          assert.ok(ex.o.includes(ex.a), where);
        } else {
          assert.ok(Array.isArray(ex.a) && ex.a.length && ex.a.every((a) => a.trim()), where);
        }
        if (ex.t === "g") assert.ok(ex.s.split("___").length === 2 && ex.h, where);
        if (ex.t === "r") assert.ok(ex.i && !ex.s.includes("___"), where);
      });
      const sentences = items.map((ex) => `${ex.i ?? ""}|${ex.s}`);
      assert.equal(new Set(sentences).size, sentences.length, `duplicate in ${id}`);
    }
  }
});

test("every exercise has an English and a Portuguese translation, in the same order", () => {
  for (const level of levels) {
    const bank = data(`grammar/${level}.json`);
    const tr = data(`grammar/${level}.tr.json`);
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(bank).sort(), level);
    for (const [id, items] of Object.entries(bank)) {
      assert.equal(tr[id].length, items.length, id);
      for (const [en, pt] of tr[id]) assert.ok(en.trim() && pt.trim(), id);
    }
  }
});

test("every topic has a rule with comparisons and translated examples", () => {
  const rules = data("grammar_rules.json");
  assert.deepEqual(Object.keys(rules).sort(), [...topicIds].sort());
  for (const [id, r] of Object.entries(rules)) {
    assert.ok(r.rule.length >= 3 && r.en && r.pt, id);
    assert.ok(r.examples.length >= 3 && r.examples.every((e) => e.de && e.en && e.pt), id);
  }
});

test("speaking prompts have unique ids and real target topics", () => {
  const { prompts } = data("speaking_prompts.json");
  assert.equal(new Set(prompts.map((p) => p.id)).size, prompts.length);
  for (const p of prompts) assert.ok(p.target === null || topicIds.has(p.target), p.id);
});

test("AI schemas are strict (OpenAI structured output needs every property required)", () => {
  const walk = (s) => {
    if (s.type === "object") {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(walk);
    }
    if (s.type === "array") walk(s.items);
  };
  [P.FEEDBACK_SCHEMA, P.EXERCISES_SCHEMA, P.CHECK_SCHEMA, P.PROMPT_SCHEMA, P.LOOKUP_SCHEMA].forEach(walk);
});

test("feedback prompt includes the target structure and topic list", () => {
  const user = P.feedbackUser(topics, { prompt: "Was würdest du machen?", answer: "Ich würde reise", mode: "spoken", targetTopic: "k2_present" });
  assert.match(user, /Konjunktiv II – Gegenwart/);
  assert.match(P.feedbackSystem(topics), /k2_present/);
});

test("AI-made exercises that can't be answered are dropped", () => {
  const good = { type: "gap", instruction: "Fill in.", sentence: "Ich ___ gern.", hint: "(reisen)", options: [], answers: ["würde reisen"], explanation: "…" };
  const kept = P.validExercises(
    [good, { ...good, answers: [] }, { ...good, type: "choice", options: ["a", "b"], answers: ["c"] }, { ...good, sentence: "No gap." }],
    "k2_present",
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0].topic_id, "k2_present");
});

const fixes = data("goethe_fixes.json");

test("deck cards are parsed into clean entries", () => {
  const n = compact(
    applyFixes(
      parseNote(
        "street, road<br><br>The street is very busy during rush hour.",
        '[sound:Straße.mp3]<span style="color: rgb(170, 0, 0)">Die</span> Straße (Straßen)<br><br><br>Die Straße ist sehr befahren.<br><br><br>Related: Gasse (alley)<br><br><br>Info: A common word.',
      ),
      fixes,
    ),
  );
  assert.deepEqual(n, {
    de: "die Straße",
    plural: "Straßen",
    en: "street, road",
    exampleEn: "The street is very busy during rush hour.",
    example: "Die Straße ist sehr befahren.",
    related: "Gasse (alley)",
    info: "A common word.",
    sound: "Straße.mp3",
  });
});

test("deck fixes: missing articles, verb meanings on nouns, lost words, verbose plurals", () => {
  // "der Fahrplan" carried the meaning of "fahren" in the deck.
  const fahrplan = applyFixes(parseNote("to drive, to travel<br><br>He drives.", "[sound:Fahrplan.mp3]Fahrplan<br><br>Er fährt.<br><br>Conj: er fährt"), fixes);
  assert.deepEqual(compact(fahrplan), { de: "der Fahrplan", en: "timetable, schedule", sound: "Fahrplan.mp3" });
  // The German word was lost; it's recovered from the audio file name.
  const leitung = parseNote("management, leadership", "[sound:Leitung.mp3] pipe, wire (depending on context)<br><br>The management decided.");
  assert.equal(applyFixes(leitung, fixes).de, "die Leitung");
  assert.equal(leitung.example, "");
  assert.equal(leitung.exampleEn, "The management decided.");
  const hunger = parseNote("hunger", "[sound:Hunger.mp3]Der Hunger (none (Hunger is an uncountable noun))");
  assert.equal(hunger.plural, "");
});
