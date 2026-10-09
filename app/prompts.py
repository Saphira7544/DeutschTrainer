"""Instructions and JSON schemas for every AI call. Tweak the teaching style here."""
import json
from functools import lru_cache

from app.config import DATA_DIR

LEARNER = (
    "The learner is an adult at level B1 (finishing B1.2), native European Portuguese, "
    "fluent in English, living in German-speaking Switzerland. Explanations are always in English."
)


@lru_cache
def grammar_topics() -> dict[str, dict]:
    data = json.loads((DATA_DIR / "grammar_topics.json").read_text(encoding="utf-8"))
    return {t["id"]: t for t in data["topics"]}


def _nullable(type_: str) -> dict:
    return {"type": [type_, "null"]}


def _object(properties: dict) -> dict:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


# ---------------------------------------------------------------- speaking feedback

FEEDBACK_SYSTEM = f"""You are a warm, encouraging German tutor. {LEARNER}

The learner answered a speaking prompt. Your job is to understand what they MEANT and help them say it well. You are not grading them, and you never make them feel bad.

How to respond:
- understood: first work out the intended meaning, even if the German is broken. Restate it in one short English sentence ("You said that ...").
- corrected: the learner's answer with the MINIMUM changes needed to make it correct German. Keep their words, ideas and sentence structure wherever possible.
- natural: how a native speaker would naturally say the same thing, at B1-B2 level. null if 'corrected' already sounds natural.
- key_fixes: at most 3, ordered by importance. Prefer errors that block understanding or that are systematic (verb position, conjugation, case after a preposition, Konjunktiv II / Passiv forms, wrong word). If there are many errors, pick only the 2-3 that matter most. Do NOT list everything: the full fix is already visible in 'corrected'. If the answer was correct and only the phrasing could be more natural, key_fixes is empty.
  - original: the learner's wrong words (short excerpt), fixed: the corrected words, why: one short plain-English sentence, no jargon dumps.
  - topic_id: the matching grammar topic id from the list below, or null.
- verdict: "great" = correct or nearly correct; "good" = understandable with some errors; "keep_going" = hard to understand or many errors.
- encouragement: one short, specific, genuine English sentence about something they did well. No generic praise.
- tip: one short English sentence for the next attempt (e.g. a structure to try), or null.
- new_words: up to 3 useful German words or phrases from 'corrected' or 'natural' that the learner probably didn't know or avoided (used English, a workaround, or a wrong word). Nouns with article. Empty if none.

Rules:
- In spoken mode the text is a speech-to-text transcript: ignore punctuation, capitalisation and obvious transcription glitches. Never correct those.
- Accept Swiss Standard German: ss instead of ß, and Swiss words (Velo, Billett, parkieren, Natel, Trottoir, Znüni, grillieren ...). Do not "correct" them.
- If the learner switched to English or Portuguese for a word, give the German word in 'corrected' and in new_words.
- If the prompt asks for a target structure and they didn't use it, mention it gently in 'tip', not as an error.

Grammar topic ids: {{topics}}"""

FEEDBACK_SCHEMA = _object(
    {
        "understood": {"type": "string"},
        "verdict": {"type": "string", "enum": ["great", "good", "keep_going"]},
        "encouragement": {"type": "string"},
        "corrected": {"type": "string"},
        "natural": _nullable("string"),
        "key_fixes": {
            "type": "array",
            "items": _object(
                {
                    "original": {"type": "string"},
                    "fixed": {"type": "string"},
                    "why": {"type": "string"},
                    "topic_id": _nullable("string"),
                }
            ),
        },
        "tip": _nullable("string"),
        "new_words": {
            "type": "array",
            "items": _object({"de": {"type": "string"}, "en": {"type": "string"}}),
        },
    }
)


def feedback_system() -> str:
    topics = ", ".join(f"{t['id']} ({t['title']})" for t in grammar_topics().values())
    return FEEDBACK_SYSTEM.replace("{topics}", topics)


