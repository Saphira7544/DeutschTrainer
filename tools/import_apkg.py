"""Convert the Goethe A1-B1 Anki deck (.apkg) into the app's built-in word list + audio.

Usage:
    .\\.venv\\Scripts\\python.exe -I tools\\import_apkg.py <deck.apkg>

Writes static/data/goethe_deck.json and static/audio/goethe/*.mp3.
The deck's cards look like:
    Front: "street, road<br><br>The street is very busy during rush hour."
    Back:  "[sound:Straße.mp3]<span ..>Die</span> Straße (Straßen)<br><br>Die Straße ist ...<br><br>
            Conj: ...<br><br>Case: ...<br><br>Related: ...<br><br>Info: ..."
"""
import html
import json
import re
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_JSON = ROOT / "static" / "data" / "goethe_deck.json"
OUT_AUDIO = ROOT / "static" / "audio" / "goethe"
ARTICLE_FIXES = Path(__file__).with_name("goethe_article_fixes.json")
NOUN_FIXES = Path(__file__).with_name("goethe_noun_fixes.json")

LABELS = ("Conj", "Case", "Related", "Info")


def clean(s: str) -> str:
    s = re.sub(r"\[sound:[^\]]*\]", "", s)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def segments(field: str) -> list[str]:
    return [c for c in (clean(p) for p in re.split(r"(?:<br\s*/?>\s*)+", field)) if c]


# Plurals the deck gets wrong or explains at length.
PLURAL_FIXES = {"die Umwelt": "", "der Abwart": "Abwarte", "das Velo": "Velos", "der Ersatz": "", "die Kriminalpolizei": ""}
NO_PLURAL = re.compile(r"none|no plural|uncountable|varies|depend|inherently|as in |rarely|applicable", re.I)


def split_parens(text: str) -> tuple[str, str]:
    """'Wort (Wörter or Worte)' -> ('Wort', 'Wörter or Worte'); copes with nested brackets."""
    i = text.find(" (")
    if i == -1:
        return text.strip(), ""
    rest = text[i + 2 :].strip()
    return text[:i].strip(), rest[:-1].strip() if rest.endswith(")") else rest


def clean_plural(p: str) -> str:
    if not p or NO_PLURAL.search(p):
        return ""
    return re.split(r" \(| or |,", p)[0].strip()


def parse_head(head: str) -> tuple[str, str]:
    """'Die Straße (Straßen)' -> ('die Straße', 'Straßen'); 'enttäuschen' -> ('enttäuschen', '')."""
    head, plural = split_parens(head)
    m = re.match(r"^(Der|Die|Das)\s+(.+)$", head)
    if m:
        head = f"{m.group(1).lower()} {m.group(2)}"
    return head, clean_plural(plural)


def letters(s: str) -> str:
    return re.sub(r"[^a-zäöüß]", "", s.lower())


def short_gloss(en: str) -> tuple[str, str]:
    """Keep the English answer short; long explanations move to a note.
    'tennis (a sport played ...)' and 'dumpling, a traditional Central European dish ...' -> 'tennis', 'dumpling'."""
    word, note = split_parens(en)
    if len(note) <= 20:
        word, note = en, ""
    m = re.match(r"^(.{3,}?), (?:a|an|the|used|referring|particularly|especially) (.+)$", word, re.I)
    if m and len(word) > 30:
        word, note = m.group(1), "; ".join(x for x in (m.group(2), note) if x)
    return word, note


# Wrong English in the deck.
EN_FIXES = {"die Rezeption": "reception (desk)", "das Hähnchen/Hühnchen": "chicken", "die S-Bahn": "suburban train"}


