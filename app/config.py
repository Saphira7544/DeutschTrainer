import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
DATA_DIR = STATIC_DIR / "data"

load_dotenv(ROOT / ".env")

# Shared secret the phone sends with every API call, so nobody else can spend
# your OpenAI credit. Required: the API refuses requests while it's unset.
APP_ACCESS_TOKEN = os.getenv("APP_ACCESS_TOKEN", "")

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")
OPENAI_TRANSCRIBE_MODEL = os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")

# Guards against accidental big bills: cap input sizes the API accepts.
MAX_AUDIO_BYTES = 6 * 1024 * 1024  # roughly 2-3 minutes of compressed speech
MAX_TEXT_CHARS = 2000
