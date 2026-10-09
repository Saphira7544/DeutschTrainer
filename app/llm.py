"""Thin wrapper around the OpenAI client: structured JSON answers and transcription."""
import json
import logging

from openai import OpenAI

from app import config

logger = logging.getLogger(__name__)

_client = None


class LLMError(RuntimeError):
    pass


def _get_client() -> OpenAI:
    # Created lazily so the app (and tests) can start without OPENAI_API_KEY.
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def ask_json(system: str, user: str, schema_name: str, schema: dict, max_tokens: int = 4000) -> dict:
    """Ask the model and get back JSON matching `schema` (strict structured output)."""
    try:
        response = _get_client().chat.completions.create(
            model=config.OPENAI_MODEL,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            },
            # Generous because newer models spend part of this budget on reasoning.
            max_completion_tokens=max_tokens,
        )
    except Exception as exc:
        logger.exception("OpenAI request failed")
        raise LLMError(str(exc)) from exc

    content = response.choices[0].message.content
    if not content:
        raise LLMError("The model returned an empty answer.")
    return json.loads(content)


def transcribe(audio: bytes, filename: str, content_type: str) -> str:
    try:
        result = _get_client().audio.transcriptions.create(
            model=config.OPENAI_TRANSCRIBE_MODEL,
            file=(filename, audio, content_type),
            language="de",
            # Learners need to see their own mistakes, so ask for a literal transcript.
            prompt="Wörtliche Transkription einer Deutschlernerin. Grammatikfehler nicht korrigieren.",
        )
    except Exception as exc:
        logger.exception("OpenAI transcription failed")
        raise LLMError(str(exc)) from exc
    return result.text.strip()
