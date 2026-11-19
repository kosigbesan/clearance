"""End to end check for CLEARANCE.

Feeds a synthetic film with known contents through the real app in a real
Chrome, then compares what the app detected against the ground truth.

    python tests/e2e_check.py

Ground truth (tests/gen_truth.py):
    0 to  8   speech
    8 to 28   music
   28 to 36   speech
   36 to 56   music
   56 to 64   silence

Runs the file twice: once as an MP4 (AAC inside an MP4 container, which is what
a producer actually has) and once as a WAV (the fallback the app tells people to
use when a film will not decode).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import collect  # noqa: E402

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 8899


def run_one(chrome, url, timeout=300):
    """Launch headless Chrome on the harness page and wait for its POST."""
    if os.path.exists(collect.RESULT):
        os.remove(collect.RESULT)
    profile = tempfile.mkdtemp(prefix="clr-chrome-")
    proc = subprocess.Popen([
        chrome, "--headless=new", "--disable-gpu", "--no-first-run",
        "--no-default-browser-check", "--mute-audio", "--disable-extensions",
        "--autoplay-policy=no-user-gesture-required",
        "--user-data-dir=" + profile,
        "--window-size=1280,900",
        url,
    ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    t0 = time.time()
    data = None
    while time.time() - t0 < timeout:
        if os.path.exists(collect.RESULT):
            time.sleep(0.4)
            try:
                with open(collect.RESULT, encoding="utf-8") as f:
                    data = json.load(f)
                if data.get("done"):
                    break
            except Exception:
                data = None
        time.sleep(0.5)
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    shutil.rmtree(profile, ignore_errors=True)
    return data, time.time() - t0


def overlap(a, b, c, d):
    return max(0.0, min(b, d) - max(a, c))


def check(result, truth, label):
    ok = []
    bad = []
    cues = result.get("cues") or []
    print("\n== %s ==" % label)
    print("status: %s" % result.get("status"))
    print("analysed in %.1fs, %d cue(s) found, %d still(s) grabbed"
          % (result.get("waitedMs", 0) / 1000.0, len(cues), result.get("thumbCount", 0)))
    if result.get("error"):
        print("ERROR: %s" % result["error"])
        return 0, 1

    def A(name, cond, extra=""):
        (ok if cond else bad).append(name)
        print(("PASS " if cond else "FAIL ") + name + ("  " + extra if extra else ""))

    A("the app finished and reported", bool(result.get("status")))
    A("the audio track decoded", result.get("tech") is not None)
    A("at least two music cues were found", len(cues) >= 2, "found %d" % len(cues))

    for i, (ts, te) in enumerate(truth["music"]):
        best, bo = None, 0.0
        for c in cues:
            o = overlap(ts, te, c["start"], c["end"])
            if o > bo:
                bo, best = o, c
        if not best:
            A("truth cue %d (%.0f to %.0f) was detected" % (i + 1, ts, te), False)
            continue
        frac = bo / (te - ts)
        A("truth cue %d (%.0f to %.0f) was detected" % (i + 1, ts, te), frac >= 0.8,
          "overlap %.0f%% at %.1f to %.1f" % (frac * 100, best["start"], best["end"]))
        A("truth cue %d start is within 2.5s" % (i + 1), abs(best["start"] - ts) <= 2.5,
          "off by %.1fs" % (best["start"] - ts))
        A("truth cue %d end is within 2.5s" % (i + 1), abs(best["end"] - te) <= 2.5,
          "off by %.1fs" % (best["end"] - ts and best["end"] - te))

    speech_only = [(0, 8), (28, 36)]
    spurious = 0
    for c in cues:
        for a, b in speech_only:
            if overlap(a, b, c["start"], c["end"]) > 4.0:
                spurious += 1
    A("no music cue was invented inside a speech only stretch", spurious == 0,
      "%d spurious" % spurious)

    tech = result.get("tech") or {}
    A("loudness was measured", tech.get("lufs") is not None,
      "%s LUFS" % (round(tech["lufs"], 1) if tech.get("lufs") is not None else "n/a"))
    A("peak was measured", tech.get("peakDb") is not None,
      "%s dBFS" % (round(tech["peakDb"], 1) if tech.get("peakDb") is not None else "n/a"))
    A("stereo correlation was measured", tech.get("corr") is not None,
      "corr %s" % (round(tech["corr"], 2) if tech.get("corr") is not None else "n/a"))
    A("the silent tail was found", any(s["type"] == "silence" and s["start"] > 50 for s in (result.get("segs") or [])),
      str([s for s in (result.get("segs") or []) if s["type"] == "silence"]))
    A("stills were grabbed for the cues", result.get("thumbCount", 0) >= 1,
      "%d still(s)" % result.get("thumbCount", 0))
    A("a certificate can be generated from the result", result.get("certificateLines", 0) > 15,
      "%d lines" % result.get("certificateLines", 0))

    print("detected cues: %s" % json.dumps(cues))
    print("segments: %s" % json.dumps(result.get("segs")))
    return len(ok), len(bad)


def main():
    chrome = CHROME if os.path.exists(CHROME) else shutil.which("chrome") or shutil.which("chrome.exe")
    if not chrome:
        print("no Chrome found at %s" % CHROME)
        return 2
    with open(os.path.join(HERE, "truth.json"), encoding="utf-8") as f:
        truth = json.load(f)

    collect.serve(PORT)
    print("harness serving on http://127.0.0.1:%d" % PORT)

    total_ok = total_bad = 0
    for label, rel in [("MP4 with an AAC track", "tests/truth.mp4"),
                       ("WAV fallback", "tests/truth.wav")]:
        url = "http://127.0.0.1:%d/tests/e2e.html?f=%s" % (PORT, rel)
        result, elapsed = run_one(chrome, url)
        if not result:
            print("\n== %s ==\nno result after %.0fs" % (label, elapsed))
            total_bad += 1
            continue
        a, b = check(result, truth, label)
        total_ok += a
        total_bad += b

    print("\n%d passed, %d failed" % (total_ok, total_bad))
    return 1 if total_bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
