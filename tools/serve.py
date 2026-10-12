"""Local preview of the app, served exactly like GitHub Pages: under /DeutschTrainer/.

Usage:
    python tools/serve.py            → http://localhost:8010/DeutschTrainer/
    python tools/serve.py 9000       → another port

Standard library only. App files are sent with no-cache so edits show up on reload.
"""
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "static"
PREFIX = "/DeutschTrainer"


class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows can map these to text/plain from the registry, which browsers refuse for module scripts.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".webmanifest": "application/manifest+json",
        ".json": "application/json",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path in ("/", PREFIX):
            self.send_response(302)
            self.send_header("Location", f"{PREFIX}/")
            self.end_headers()
            return
        if not self.path.startswith(f"{PREFIX}/"):
            # Like GitHub Pages: anything outside the project path doesn't exist. Catches absolute paths.
            self.send_error(404, "Outside /DeutschTrainer/ - use relative paths")
            return
        self.path = self.path[len(PREFIX):]
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
    print(f"Serving {ROOT} at http://localhost:{port}{PREFIX}/")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