def parse_note(front: str, back: str) -> dict | None:
    f = segments(front)
    b = segments(back)
    if not f or not b:
        return None
    de, plural = parse_head(b[0])
    en, en_note = short_gloss(f[0])
    sound = re.search(r"\[sound:([^\]]+)\]", back)
    # A few cards lost the German word: the back starts with English. The audio file is named after the word.
    stem = sound.group(1).rsplit(".", 1)[0].replace("_", " ").strip() if sound else ""
    recovered = bool(stem) and letters(stem) not in letters(b[0])
    if recovered:
        extra = b[0]
        de, plural = stem, ""
        en_note = "; ".join(x for x in (en_note, f"also: {extra}") if x)
    note = {"de": de, "plural": plural, "en": en, "enNote": en_note, "exampleEn": " ".join(f[1:]), "example": ""}
    for seg in b[1:]:
        m = re.match(rf"^({'|'.join(LABELS)}):\s*(.*)$", seg)
        if m:
            note[m.group(1).lower()] = m.group(2)
        elif not note["example"]:
            note["example"] = seg
    if recovered:
        # The rest of these cards is shifted too: the "German" example is the English one.
        note["exampleEn"] = note["exampleEn"] or note["example"]
        note["example"] = ""
    sound = re.search(r"\[sound:([^\]]+)\]", back)
    note["sound"] = sound.group(1) if sound else None
    return note


def safe_member(name: str) -> bool:
    # Only the files an .apkg is supposed to contain: no paths, so nothing can escape the temp dir.
    return name in ("collection.anki21", "collection.anki2", "media") or name.isdigit()


def read_notes(con, tmp: Path, fixes: dict, noun_fixes: dict) -> list[dict]:
    media = json.loads((tmp / "media").read_text(encoding="utf-8"))
    by_filename = {v: k for k, v in media.items()}

    if OUT_AUDIO.exists():
        shutil.rmtree(OUT_AUDIO)
    OUT_AUDIO.mkdir(parents=True)

    words = []
    for note_id, flds in con.execute("select id, flds from notes order by id"):
        front, back = flds.split("")[:2]
        note = parse_note(front, back)
        if not note:
            continue
        note["de"] = fixes.get(note["de"], note["de"])
        if note["de"] in PLURAL_FIXES or note["de"].endswith("(Pl.)"):
            note["plural"] = PLURAL_FIXES.get(note["de"], "")
        note["en"] = EN_FIXES.get(note["de"], note["en"])
        if note["de"] in noun_fixes:
            # The deck described a verb on this noun's card: keep only the noun, its plural and audio.
            note = {"de": note["de"], "plural": note["plural"], "en": noun_fixes[note["de"]], "sound": note["sound"]}
        sound = note.pop("sound")
        if sound and sound in by_filename and (tmp / by_filename[sound]).exists():
            target = OUT_AUDIO / f"{note_id}.mp3"
            shutil.copyfile(tmp / by_filename[sound], target)
            note["audio"] = f"/audio/goethe/{target.name}"
        note["id"] = f"goethe-{note_id}"
        words.append({k: v for k, v in note.items() if v})
    return words


def main(apkg: Path) -> None:
    fixes = json.loads(ARTICLE_FIXES.read_text(encoding="utf-8")) if ARTICLE_FIXES.exists() else {}
    noun_fixes = json.loads(NOUN_FIXES.read_text(encoding="utf-8")) if NOUN_FIXES.exists() else {}
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(apkg) as z:
        tmp = Path(tmp)
        for name in z.namelist():
            if safe_member(name):
                z.extract(name, tmp)
        db = tmp / "collection.anki21"
        if not db.exists():
            db = tmp / "collection.anki2"
        con = sqlite3.connect(db)
        try:
            words = read_notes(con, tmp, fixes, noun_fixes)
        finally:
            con.close()  # before the temp folder is deleted (Windows keeps open files locked)

    OUT_JSON.write_text(json.dumps({"source": "Goethe A1-B1 Anki deck", "words": words}, ensure_ascii=False), encoding="utf-8")
    with_audio = sum(1 for w in words if "audio" in w)
    print(f"{len(words)} words, {with_audio} with audio -> {OUT_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
