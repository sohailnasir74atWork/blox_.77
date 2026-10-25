"""Serve the local card art like the CDN, for dev builds (cardsMock.js uses it).

    python3 scripts/fruit-cards/art.py               # builds out/ first
    python3 scripts/fruit-cards/dev-cdn.py           # http://localhost:8765
    adb reverse tcp:8765 tcp:8765                    # Android emulator / device

  /fruits/index.json        keys in out/index.json (what art.py would upload)
  /fruits/2k/index.json     same list
  /fruits/<key>.webp        out/1024
  /fruits/512/<key>.webp    out/512
  /fruits/2k/<key>.webp     out/2048
  /index.json               [] (no painted assets yet; the app paints fallbacks)
"""

import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
ROUTES = [
    (re.compile(r"^/fruits/512/([a-z0-9]+)\.webp$"), "512"),
    (re.compile(r"^/fruits/2k/([a-z0-9]+)\.webp$"), "2048"),
    (re.compile(r"^/fruits/([a-z0-9]+)\.webp$"), "1024"),
]


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/fruits/index.json", "/fruits/2k/index.json"):
            return self._file(os.path.join(OUT, "index.json"), "application/json")
        if path == "/index.json":
            return self._bytes(b"[]", "application/json")
        for rx, folder in ROUTES:
            m = rx.match(path)
            if m:
                return self._file(os.path.join(OUT, folder, f"{m.group(1)}.webp"), "image/webp")
        self.send_error(404)

    def _file(self, path, ctype):
        if not os.path.exists(path):
            return self.send_error(404)
        with open(path, "rb") as fh:
            self._bytes(fh.read(), ctype)

    def _bytes(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print("Fruit Cards dev CDN on http://localhost:8765")
    ThreadingHTTPServer(("0.0.0.0", 8765), Handler).serve_forever()
