import logging
import mimetypes

from fastapi import FastAPI, Request
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


@app.middleware("http")
async def cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/audio/"):
        # Recordings never change.
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif not path.startswith("/api/"):
        # App files: always check for a newer version (cheap thanks to ETags), so updates show up right away.
        response.headers["Cache-Control"] = "no-cache"
    return response

# The phone app itself (PWA). Mounted last so /api/* wins.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
