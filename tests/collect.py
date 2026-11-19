"""Static server plus a POST collector, for the CLEARANCE end to end test.

Serves the project directory so the harness page and the app share an origin
(which is what lets the harness reach into the app's iframe and read its
localStorage), and accepts POST /result by writing the body to a file.

Run from tests/e2e_check.py. Not part of the shipped app.
"""
import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "e2e_result.json")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def do_POST(self):
        if self.path != "/result":
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception as e:
            payload = {"done": True, "error": "bad json: %s" % e}
        with open(RESULT, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=1)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")


def serve(port=8899):
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


if __name__ == "__main__":
    s = serve()
    print("serving %s on http://127.0.0.1:8899" % ROOT)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        s.shutdown()
