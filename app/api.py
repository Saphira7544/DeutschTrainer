import secrets
from typing import Literal

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app import config, llm, prompts

Text = Field(min_length=1, max_length=config.MAX_TEXT_CHARS)


def require_token(x_access_token: str = Header(default="")) -> None:
    if not config.APP_ACCESS_TOKEN:
        raise HTTPException(503, "APP_ACCESS_TOKEN is not set on the server.")
    if not secrets.compare_digest(x_access_token.encode(), config.APP_ACCESS_TOKEN.encode()):
        raise HTTPException(401, "Wrong access token. Check it in Settings.")


router = APIRouter(prefix="/api")
protected = APIRouter(prefix="/api", dependencies=[Depends(require_token)])


def _ask(*args, **kwargs) -> dict:
    try:
        return llm.ask_json(*args, **kwargs)
    except llm.LLMError as exc:
        raise HTTPException(502, f"AI request failed: {exc}") from exc


@router.get("/health")
def health():
    return {"ok": True}


@protected.get("/auth-check")
def auth_check():
    return {"ok": True}


# ---------------------------------------------------------------- speaking

@protected.post("/speaking/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    data = await audio.read(config.MAX_AUDIO_BYTES + 1)
    if len(data) > config.MAX_AUDIO_BYTES:
        raise HTTPException(413, "Recording is too long. Keep answers under about 2 minutes.")
    if not data:
        raise HTTPException(400, "The recording is empty.")
    try:
        text = llm.transcribe(data, audio.filename or "answer.webm", audio.content_type or "audio/webm")
    except llm.LLMError as exc:
        raise HTTPException(502, f"Transcription failed: {exc}") from exc
    return {"text": text}


class FeedbackIn(BaseModel):
    prompt: str = Text
    answer: str = Text
    mode: Literal["spoken", "written"] = "spoken"
    target_topic: str | None = None


@protected.post("/speaking/feedback")
def speaking_feedback(body: FeedbackIn):
    result = _ask(
        prompts.feedback_system(),
        prompts.feedback_user(body.prompt, body.answer, body.mode, body.target_topic),
        "speaking_feedback",
        prompts.FEEDBACK_SCHEMA,
    )
    topics = prompts.grammar_topics()
    for fix in result["key_fixes"]:
        if fix["topic_id"] not in topics:
            fix["topic_id"] = None
    return result


class PromptIn(BaseModel):
    target_topic: str | None = None
    avoid: list[str] = Field(default_factory=list, max_length=20)


@protected.post("/speaking/prompt")
def new_prompt(body: PromptIn):
    result = _ask(
        prompts.PROMPT_SYSTEM,
        prompts.prompt_user(body.target_topic, [a[:200] for a in body.avoid]),
        "speaking_prompt",
        prompts.PROMPT_SCHEMA,
        max_tokens=1500,
    )
    return {**result, "target": body.target_topic}


# ---------------------------------------------------------------- grammar

class ExercisesIn(BaseModel):
    topic_id: str
    count: int = Field(default=8, ge=1, le=12)
    recent_mistakes: list[str] = Field(default_factory=list, max_length=8)


@protected.post("/grammar/exercises")
def grammar_exercises(body: ExercisesIn):
    topic = prompts.grammar_topics().get(body.topic_id)
    if topic is None:
        raise HTTPException(404, "Unknown grammar topic.")
    result = _ask(
        prompts.EXERCISES_SYSTEM,
        prompts.exercises_user(topic, body.count, [m[:300] for m in body.recent_mistakes]),
        "grammar_exercises",
        prompts.EXERCISES_SCHEMA,
        max_tokens=8000,
    )
    # Drop malformed items rather than showing an unanswerable exercise.
    exercises = []
    for ex in result["exercises"]:
        if not ex["answers"]:
            continue
        if ex["type"] == "choice" and (len(ex["options"]) < 2 or ex["answers"][0] not in ex["options"]):
            continue
        if ex["type"] in ("choice", "gap") and "___" not in ex["sentence"]:
            continue
        exercises.append({**ex, "topic_id": body.topic_id})
    return {"exercises": exercises}


class LookupIn(BaseModel):
    word: str = Field(min_length=1, max_length=60)
    sentence: str = Field(default="", max_length=500)


@protected.post("/words/lookup")
def word_lookup(body: LookupIn):
    return _ask(
        prompts.LOOKUP_SYSTEM,
        prompts.lookup_user(body.word, body.sentence),
        "word_lookup",
        prompts.LOOKUP_SCHEMA,
        max_tokens=800,
    )


class CheckIn(BaseModel):
    exercise: dict
    answer: str = Text


@protected.post("/grammar/check")
def grammar_check(body: CheckIn):
    return _ask(
        prompts.CHECK_SYSTEM,
        prompts.check_user(body.exercise, body.answer)[: config.MAX_TEXT_CHARS * 2],
        "answer_check",
        prompts.CHECK_SCHEMA,
        max_tokens=1500,
    )