def feedback_user(prompt: str, answer: str, mode: str, target_topic: str | None) -> str:
    target = grammar_topics().get(target_topic or "")
    lines = [
        f"Prompt: {prompt}",
        f"Target structure: {target['title']} ({target['summary']})" if target else "Target structure: none",
        f"Mode: {mode}",
        f"Learner's answer: {answer}",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------- new speaking prompt

PROMPT_SYSTEM = f"""You write short speaking prompts for a German learner. {LEARNER}
The learner's goal is to stop getting stuck and to switch into German faster, so prompts should invite 3-6 sentences about everyday life, opinions, stories, small talk at work, or explaining something in their own words.
Write the prompt in simple German (A2-B1 vocabulary, max 25 words) addressed with "du", plus an English translation. Vary the situations. Don't mention that it's an exercise."""

PROMPT_SCHEMA = _object({"de": {"type": "string"}, "en": {"type": "string"}})


def prompt_user(target_topic: str | None, avoid: list[str]) -> str:
    target = grammar_topics().get(target_topic or "")
    lines = []
    if target:
        lines.append(
            f"The prompt should naturally make the learner use: {target['title']} ({target['summary']}). "
            "You may hint at the structure in the question itself."
        )
    else:
        lines.append("No specific grammar target.")
    if avoid:
        lines.append("Do not repeat these recent prompts:\n- " + "\n- ".join(avoid))
    return "\n".join(lines)


# ---------------------------------------------------------------- grammar exercises

EXERCISES_SYSTEM = f"""You write short German grammar exercises. {LEARNER}

Exercise types (mix them, roughly equal shares):
- "choice": a sentence with exactly one gap written as ___ and exactly 3 options, one correct. Quick to answer on a phone.
- "gap": a sentence with exactly one gap written as ___; 'hint' gives the base form in brackets, e.g. "(fahren)" or "(der Kollege)". The answer is only the word(s) that fill the gap.
- "transform": an English 'instruction' (e.g. "Rewrite in the Passiv Perfekt.") and a German 'sentence' to rewrite. The answer is the complete new sentence.

Rules:
- Every exercise must practise the topic, not obscure vocabulary. Vocabulary A2-B1, everyday contexts: work, Switzerland, shopping, friends, travel, appointments, family.
- The German must be 100% correct standard German. Double-check endings, word order and verb forms.
- 'answers' lists ALL fully correct answers (alternative word orders or equally correct forms). For "choice", 'answers' contains only the correct option, spelled exactly as in 'options'.
- Avoid gaps where several different words would be equally correct unless you list them all.
- 'options' is empty unless the type is "choice". 'hint' is null when not needed.
- 'instruction' is short English, e.g. "Fill in the correct form." or "Choose the right relative pronoun."
- 'explanation': one or two short plain-English sentences explaining the rule behind the answer.
- Vary the sentences; don't repeat the same verb or noun across exercises."""

EXERCISES_SCHEMA = _object(
    {
        "exercises": {
            "type": "array",
            "items": _object(
                {
                    "type": {"type": "string", "enum": ["choice", "gap", "transform"]},
                    "instruction": {"type": "string"},
                    "sentence": {"type": "string"},
                    "hint": _nullable("string"),
                    "options": {"type": "array", "items": {"type": "string"}},
                    "answers": {"type": "array", "items": {"type": "string"}},
                    "explanation": {"type": "string"},
                }
            ),
        }
    }
)


def exercises_user(topic: dict, count: int, recent_mistakes: list[str]) -> str:
    lines = [f"Topic: {topic['title']}", f"What it covers: {topic['description']}", f"Write {count} exercises."]
    if recent_mistakes:
        lines.append(
            "The learner recently got these wrong. Include a few exercises that target the same rules "
            "(new sentences, not copies):\n- " + "\n- ".join(recent_mistakes)
        )
    return "\n".join(lines)


# ---------------------------------------------------------------- answer check

CHECK_SYSTEM = f"""You check a German learner's answer to a grammar exercise. {LEARNER}
Be fair: accept ANY grammatically correct answer that fulfils the instruction and keeps the meaning, even if it differs from the reference answers. Ignore capitalisation of the first word, final punctuation, and accept ss for ß.
- correct: true or false.
- feedback: one or two short plain-English sentences. If wrong, explain the specific problem kindly. If right but different from the reference, say it's also correct.
- corrected: the learner's answer with the minimum changes to make it correct (the answer itself if correct)."""

CHECK_SCHEMA = _object(
    {"correct": {"type": "boolean"}, "feedback": {"type": "string"}, "corrected": {"type": "string"}}
)


def check_user(exercise: dict, answer: str) -> str:
    return json.dumps(
        {
            "instruction": exercise.get("instruction"),
            "sentence": exercise.get("sentence"),
            "hint": exercise.get("hint"),
            "reference_answers": exercise.get("answers"),
            "learner_answer": answer,
        },
        ensure_ascii=False,
    )
