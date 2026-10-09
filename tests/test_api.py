"""API tests. The OpenAI calls are replaced with fakes: no network or API key needed."""
import pytest
from fastapi.testclient import TestClient

from app import config, llm, prompts
from app.main import app

TOKEN = "test-token"
AUTH = {"X-Access-Token": TOKEN}


@pytest.fixture(autouse=True)
def token(monkeypatch):
    monkeypatch.setattr(config, "APP_ACCESS_TOKEN", TOKEN)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def fake_llm(monkeypatch):
    calls = []

    def ask_json(system, user, schema_name, schema, max_tokens=4000):
        calls.append({"system": system, "user": user, "schema_name": schema_name})
        return fake_llm.responses[schema_name]

    monkeypatch.setattr(llm, "ask_json", ask_json)
    fake_llm.responses = {}
    fake_llm.calls = calls
    return fake_llm


def test_health_is_public(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_static_app_is_served(client):
    res = client.get("/")
    assert res.status_code == 200
    assert "Deutsch" in res.text
    js = client.get("/js/app.js")
    assert js.headers["content-type"].startswith("text/javascript")


@pytest.mark.parametrize("headers", [{}, {"X-Access-Token": "wrong"}])
def test_api_requires_token(client, headers):
    assert client.post("/api/speaking/feedback", json={"prompt": "x", "answer": "y"}, headers=headers).status_code == 401


def test_api_refuses_when_server_token_unset(client, monkeypatch):
    monkeypatch.setattr(config, "APP_ACCESS_TOKEN", "")
    assert client.get("/api/auth-check", headers=AUTH).status_code == 503


def test_feedback_passes_target_and_drops_unknown_topics(client, fake_llm):
    fake_llm.responses["speaking_feedback"] = {
        "understood": "You said you would travel.",
        "verdict": "good",
        "encouragement": "Nice use of würde.",
        "corrected": "Ich würde reisen.",
        "natural": None,
        "key_fixes": [
            {"original": "Ich würde reise", "fixed": "Ich würde reisen", "why": "Infinitive after würde.", "topic_id": "k2_present"},
            {"original": "x", "fixed": "y", "why": "z", "topic_id": "made_up"},
        ],
        "tip": None,
        "new_words": [],
    }
    res = client.post(
        "/api/speaking/feedback",
        json={"prompt": "Was würdest du machen?", "answer": "Ich würde reise", "target_topic": "k2_present"},
        headers=AUTH,
    )
    assert res.status_code == 200
    fixes = res.json()["key_fixes"]
    assert fixes[0]["topic_id"] == "k2_present"
    assert fixes[1]["topic_id"] is None
    assert "Konjunktiv II – Gegenwart" in fake_llm.calls[0]["user"]
    assert "k2_present" in fake_llm.calls[0]["system"]


def test_exercises_filters_malformed_items(client, fake_llm):
    good = {"type": "gap", "instruction": "Fill in.", "sentence": "Ich ___ gern.", "hint": "(reisen)", "options": [], "answers": ["würde reisen"], "explanation": "..."}
    fake_llm.responses["grammar_exercises"] = {
        "exercises": [
            good,
            {**good, "answers": []},  # no answer
            {**good, "type": "choice", "options": ["a", "b"], "answers": ["c"]},  # answer not an option
            {**good, "sentence": "No gap here."},  # gap exercise without ___
        ]
    }
    res = client.post("/api/grammar/exercises", json={"topic_id": "k2_present", "recent_mistakes": ["a → b"]}, headers=AUTH)
    assert res.status_code == 200
    exercises = res.json()["exercises"]
    assert len(exercises) == 1
    assert exercises[0]["topic_id"] == "k2_present"
    assert "a → b" in fake_llm.calls[0]["user"]


def test_exercises_unknown_topic(client, fake_llm):
    assert client.post("/api/grammar/exercises", json={"topic_id": "nope"}, headers=AUTH).status_code == 404


def test_llm_failure_becomes_502(client, monkeypatch):
    def boom(*a, **k):
        raise llm.LLMError("quota exceeded")

    monkeypatch.setattr(llm, "ask_json", boom)
    res = client.post("/api/grammar/check", json={"exercise": {}, "answer": "x"}, headers=AUTH)
    assert res.status_code == 502
    assert "quota exceeded" in res.json()["detail"]


def test_transcribe(client, monkeypatch):
    monkeypatch.setattr(llm, "transcribe", lambda data, name, ctype: " Ich habe gestern gearbeitet. ")
    res = client.post("/api/speaking/transcribe", files={"audio": ("a.webm", b"fake-audio", "audio/webm")}, headers=AUTH)
    assert res.json() == {"text": " Ich habe gestern gearbeitet. "}


def test_transcribe_rejects_huge_files(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_AUDIO_BYTES", 10)
    res = client.post("/api/speaking/transcribe", files={"audio": ("a.webm", b"x" * 11, "audio/webm")}, headers=AUTH)
    assert res.status_code == 413


def test_prompt_data_references_real_topics():
    import json

    topics = prompts.grammar_topics()
    data = json.loads((config.DATA_DIR / "speaking_prompts.json").read_text(encoding="utf-8"))
    ids = [p["id"] for p in data["prompts"]]
    assert len(ids) == len(set(ids))
    for p in data["prompts"]:
        assert p["target"] is None or p["target"] in topics, p["id"]


def test_schemas_are_strict():
    """OpenAI strict mode needs every property listed as required and no extra properties."""

    def walk(schema):
        if schema.get("type") == "object":
            assert schema["additionalProperties"] is False
            assert set(schema["required"]) == set(schema["properties"])
            for sub in schema["properties"].values():
                walk(sub)
        if schema.get("type") == "array":
            walk(schema["items"])

    for s in (prompts.FEEDBACK_SCHEMA, prompts.EXERCISES_SCHEMA, prompts.CHECK_SCHEMA, prompts.PROMPT_SCHEMA):
        walk(s)
