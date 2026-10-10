// Run with: node --test tests/js
import assert from "node:assert/strict";
import { test } from "node:test";

import { guessColumns, parseVocabFile } from "../../static/js/lib/anki.js";
import { computeStreak } from "../../static/js/lib/days.js";
import { checkAnswer, checkVocab, mainForm, stripMarkup, wordDiff } from "../../static/js/lib/text.js";

test("checkAnswer accepts exact and loosely-spelled answers", () => {
  assert.equal(checkAnswer("würde", ["würde"]).status, "correct");
  assert.equal(checkAnswer("  würde. ", ["würde"]).status, "correct");
  const swiss = checkAnswer("Strasse", ["Straße"]);
  assert.equal(swiss.status, "correct");
  assert.match(swiss.note, /Straße/);
  assert.equal(checkAnswer("wuerde", ["würde"]).status, "correct");
  assert.equal(checkAnswer("wurde", ["würde"]).status, "wrong");
  assert.equal(checkAnswer("", ["würde"]).status, "wrong");
});

test("mainForm strips Goethe list grammar info", () => {
  assert.equal(mainForm("der Bahnhof, -¨e"), "der Bahnhof");
  assert.equal(mainForm("abfahren, fährt ab, fuhr ab, ist abgefahren"), "abfahren");
  assert.equal(mainForm("die Ahnung (keine Ahnung haben)"), "die Ahnung");
});

test("checkVocab handles articles", () => {
  assert.equal(checkVocab("der Bahnhof", "der Bahnhof, -¨e").status, "correct");
  assert.equal(checkVocab("Der bahnhof", "der Bahnhof").status, "correct");
  assert.equal(checkVocab("Bahnhof", "der Bahnhof").status, "article");
  assert.equal(checkVocab("die Bahnhof", "der Bahnhof").status, "article");
  assert.equal(checkVocab("Bahn", "der Bahnhof").status, "wrong");
  assert.equal(checkVocab("abfahren", "abfahren, fährt ab").status, "correct");
  assert.equal(checkVocab("Mama", "die Mutter / die Mama").status, "article");
  assert.equal(checkVocab("die Verwandte", "der/die Verwandte").status, "correct");
  assert.equal(checkVocab("der Verwandte", "der/die Verwandte").status, "correct");
  assert.equal(checkVocab("das Hühnchen", "das Hähnchen/Hühnchen").status, "correct");
  assert.equal(checkVocab("die Eltern", "die Eltern (Pl.)").status, "correct");
  assert.equal(checkVocab("gerne", "gern/gerne").status, "correct");
});

test("stripMarkup removes Anki html and sounds", () => {
  assert.equal(stripMarkup("<b>der</b> Hund&nbsp;[sound:hund.mp3]"), "der Hund");
  assert.equal(stripMarkup("eins<br>zwei"), "eins zwei");
});

test("parseVocabFile reads Anki plain-text exports", () => {
  const text = '#separator:tab\n#html:true\n#columns:Deutsch\tEnglisch\nder Hund\tdog\n"die Straße, -n"\t"street, road"\n\n';
  const { columns, rows } = parseVocabFile(text);
  assert.deepEqual(columns, ["Deutsch", "Englisch"]);
  assert.deepEqual(rows, [["der Hund", "dog"], ["die Straße, -n", "street, road"]]);
});

test("parseVocabFile guesses the separator and handles quoted newlines", () => {
  const { rows } = parseVocabFile('hund;"dog\nanimal"\r\nkatze;cat');
  assert.deepEqual(rows, [["hund", "dog animal"], ["katze", "cat"]]);
});

test("guessColumns finds the German column", () => {
  const rows = [["dog", "der Hund"], ["to go", "gehen"], ["street", "die Straße"]];
  assert.deepEqual(guessColumns(rows), { de: 1, en: 0 });
});

test("streak counts consecutive goal days, today optional", () => {
  const today = new Date(2026, 9, 10);
  const xp = { "2026-10-07": 40, "2026-10-08": 30, "2026-10-09": 31 };
  assert.deepEqual(computeStreak(xp, 30, today), { streak: 3, todayDone: false });
  assert.deepEqual(computeStreak({ ...xp, "2026-10-10": 30 }, 30, today), { streak: 4, todayDone: true });
  assert.deepEqual(computeStreak({ ...xp, "2026-10-08": 10 }, 30, today), { streak: 1, todayDone: false });
  assert.deepEqual(computeStreak({}, 30, today), { streak: 0, todayDone: false });
});

