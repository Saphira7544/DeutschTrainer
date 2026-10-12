// Tap-to-translate: makes German text tappable and shows a word's meaning in a bottom sheet,
// with a button to add it to your words (it then comes first in your next review).
import { post } from "./api.js";
import { buildLexicon, tokenize } from "./lib/lexicon.js";
import { addCards, findCard, isPriority, prioritize, State } from "./srs.js";
import { germanWord, h, loadJSON, mount, speakButton, spinner } from "./ui.js";

let lexiconPromise;
/** The Goethe word list as a dictionary (offline). Empty if the deck file isn't there. */
function lexicon() {
  lexiconPromise ??= loadJSON("/data/goethe_deck.json")
    .then(({ words }) => buildLexicon(words))
    .catch(() => buildLexicon([]));
  return lexiconPromise;
}

/** Turn German text into nodes where every word opens the word sheet. */
export function tappable(text, sentence = text) {
  return tokenize(text).map((t) =>
    t.word ? h("span.w", { onclick: (e) => (e.stopPropagation(), openWord(t.text, sentence)) }, t.text) : t.text,
  );
}

let current = null;
function close() {
  current?.remove();
  current = null;
  document.removeEventListener("keydown", onKey);
}
function onKey(e) {
  if (e.key === "Escape") close();
}

export async function openWord(word, sentence) {
  close();
  const body = h("div.sheet-body", spinner("Looking it up…"));
  current = h("div.sheet-backdrop", { onclick: (e) => e.target === current && close() },
    h("div.sheet", { role: "dialog", "aria-label": `Meaning of ${word}` },
      h("div.sheet-head", h("span.muted", `“${word}”`), h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: close }, "✕")),
      body,
    ),
  );
  document.body.append(current);
  document.addEventListener("keydown", onKey);

  const entries = (await lexicon()).lookup(word);
  if (entries.length) {
    mount(body, entries.map((e) => entryBlock(e, "goethe")));
  } else {
    mount(body, notFound(word, sentence, body));
  }
}

function notFound(word, sentence, body) {
  const de = h("input", { value: word, lang: "de", autocomplete: "off", spellcheck: false, "aria-label": "German" });
  const en = h("input", { placeholder: "English meaning", autocomplete: "off", "aria-label": "English" });
  const status = h("div");
  return [
    h("p.muted", "Not in the Goethe word list."),
    h("button.btn.block", {
      type: "button",
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        mount(status, spinner("Asking the AI…"));
        try {
          const entry = await post("/api/words/lookup", { word, sentence: sentence.replace("___", "…") });
          mount(body, entryBlock(entry, "lookup"));
        } catch (err) {
          mount(status, h("p.muted.small", err.message));
          btn.disabled = false;
        }
      },
    }, "🤖 Look it up"),
    status,
    h("form.card", {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!de.value.trim() || !en.value.trim()) return;
        mount(body, entryBlock({ de: de.value.trim(), en: en.value.trim(), example: sentence.includes("___") ? "" : sentence }, "manual"));
      },
    },
      h("p.muted.small", "…or write it yourself (dictionary form, nouns with der/die/das):"),
      de, en,
      h("button.btn.small", { type: "submit" }, "Use this"),
    ),
  ];
}

function entryBlock(entry, source) {
  const status = h("div.entry-status", spinner(""));
  showStatus(entry, source, status);
  return h("div.entry",
    h("p.entry-de", { lang: "de" }, germanWord(entry.de), " ", speakButton(entry.de, entry.audio)),
    entry.plural && h("p.muted.small", { lang: "de" }, `Plural: die ${entry.plural}`),
    h("p.entry-en", entry.en),
    entry.enNote && h("p.muted.small", entry.enNote),
    entry.example && h("p.example", { lang: "de" }, entry.example, " ", speakButton(entry.example)),
    status,
  );
}

async function showStatus(entry, source, el) {
  const card = await findCard(entry.de);
  const done = (text) => mount(el, h("p.result.correct", text));
  const action = (label, fn) => h("button.btn.primary.small", { type: "button", onclick: async (e) => ((e.currentTarget.disabled = true), await fn()) }, label);

  if (!card) {
    const { id, ...fields } = entry;
    return mount(el, action("＋ Add to my words", async () => {
      await addCards([{ ...fields, source, priority: true }]);
      done("✓ Added – it comes first in your next word review.");
    }));
  }
  if (isPriority(card)) return done("✓ In your words – first in your next review.");
  if (card.suspended) {
    return mount(el, h("p.muted.small", "In your words, but paused."), action("Resume and review soon", async () => {
      await prioritize(card);
      done("✓ Back in – it comes up in your next review.");
    }));
  }
  if (card.fsrs.state === State.New) {
    return mount(el, h("p.muted.small", "In your words, not studied yet."), action("Learn it next", async () => {
      await prioritize(card);
      done("✓ It comes first in your next review.");
    }));
  }
  const due = card.fsrs.due <= new Date() ? "due now" : `next review ${card.fsrs.due.toLocaleDateString()}`;
  mount(el, h("p.muted.small", `In your words · ${due}`), action("Review it soon", async () => {
    await prioritize(card);
    done("✓ It's due now.");
  }));
}
