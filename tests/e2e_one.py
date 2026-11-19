"""Run one file through the app in a real browser and print what came back."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import collect
from e2e_check import run_one, CHROME

rel = sys.argv[1] if len(sys.argv) > 1 else "tests/realvideo.mp4"
collect.serve(8899)
url = "http://127.0.0.1:8899/tests/e2e.html?f=" + rel
res, elapsed = run_one(CHROME, url, timeout=300)
if not res:
    print("no result after %.0fs" % elapsed); raise SystemExit(1)
print("status:", res.get("status"))
print("waited: %.1fs  cues: %d  stills: %d" % (res.get("waitedMs", 0)/1000.0, len(res.get("cues") or []), res.get("thumbCount", 0)))
print("tech:", json.dumps(res.get("tech")))
print("cues:", json.dumps(res.get("cues")))
print("segments:", json.dumps(res.get("segs")))
print("certificate lines:", res.get("certificateLines"))
if res.get("error"): print("ERROR", res["error"])
