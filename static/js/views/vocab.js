import { db } from "../db.js";
import { guessColumns, parseVocabFile } from "../lib/anki.js";
import { checkVocab, mainForm } from "../lib/text.js";
import { addCards, allCards, buildQueue, grade, previews, Rating, State } from "../srs.js";
import { addActivity, getSettings, today } from "../store.js";
import { h, loadJSON, mount, say, speakButton, toast } from "../ui.js";

const SESSION_SIZE = 20;

export function render(root, sub) {
  if (sub === "review") return review(root);
  if (sub === "import") return importPage(root);
  if (sub === "list") return listPage(root);
  return overview(root);
}

// ---------------------------------------------------------------- overview

async function overview(root) {
  const [cards, settings, day] = await Promise.all([allCards(), getSettings(), today()]);
  const { due, fresh } = buildQueue(cards, settings.newCardsPerDay - day.newCards);
  const count = (state) => cards.filter((c) => c.fsrs.state === state).length;

  const de = h("input", { placeholder: "German, e.g. der Bahnhof", lang: "de", autocomplete: "off", spellcheck: false });
  const en = h("input", { placeholder: "English, e.g. train station", autocomplete: "off" });
  const example = h("input", { placeholder: "Example sentence (optional)", lang: "de", autocomplete: "off" });
  async function add(e) {
    e.preventDefault();
    if (!de.value.trim() || !en.value.trim()) return toast("Fill in German and English.");
    const added = await addCards([{ de: de.value, en: en.value, example: example.value, source: "manual" }]);
    toast(added ? `Added “${de.value.trim()}”` : "You already have this word.");
    if (added) {
      de.value = en.value = example.value = "";
      de.focus();
    }
  }

  const hasDeck = cards.some((c) => c.source === "goethe");
  async function loadDeck(e) {
    e.target.disabled = true;
    e.target.textContent = "Loading…";
    try {
      const { words } = await loadJSON("/data/goethe_deck.json");
      const added = await addCards(words.map(({ id, ...w }) => ({ ...w, source: "goethe" })));
      toast(`Added ${added} words 🎉`);
      overview(root);
    } catch (err) {
      toast(err.message, "error");
      e.target.disabled = false;
    }
  }

  mount(
    root,
    h("h1", "Words"),
    !hasDeck &&
      h("div.card.notice",
        h("h3", "Goethe A1–B1 word list"),
        h("p.muted", "2,859 words with native audio, examples, plurals and conjugations. New words come in a few at a time (setting: new words per day)."),
        h("button.btn.primary.block", { type: "button", onclick: loadDeck }, "Add the Goethe deck"),
      ),
    h("div.stats",
      stat(due.length, "to review"),
      stat(fresh.length, "new today"),
      stat(count(State.Review), "learned"),
      stat(cards.length, "total"),
    ),
    h("a.btn.primary.block", { href: "#/vocab/review" }, due.length + fresh.length ? "Start review" : "Nothing due – practise anyway"),
    h("form.card", { onsubmit: add },
      h("h3", "Add a word"),
      de, en, example,
      h("button.btn", { type: "submit" }, "Add"),
    ),
    h("div.row",
      h("a.btn", { href: "#/vocab/import" }, "Import from Anki"),
      h("a.btn", { href: "#/vocab/list" }, "Browse words"),
    ),
  );
}

/** Conjugation, case, related words and notes, folded away so the card stays quick. */
function cardDetails(card) {
  const rows = [
    ["Forms", card.conj],
    ["Case", card.case],
    ["Related", card.related],
    ["Note", card.info],
  ].filter(([, v]) => v);
  if (!rows.length) return null;
  return h("details.more",
    h("summary", "More"),
    rows.map(([label, value]) => h("p.small", h("strong", `${label}: `), value)),
  );
}

function stat(n, label) {
  return h("div.stat", h("strong", n), h("span", label));
}

// ---------------------------------------------------------------- review session

