// Parse an Anki "Notes in Plain Text" export (or any CSV/TSV) into rows of fields.
import { stripMarkup } from "./text.js";

const SEPARATORS = { tab: "\t", comma: ",", semicolon: ";", pipe: "|", space: " ", colon: ":" };

/** Minimal CSV parser: handles quoted fields with separators, doubled quotes and newlines. */
function parseDelimited(text, sep) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * @returns {{ columns: string[] | null, rows: string[][] }}
 * Anki header lines ("#separator:tab", "#columns:Front\tBack", "#html:true") are honoured and dropped.
 */
export function parseVocabFile(text) {
  const lines = String(text ?? "").replace(/^﻿/, "").split("\n");
  const headers = {};
  let bodyStart = 0;
  while (bodyStart < lines.length && lines[bodyStart].startsWith("#")) {
    const [key, ...rest] = lines[bodyStart].slice(1).split(":");
    headers[key.trim().toLowerCase()] = rest.join(":").replace(/\r$/, "");
    bodyStart++;
  }
  const body = lines.slice(bodyStart).join("\n");

  let sep = SEPARATORS[headers.separator?.toLowerCase()] ?? headers.separator;
  if (!sep) sep = body.includes("\t") ? "\t" : body.split("\n")[0].includes(";") ? ";" : ",";

  const rows = parseDelimited(body, sep)
    .map((r) => r.map(stripMarkup))
    .filter((r) => r.some((f) => f !== ""));
  const columns = headers.columns ? headers.columns.split(sep).map((c) => c.trim()) : null;
  return { columns, rows };
}

/** Guess which columns hold German and English: German has articles / umlauts / ß more often. */
export function guessColumns(rows) {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const sample = rows.slice(0, 50);
  const score = (i) =>
    sample.filter((r) => /^(der|die|das) |[äöüß]/i.test(r[i] ?? "")).length -
    sample.filter((r) => /^(the|to|a|an) /i.test(r[i] ?? "")).length;
  const scores = Array.from({ length: width }, (_, i) => score(i));
  const de = scores.indexOf(Math.max(...scores));
  const en = de === 0 ? 1 : 0;
  return { de: Math.max(0, de), en: Math.min(en, Math.max(0, width - 1)) };
}
