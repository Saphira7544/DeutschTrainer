// Word lookup for tap-to-translate: finds the dictionary entry for an inflected word form
// ("fährt" → fahren, "Kollegen" → der Kollege, "gestohlenen" → stehlen). Pure, no DOM.
import { alternatives } from "./text.js";

const PRONOUNS_AUX = new Set(["er", "sie", "es", "man", "hat", "ist", "sich"]);
const ADJ_ENDINGS = ["e", "en", "er", "es", "em"];
const NOUN_ENDINGS = ["s", "es", "n", "en"];
const VERB_ENDINGS = ["e", "st", "t", "en", "et", "te", "test", "ten", "tet", "est"];

// Forms no rule can derive: Konjunktiv II / Präteritum stems (+ person ending), comparatives, contractions, pronouns.
const IRREGULAR_STEMS = {
  hätt: "haben", hatt: "haben", wär: "sein", war: "sein", würd: "werden", wurd: "werden",
  könnt: "können", konnt: "können", müsst: "müssen", musst: "müssen", dürft: "dürfen", durft: "dürfen",
  sollt: "sollen", wollt: "wollen", möcht: "möchten", wüsst: "wissen", wusst: "wissen",
  gäb: "geben", käm: "kommen", ging: "gehen",
};
const IRREGULAR_WORDS = {
  worden: "werden", besser: "gut", best: "gut", mehr: "viel", meist: "viel", lieber: "gern", liebst: "gern",
  am: "an", ans: "an", im: "in", ins: "in", zum: "zu", zur: "zu", vom: "von", beim: "bei", aufs: "auf",
  mir: "ich", mich: "ich", dir: "du", dich: "du", ihm: "er", ihn: "er", uns: "wir", euch: "ihr", ihnen: "sie",
};
const PERSON_ENDINGS = ["", "e", "est", "st", "en", "et", "t"];

/** Dictionary forms of an entry: "der/die Verwandte" → ["Verwandte"], "sich beschweren" → ["beschweren"]. */
function baseForms(de) {
  return alternatives(de)
    .map((f) => f.replace(/^(der|die|das)\s+/i, "").replace(/^sich\s+/, "").replace(/-$/, "").trim())
    .filter((f) => /^[A-Za-zÄÖÜäöüß-]+$/.test(f) && f.length > 1);
}

/** Conjugated forms from the deck's "er fährt ab, er ist abgefahren, er fuhr ab" notes. */
function conjForms(conj) {
  if (!conj || /^N\/A/i.test(conj)) return [];
  return conj.split(",").flatMap((part) => {
    const words = part.trim().split(/\s+/).filter((w) => !PRONOUNS_AUX.has(w.toLowerCase()));
    return words.length && /^[a-zäöüß]+$/i.test(words[0]) ? [words[0]] : [];
  });
}

/**
 * Build a lookup over word-list entries ({ de, en, plural, conj, ... }).
 * @returns {{ lookup(token: string): object[] }} best matches first (max 3)
 */
export function buildLexicon(words) {
  const index = new Map(); // lower-case form → [{ i, rank }]
  const add = (form, i, rank) => {
    const key = form.toLowerCase();
    const hits = index.get(key) ?? [];
    const existing = hits.find((h) => h.i === i);
    if (existing) existing.rank = Math.min(existing.rank, rank);
    else hits.push({ i, rank });
    index.set(key, hits);
  };

  words.forEach((w, i) => {
    const bases = baseForms(w.de);
    const isNoun = /^(der|die|das)[\s/]/i.test(w.de);
    const isVerb = bases.some((b) => b === b.toLowerCase() && (/(en|ern|eln)$/.test(b) || b === "sein" || b === "tun"));
    const conj = conjForms(w.conj);
    const forms = [...bases, ...(w.plural ? [w.plural] : []), ...conj];
    for (const f of [...bases, ...(w.plural ? [w.plural] : [])]) add(f, i, 0);
    // Some deck cards carry another word's conjugation; trust it only on verbs.
    for (const f of conj) add(f, i, isVerb ? 1 : 5);

    for (const b of bases) {
      if (isNoun) {
        for (const e of NOUN_ENDINGS) add(b + e, i, 2); // des Mannes, dem Kollegen
        if (w.plural && !/[ns]$/.test(w.plural)) add(w.plural + "n", i, 2); // den Kindern
      } else if (/(en|ern|eln)$/.test(b) && b === b.toLowerCase()) {
        const stem = b.replace(/(en|n)$/, "");
        for (const e of VERB_ENDINGS) add(stem + e, i, 2); // regular conjugation
        // Participles, also used as adjectives: gemacht(e), renoviert(en), weinend(e).
        for (const part of [`ge${stem}t`, `${stem}t`, `${b}d`]) {
          add(part, i, 2);
          for (const e of ADJ_ENDINGS) add(part + e, i, 3);
        }
      }
    }
    // Adjective endings on lower-case forms, including participles (gestohlen → gestohlenen).
    for (const f of forms) {
      if (f === f.toLowerCase() && f.length > 2) for (const e of ADJ_ENDINGS) add(f + e, i, 3);
    }
  });

  function hitsFor(key) {
    return index.get(key) ?? [];
  }

  return {
    lookup(token) {
      const key = String(token ?? "").trim().toLowerCase().replace(/[^a-zäöüß-]/g, "");
      if (!key) return [];
      let hits = hitsFor(key);
      const lemma = IRREGULAR_WORDS[key] ??
        Object.entries(IRREGULAR_STEMS).find(([stem]) => key.startsWith(stem) && PERSON_ENDINGS.includes(key.slice(stem.length)))?.[1];
      if (lemma) hits = [...hitsFor(lemma).map((h) => ({ ...h, rank: -1 })), ...hits];
      if (!hits.length && key.includes("zu")) hits = hitsFor(key.replace("zu", "")); // anzurufen → anrufen
      if (!hits.length) {
        // Comparatives and superlatives: schöner, schönsten, am größten (größer → groß needs the umlaut back).
        const suffixes = ["er", "ere", "eren", "erer", "eres", "erem", "st", "ste", "sten", "ster", "stes", "est", "este", "esten", "t", "te", "ten", "ter", "tes"];
        for (const suffix of suffixes) {
          if (key.endsWith(suffix) && key.length - suffix.length > 2) {
            const stem = key.slice(0, -suffix.length);
            // A bare -t superlative only follows s/ß/z: größt-en, heißt-e.
            if (/^te?[nrs]?$|^t$/.test(suffix) && !/[sßz]$/.test(stem)) continue;
            hits = [...hitsFor(stem), ...hitsFor(stem.replace(/ä(?=[^ä]*$)/, "a").replace(/ö(?=[^ö]*$)/, "o").replace(/ü(?=[^ü]*$)/, "u"))];
            if (hits.length) break;
          }
        }
      }
      // Best match first; on ties prefer single words and shorter entries (fahren before abfahren).
      const size = (h) => (words[h.i].de.includes(" ") && !/^(der|die|das)[ /]/i.test(words[h.i].de) ? 100 : 0) + words[h.i].de.length;
      const seen = new Set();
      return [...hits]
        .sort((a, b) => a.rank - b.rank || size(a) - size(b))
        .filter((h) => !seen.has(h.i) && seen.add(h.i))
        .slice(0, 3)
        .map((h) => words[h.i]);
    },
  };
}

/** Split text into words (tappable) and everything in between. */
export function tokenize(text) {
  return String(text ?? "")
    .split(/([A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*)/)
    .filter((p) => p !== "")
    .map((p) => ({ text: p, word: /^[A-Za-zÄÖÜäöüß]/.test(p) }));
}