async function review(root) {
  const [cards, settings, day] = await Promise.all([allCards(), getSettings(), today()]);
  let { due, fresh } = buildQueue(cards, settings.newCardsPerDay - day.newCards);

  // Nothing scheduled: offer the cards that are closest to being due, so a free minute is never wasted.
  let extra = false;
  if (!due.length && !fresh.length) {
    due = cards
      .filter((c) => !c.suspended && c.fsrs.state !== State.New)
      .sort((a, b) => a.fsrs.due - b.fsrs.due)
      .slice(0, 10);
    extra = true;
  }
  if (!due.length && !fresh.length) {
    mount(root, h("div.card.center", h("h2", "No words yet"), h("p", "Import your Anki deck or add words first."), h("a.btn.primary", { href: "#/vocab/import" }, "Import")));
    return;
  }

  // Mix one new card in after every two reviews.
  const queue = [];
  while (due.length || fresh.length) {
    queue.push(...due.splice(0, 2));
    if (fresh.length) queue.push(fresh.shift());
  }
  const main = queue.slice(0, SESSION_SIZE);
  const learning = []; // cards failed this session: they come back a few cards later
  let done = 0;

  function next() {
    const now = new Date();
    learning.sort((a, b) => a.fsrs.due - b.fsrs.due);
    if (learning.length && (learning[0].fsrs.due <= now || !main.length)) return learning.shift();
    return main.shift();
  }

  function show() {
    const card = next();
    if (!card) return finish();
    const direction =
      settings.vocabDirection === "mixed" ? (Math.random() < 0.5 ? "production" : "recognition") : settings.vocabDirection;
    showCard(card, direction);
  }

  function showCard(card, direction) {
    const isNew = card.fsrs.state === State.New;
    const total = done + main.length + learning.length + 1;
    const header = h("div.session-head",
      h("a.muted", { href: "#/vocab" }, "✕"),
      h("div.progress.slim", h("div.bar", { style: { width: `${(done / total) * 100}%` } })),
      h("span.muted", `${done}/${total}`),
    );
    const badges = h("div.badges",
      isNew && h("span.badge.new", "new"),
      extra && h("span.badge", "extra practice"),
      direction === "production" && /^(der|die|das) /i.test(mainForm(card.de)) && h("span.badge", "noun · der/die/das?"),
    );

    let result = null;
    const input = h("input.answer", {
      placeholder: "Type the German…",
      lang: "de",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: false,
      enterkeyhint: "done",
    });
    const front =
      direction === "production"
        ? h("div.flash-front", h("p.prompt-text", card.en), h("form", { onsubmit: (e) => (e.preventDefault(), reveal()) }, input))
        : h("div.flash-front", h("p.prompt-text", { lang: "de" }, card.de, " ", speakButton(card.de, card.audio)));
    const actions = h("div.actions",
      direction === "production" && h("button.btn.primary", { type: "button", onclick: () => reveal() }, "Check"),
      h("button.btn", { type: "button", onclick: () => reveal(true) }, direction === "production" ? "I don't know – show me" : "Show meaning"),
    );
    const box = h("div.card.flash", badges, front, actions);
    mount(root, header, box);
    if (direction === "production") input.focus();
    else if (settings.autoSpeak) say(card.de, card.audio);

    function reveal(skipped = false) {
      if (direction === "production" && !skipped) result = checkVocab(input.value, card.de);
      if (direction === "production" && skipped) result = { status: "wrong" };
      input.disabled = true;
      const suggested = !result ? null : result.status === "correct" ? Rating.Good : result.status === "article" ? Rating.Hard : Rating.Again;

      const feedback = result && h(`p.result.${result.status}`,
        result.status === "correct" ? "✓ Richtig!" : result.status === "article" ? "Almost!" : input.value ? "Not quite" : "",
        result.note && h("span.muted", " ", result.note),
      );
      const answer = h("div.flash-back",
        direction === "production"
          ? h("p.answer-text", { lang: "de" }, card.de, " ", speakButton(card.de, card.audio))
          : h("p.answer-text", card.en),
        direction === "production" && card.plural && h("p.muted", { lang: "de" }, `Plural: die ${card.plural}`),
        direction === "recognition" && card.enNote && h("p.muted.small", card.enNote),
        card.example && h("p.example", { lang: "de" }, card.example, " ", speakButton(card.example)),
        card.exampleEn && h("p.muted.small", card.exampleEn),
        cardDetails(card),
      );
      const labels = previews(card);
      const grades = h("div.grades",
        [[Rating.Again, "Again"], [Rating.Hard, "Hard"], [Rating.Good, "Good"], [Rating.Easy, "Easy"]].map(([r, label]) =>
          h(`button.grade.g${r}`, { type: "button", class: r === suggested ? "suggested" : null, onclick: () => rate(r) }, h("strong", label), h("span", labels[r])),
        ),
      );
      mount(box, badges, front, feedback, answer, grades);
      if (direction === "production" && settings.autoSpeak) say(mainForm(card.de), card.audio);
    }

    async function rate(r) {
      const updated = await grade(card, r);
      done++;
      await addActivity("vocab", isNew ? { newCards: 1 } : {});
      // Forgotten: see it again a few cards later in this session.
      if (r === Rating.Again) learning.push(updated);
      show();
    }
  }

  function finish() {
    mount(root,
      h("div.card.center.done",
        h("div.big-emoji", "🎉"),
        h("h2", "Fertig!"),
        h("p", `${done} cards reviewed. +${done} XP`),
        h("div.row",
          h("button.btn.primary", { type: "button", onclick: () => review(root) }, "Keep going"),
          h("a.btn", { href: "#/" }, "Home"),
        ),
      ),
    );
  }

  show();
}

// ---------------------------------------------------------------- import

