import logging
import mimetypes

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api import protected, router
from app.config import STATIC_DIR

logging.basicConfig(level=logging.INFO)

# Windows can map these from the registry to text/plain, which browsers refuse for module scripts.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/manifest+json", ".webmanifest")

app = FastAPI(title="Deutsch Trainer")
app.include_router(router)
app.include_router(protected)

# The phone app itself (PWA). Mounted last so /api/* wins.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
