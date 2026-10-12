// Turns the Goethe A1–B1 Anki deck's cards into clean word entries. Pure (no DOM), so it's unit-tested.
// The deck's cards look like:
//   Front: "street, road<br><br>The street is very busy during rush hour."
//   Back:  "[sound:Straße.mp3]<span ..>Die</span> Straße (Straßen)<br><br>Die Straße ist …<br><br>
//           Conj: …<br><br>Case: …<br><br>Related: …<br><br>Info: …"

const LABELS = ["Conj", "Case", "Related", "Info"];
const NO_PLURAL = /none|no plural|uncountable|varies|depend|inherently|as in |rarely|applicable/i;
const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") return String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return ENTITIES[code] ?? m;
  });
}

function clean(s) {
  return decodeEntities(s.replace(/\[sound:[^\]]*\]/g, "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function segments(field) {
  return field.split(/(?:<br\s*\/?>\s*)+/i).map(clean).filter(Boolean);
}

/** 'Wort (Wörter or Worte)' → ['Wort', 'Wörter or Worte']; copes with nested brackets. */
function splitParens(text) {
  const i = text.indexOf(" (");
  if (i === -1) return [text.trim(), ""];
  const rest = text.slice(i + 2).trim();
  return [text.slice(0, i).trim(), rest.endsWith(")") ? rest.slice(0, -1).trim() : rest];
}

function cleanPlural(p) {
  if (!p || NO_PLURAL.test(p)) return "";
  return p.split(/ \(| or |,/)[0].trim();
}

/** 'Die Straße (Straßen)' → ['die Straße', 'Straßen']. */
function parseHead(head) {
  let [word, plural] = splitParens(head);
  const m = /^(Der|Die|Das)\s+(.+)$/.exec(word);
  if (m) word = `${m[1].toLowerCase()} ${m[2]}`;
  return [word, cleanPlural(plural)];
}

const letters = (s) => s.toLowerCase().replace(/[^a-zäöüß]/g, "");

/** Keep the English answer short; long explanations move to a note. */
function shortGloss(en) {
  let [word, note] = splitParens(en);
  if (note.length <= 20) [word, note] = [en, ""];
  const m = /^(.{3,}?), (?:a|an|the|used|referring|particularly|especially) (.+)$/i.exec(word);
  if (m && word.length > 30) [word, note] = [m[1], [m[2], note].filter(Boolean).join("; ")];
  return [word, note];
}

/** One Anki note (front and back fields) → a word entry, or null. `sound` is the audio file name. */
export function parseNote(front, back) {
  const f = segments(front);
  const b = segments(back);
  if (!f.length || !b.length) return null;
  let [de, plural] = parseHead(b[0]);
  let [en, enNote] = shortGloss(f[0]);
  const sound = /\[sound:([^\]]+)\]/.exec(back)?.[1] ?? null;
  // A few cards lost the German word: the back starts with English. The audio file is named after the word.
  const stem = sound ? sound.replace(/\.[^.]+$/, "").replaceAll("_", " ").trim() : "";
  const recovered = Boolean(stem) && !letters(b[0]).includes(letters(stem));
  if (recovered) {
    enNote = [enNote, `also: ${b[0]}`].filter(Boolean).join("; ");
    [de, plural] = [stem, ""];
  }
  const note = { de, plural, en, enNote, exampleEn: f.slice(1).join(" "), example: "" };
  for (const seg of b.slice(1)) {
    const m = new RegExp(`^(${LABELS.join("|")}):\\s*(.*)$`).exec(seg);
    if (m) note[m[1].toLowerCase()] = m[2];
    else if (!note.example) note.example = seg;
  }
  if (recovered) {
    // The rest of these cards is shifted too: the "German" example is the English one.
    note.exampleEn ||= note.example;
    note.example = "";
  }
  note.sound = sound;
  return note;
}

/** Apply the hand-made corrections (static/data/goethe_fixes.json). */
export function applyFixes(note, fixes) {
  let n = { ...note, de: fixes.articles[note.de] ?? note.de };
  if (n.de in fixes.plurals || n.de.endsWith("(Pl.)")) n.plural = fixes.plurals[n.de] ?? "";
  n.en = fixes.en[n.de] ?? n.en;
  if (n.de in fixes.nouns) {
    // The deck described a verb on this noun's card: keep only the noun, its plural and audio.
    n = { de: n.de, plural: n.plural, en: fixes.nouns[n.de], sound: n.sound };
  }
  return n;
}

/** Drop empty fields. */
export function compact(entry) {
  return Object.fromEntries(Object.entries(entry).filter(([, v]) => v));
}
