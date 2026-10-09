// Answer checking and text helpers. Pure functions (no DOM) so they can be unit-tested with node.

const PUNCT = /[.,!?;:"'„“”‚‘’«»()\[\]…–—]/g;
const ARTICLES = ["der", "die", "das"];

/** Light cleanup: trim, single spaces, no trailing punctuation. Keeps case and umlauts. */
export function tidy(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim().replace(/[.!?;:,]+$/, "").trim();
}

/** Loose form for comparing: lower case, no punctuation, ß→ss, umlauts→ae/oe/ue (so "Strasse" = "Straße"). */
export function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(PUNCT, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check a typed answer against the accepted answers.
 * Returns { status: "correct" | "wrong", note?: string, expected: string }.
 * Differences only in case, ß/ss or umlaut spelling count as correct, with a note.
 */
export function checkAnswer(input, answers) {
  const typed = tidy(input);
  const expected = answers[0] ?? "";
  if (!typed) return { status: "wrong", expected };
  for (const a of answers) {
    if (tidy(a) === typed) return { status: "correct", expected: a };
  }
  for (const a of answers) {
    if (normalize(a) === normalize(typed)) {
      return { status: "correct", expected: a, note: `Watch the spelling: ${tidy(a)}` };
    }
  }
  return { status: "wrong", expected };
}

/**
 * Main German form of a vocab entry. Goethe/Anki lists often add grammar info:
 * "der Bahnhof, -¨e" -> "der Bahnhof", "abfahren, fährt ab, fuhr ab" -> "abfahren".
 */
export function mainForm(de) {
  return tidy(String(de ?? "").split(/[,;(]/)[0]);
}

/** Alternatives written as "a / b" are all accepted. */
function alternatives(de) {
  return String(de ?? "").split("/").map(mainForm).filter(Boolean);
}

/**
 * Check a typed German word against a vocab card's German side.
 * status: "correct" | "article" (right noun, wrong/missing article) | "wrong".
 */
export function checkVocab(input, de) {
  const typed = normalize(input);
  const forms = alternatives(de);
  if (!typed) return { status: "wrong", expected: forms[0] ?? "" };
  for (const form of forms) {
    const target = normalize(form);
    if (typed === target || typed === normalize(de)) {
      const note = tidy(input) !== form && tidy(input) !== tidy(de) ? `Watch the spelling: ${form}` : undefined;
      return { status: "correct", expected: form, note };
    }
    const [first, ...rest] = target.split(" ");
    if (ARTICLES.includes(first) && rest.length) {
      const noun = rest.join(" ");
      const typedWords = typed.split(" ");
      const typedNoun = ARTICLES.includes(typedWords[0]) ? typedWords.slice(1).join(" ") : typed;
      if (typedNoun === noun) {
        return { status: "article", expected: form, note: `Right word, but it's “${first}”: ${form}` };
      }
    }
  }
  return { status: "wrong", expected: forms[0] ?? "" };
}

/** Strip Anki/HTML markup: tags, [sound:..] references, common entities. */
export function stripMarkup(s) {
  const entities = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
  return String(s ?? "")
    .replace(/\[sound:[^\]]*\]/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (m) => entities[m.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Word-level diff between what the learner said and the corrected version.
 * Returns [{ type: "same" | "del" | "add", text }]. Comparison ignores case and punctuation.
 */
export function wordDiff(from, to) {
  const a = String(from ?? "").split(/\s+/).filter(Boolean);
  const b = String(to ?? "").split(/\s+/).filter(Boolean);
  const na = a.map(normalize);
  const nb = b.map(normalize);
  const n = a.length;
  const m = b.length;
  // LCS table, filled from the end.
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = na[i] === nb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (na[i] === nb[j]) {
      out.push({ type: "same", text: b[j] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) {
      out.push({ type: "del", text: a[i++] });
    } else {
      out.push({ type: "add", text: b[j++] });
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}
