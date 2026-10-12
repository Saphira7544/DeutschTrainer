"""Checks the built-in exercise bank (static/data/grammar/*.json) so a typo can't ship an unanswerable exercise."""
import json

import pytest

from app import config, prompts

BANK_DIR = config.DATA_DIR / "grammar"
LEVELS = json.loads((config.DATA_DIR / "grammar_topics.json").read_text(encoding="utf-8"))["levels"]


def load_level(level):
    return json.loads((BANK_DIR / f"{level}.json").read_text(encoding="utf-8"))


def all_exercises():
    for level in LEVELS:
        for topic_id, items in load_level(level).items():
            for i, ex in enumerate(items):
                yield level, topic_id, i, ex


def test_every_topic_has_a_bank_in_its_level():
    topics = prompts.grammar_topics()
    for level in LEVELS:
        bank = load_level(level)
        expected = {t for t, d in topics.items() if d["level"] == level}
        assert set(bank) == expected, level
        for topic_id, items in bank.items():
            assert len(items) >= 15, topic_id


@pytest.mark.parametrize("level,topic_id,i,ex", list(all_exercises()), ids=lambda v: str(v) if not isinstance(v, dict) else "")
def test_exercise_is_well_formed(level, topic_id, i, ex):
    assert ex["t"] in ("c", "g", "r")
    assert ex["s"].strip() and ex["e"].strip()
    if ex["t"] == "c":
        assert ex["s"].count("___") == 1
        assert len(ex["o"]) == 3 and len(set(ex["o"])) == 3
        assert ex["a"] in ex["o"]
    else:
        assert isinstance(ex["a"], list) and ex["a"] and all(a.strip() for a in ex["a"])
    if ex["t"] == "g":
        assert ex["s"].count("___") == 1
        assert ex.get("h")
    if ex["t"] == "r":
        assert ex.get("i")
        assert "___" not in ex["s"]


def test_no_duplicate_sentences_in_a_topic():
    for level in LEVELS:
        for topic_id, items in load_level(level).items():
            sentences = [(ex.get("i"), ex["s"]) for ex in items]
            assert len(sentences) == len(set(sentences)), topic_id


def test_every_exercise_has_english_and_portuguese_translations():
    for level in LEVELS:
        bank = load_level(level)
        translations = json.loads((BANK_DIR / f"{level}.tr.json").read_text(encoding="utf-8"))
        assert set(translations) == set(bank), level
        for topic_id, items in bank.items():
            assert len(translations[topic_id]) == len(items), topic_id
            for en, pt in translations[topic_id]:
                assert en.strip() and pt.strip(), topic_id


def test_every_topic_has_a_rule_with_translated_examples():
    rules = json.loads((config.DATA_DIR / "grammar_rules.json").read_text(encoding="utf-8"))
    assert set(rules) == set(prompts.grammar_topics())
    for topic_id, rule in rules.items():
        assert len(rule["rule"]) >= 3 and rule["en"] and rule["pt"], topic_id
        assert len(rule["examples"]) >= 3, topic_id
        for ex in rule["examples"]:
            assert ex["de"] and ex["en"] and ex["pt"], topic_id
