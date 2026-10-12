// Imports the Goethe A1–B1 Anki deck (.apkg) straight from a file on the phone: words, fixes and native audio.
// An .apkg is a zip with an SQLite database (collection.anki21), a "media" index and numbered audio files.
import { db } from "./db.js";
import { applyFixes, compact, parseNote } from "./lib/goethe.js";
import { addCards, DECK_VERSION, refreshDeckCards } from "./srs.js";
import { setSetting } from "./store.js";
import { loadJSON } from "./ui.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.append(s);
  });
}

/** The imported word list (empty until the deck is imported). Used as the tap-to-translate dictionary. */
export async function deckWords() {
  return (await db.get("deck", "goethe"))?.words ?? [];
}

/**
 * @param {File} file the .apkg
 * @param {(message: string) => void} progress
 */
export async function importGoetheDeck(file, progress = () => {}) {
  progress("Opening the deck…");
  await Promise.all([loadScript("js/vendor/jszip.min.js"), loadScript("js/vendor/sql-wasm.js")]);
  const zip = await window.JSZip.loadAsync(file);
  const dbFile = zip.file("collection.anki21") ?? zip.file("collection.anki2");
  if (!dbFile) {
    throw new Error(
      zip.file("collection.anki21b")
        ? "This deck uses Anki's newer compressed format. In Anki, export it again with “Support older Anki versions” ticked."
        : "This doesn't look like an Anki deck (.apkg).",
    );
  }

  progress("Reading the cards…");
  const SQL = await window.initSqlJs({ locateFile: (name) => new URL(`js/vendor/${name}`, document.baseURI).href });
  const sqlDb = new SQL.Database(new Uint8Array(await dbFile.async("arraybuffer")));
  let rows;
  try {
    rows = sqlDb.exec("select id, flds from notes order by id")[0]?.values ?? [];
  } finally {
    sqlDb.close();
  }
  const media = JSON.parse((await zip.file("media")?.async("string")) ?? "{}"); // { "123": "Straße.mp3" }
  const memberFor = Object.fromEntries(Object.entries(media).map(([member, name]) => [name, member]));
  const fixes = await loadJSON("data/goethe_fixes.json");

  const words = [];
  const audio = [];
  for (const [noteId, flds] of rows) {
    const [front = "", back = ""] = String(flds).split("\x1f");
    const parsed = parseNote(front, back);
    if (!parsed) continue;
    const { sound, ...fields } = applyFixes(parsed, fixes);
    const entry = compact({ ...fields, id: `goethe-${noteId}` });
    const member = sound && memberFor[sound] && zip.file(memberFor[sound]);
    if (member) {
      entry.audio = `idb:goethe-${noteId}`;
      audio.push([`goethe-${noteId}`, member]);
    }
    words.push(entry);
  }
  if (!words.length) throw new Error("No cards found in this deck.");

  for (let i = 0; i < audio.length; i += 150) {
    progress(`Saving audio ${i} / ${audio.length}…`);
    const chunk = await Promise.all(
      audio.slice(i, i + 150).map(async ([id, member]) => ({ id, blob: new Blob([await member.async("arraybuffer")], { type: "audio/mpeg" }) })),
    );
    await db.putMany("audio", chunk);
  }
  await db.put("deck", { id: "goethe", words, imported: new Date().toISOString() });

  progress("Adding your words…");
  const added = await addCards(words.map(({ id, ...w }) => ({ ...w, source: "goethe" })));
  const updated = await refreshDeckCards(words); // cards from an earlier import get the corrected text
  await setSetting("goetheDeckLoaded", true);
  await setSetting("goetheDeckVersion", DECK_VERSION);
  return { words: words.length, audio: audio.length, added, updated };
}