test("wordDiff marks removed and added words", () => {
  const diff = wordDiff("Ich habe gestern nach Bern gegangen", "Ich bin gestern nach Bern gegangen.");
  assert.deepEqual(
    diff.map((d) => `${d.type}:${d.text}`),
    ["same:Ich", "del:habe", "add:bin", "same:gestern", "same:nach", "same:Bern", "same:gegangen."],
  );
});

import { buildLexicon, tokenize } from "../../static/js/lib/lexicon.js";

const WORDS = [
  { de: "fahren", en: "to drive", conj: "er fährt, er ist gefahren, er fuhr" },
  { de: "abfahren", en: "to depart", conj: "er fährt ab, er ist abgefahren, er fuhr ab" },
  { de: "der Fahrplan", en: "timetable" },
  { de: "der Kollege", en: "colleague", plural: "Kollegen" },
  { de: "das Kind", en: "child", plural: "Kinder" },
  { de: "stehlen", en: "to steal", conj: "er stiehlt, er hat gestohlen, er stahl" },
  { de: "renovieren", en: "to renovate" },
  { de: "haben", en: "to have", conj: "er hat, er hat gehabt, er hatte" },
  { de: "gut", en: "good" },
  { de: "groß", en: "big" },
  { de: "anrufen", en: "to call", conj: "er ruft an, er hat angerufen, er rief an" },
  { de: "allein", en: "alone", conj: "er lässt allein, er hat allein gelassen" },
  { de: "lassen", en: "to let", conj: "er lässt, er hat gelassen, er ließ" },
];

test("lexicon finds dictionary forms of inflected words", () => {
  const lex = buildLexicon(WORDS);
  const first = (t) => lex.lookup(t)[0]?.de;
  assert.equal(first("fährt"), "fahren"); // before abfahren
  assert.equal(first("Kollegen"), "der Kollege");
  assert.equal(first("Kindern"), "das Kind");
  assert.equal(first("gestohlenen"), "stehlen");
  assert.equal(first("renovierten"), "renovieren");
  assert.equal(first("hätten"), "haben");
  assert.equal(first("besser"), "gut");
  assert.equal(first("größten"), "groß");
  assert.equal(first("anzurufen"), "anrufen");
  assert.equal(first("lässt"), "lassen"); // the adverb's conjugation note ranks lower
  assert.deepEqual(lex.lookup("Xylophon"), []);
});

test("tokenize keeps punctuation separate from words", () => {
  assert.deepEqual(
    tokenize("Wenn ich ___ hätte, würde ich's tun.").filter((t) => t.word).map((t) => t.text),
    ["Wenn", "ich", "hätte", "würde", "ich", "s", "tun"],
  );
});

import { calendarLink, nagFor } from "../../static/js/lib/nag.js";

test("nagFor only nags after a reminder time, once per slot, and not when the goal is met", () => {
  const at = (h, m) => new Date(2026, 9, 10, h, m);
  const base = { times: ["08:30", "13:00", "20:30"], goal: 30, streak: 5, random: () => 0 };
  assert.equal(nagFor({ ...base, now: at(7, 0), xpToday: 0 }), null); // before the first reminder
  const morning = nagFor({ ...base, now: at(9, 0), xpToday: 0 });
  assert.equal(morning.slotKey, "2026-10-10#0");
  assert.match(morning.title + morning.body, /German|Deutsch|verbs/);
  assert.equal(nagFor({ ...base, now: at(9, 30), xpToday: 0, lastSlotKey: "2026-10-10#0" }), null); // already nagged
  const evening = nagFor({ ...base, now: at(21, 0), xpToday: 12, lastSlotKey: "2026-10-10#0" });
  assert.equal(evening.slotKey, "2026-10-10#2");
  assert.match(evening.body, /18 XP/);
  assert.equal(nagFor({ ...base, now: at(21, 0), xpToday: 30 }), null); // goal reached: peace
  assert.doesNotMatch(nagFor({ ...base, streak: 0, now: at(21, 0) }).title + nagFor({ ...base, streak: 0, now: at(21, 0) }).body, /\{|0-day streak is/);
});

test("calendarLink builds a daily repeating Google Calendar event", () => {
  const url = new URL(calendarLink({ time: "20:30", index: 2, total: 3, appUrl: "https://example.org/", timeZone: "Europe/Zurich", now: new Date(2026, 9, 10, 9, 0) }));
  assert.equal(url.hostname, "calendar.google.com");
  assert.equal(url.searchParams.get("dates"), "20261010T203000/20261010T204000");
  assert.equal(url.searchParams.get("recur"), "RRULE:FREQ=DAILY");
  assert.equal(url.searchParams.get("ctz"), "Europe/Zurich");
  assert.match(url.searchParams.get("text"), /streak/);
});