function importPage(root) {
  let parsed = null;
  const file = h("input", { type: "file", accept: ".txt,.csv,.tsv,text/plain,text/csv" });
  const paste = h("textarea", { rows: 5, placeholder: "…or paste the exported text here" });
  const preview = h("div");

  file.addEventListener("change", async () => {
    if (file.files[0]) load(await file.files[0].text());
  });
  paste.addEventListener("input", () => paste.value.trim() && load(paste.value));

  function load(text) {
    parsed = parseVocabFile(text);
    if (!parsed.rows.length) return mount(preview, h("p.result.wrong", "No rows found in that file."));
    const width = Math.max(...parsed.rows.map((r) => r.length));
    const guess = guessColumns(parsed.rows);
    const names = Array.from({ length: width }, (_, i) => parsed.columns?.[i] || `Column ${i + 1}: ${parsed.rows[0][i]?.slice(0, 25) ?? ""}`);
    const select = (selected, allowNone) =>
      h("select", allowNone && h("option", { value: "-1" }, "(none)"), names.map((n, i) => h("option", { value: i, selected: i === selected }, n)));
    const deSel = select(guess.de);
    const enSel = select(guess.en);
    const exSel = select(-1, true);
    const table = h("div.preview");
    const drawTable = () =>
      mount(table, parsed.rows.slice(0, 5).map((r) =>
        h("div.preview-row", h("strong", r[deSel.value] ?? ""), h("span", r[enSel.value] ?? ""), exSel.value >= 0 && h("em", r[exSel.value] ?? "")),
      ));
    for (const s of [deSel, enSel, exSel]) s.addEventListener("change", drawTable);
    drawTable();

    mount(preview,
      h("div.card",
        h("h3", `${parsed.rows.length} rows found`),
        h("label", "German column", deSel),
        h("label", "English column", enSel),
        h("label", "Example sentence column", exSel),
        h("p.muted", "Preview:"),
        table,
        h("button.btn.primary.block", {
          type: "button",
          onclick: async (e) => {
            e.target.disabled = true;
            const ex = Number(exSel.value);
            const entries = parsed.rows.map((r) => ({
              de: r[deSel.value] ?? "",
              en: r[enSel.value] ?? "",
              example: ex >= 0 ? r[ex] ?? "" : "",
              source: "anki",
            }));
            const added = await addCards(entries);
            toast(`Added ${added} words${entries.length - added ? ` (${entries.length - added} duplicates or empty rows skipped)` : ""}.`);
            location.hash = "#/vocab";
          },
        }, "Import"),
      ),
    );
  }

  mount(root,
    h("a.back", { href: "#/vocab" }, "‹ Words"),
    h("h1", "Import words"),
    h("div.card",
      h("p", "In Anki on your computer: ", h("strong", "File → Export"), ", choose ", h("strong", "Notes in Plain Text (.txt)"), ", untick “include HTML”, and export your Goethe deck. Then pick the file here."),
      file,
      paste,
    ),
    preview,
  );
}

// ---------------------------------------------------------------- browse

async function listPage(root) {
  const cards = (await allCards()).sort((a, b) => mainForm(a.de).localeCompare(mainForm(b.de), "de"));
  const search = h("input", { type: "search", placeholder: `Search ${cards.length} words…`, autocomplete: "off" });
  const list = h("div.word-list");

  function draw() {
    const q = search.value.trim().toLowerCase();
    const hits = cards.filter((c) => !q || c.de.toLowerCase().includes(q) || c.en.toLowerCase().includes(q)).slice(0, 100);
    mount(list, hits.map(row), !hits.length && h("p.muted", "No matches."));
  }

  function row(card) {
    const state = card.suspended ? "paused" : card.fsrs.state === State.New ? "new" : card.fsrs.due <= new Date() ? "due" : `next ${card.fsrs.due.toLocaleDateString()}`;
    const el = h("details.word",
      h("summary", h("strong", { lang: "de" }, card.de), h("span", card.en), h("small.muted", state)),
      card.example && h("p.example", { lang: "de" }, card.example),
      cardDetails(card),
      h("div.row",
        speakButton(card.de, card.audio),
        h("button.btn.small", {
          type: "button",
          onclick: async () => {
            card.suspended = !card.suspended;
            await db.put("cards", card);
            toast(card.suspended ? "Paused – it won't be shown." : "Back in your reviews.");
            draw();
          },
        }, card.suspended ? "Resume" : "Pause"),
        h("button.btn.small.danger", {
          type: "button",
          onclick: async () => {
            if (!confirm(`Delete “${card.de}”?`)) return;
            await db.del("cards", card.id);
            cards.splice(cards.indexOf(card), 1);
            draw();
          },
        }, "Delete"),
      ),
    );
    return el;
  }

  search.addEventListener("input", draw);
  mount(root, h("a.back", { href: "#/vocab" }, "‹ Words"), h("h1", "Your words"), search, list);
  draw();
}
