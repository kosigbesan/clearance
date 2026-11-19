#!/usr/bin/env python3
"""Headless logic verification for a self-contained single-file HTML app.

Extracts the app's largest inline <script>, prepends a minimal browser stub,
appends a test file, and runs the combination under Node. Use when a live
browser is unavailable (or prompts for a debug permission) and you want
deterministic, repeatable logic checks that gate delivery.

Usage:
    python build_and_run_logic_tests.py APP.html TESTS.js [--keep] [--node NODE]

APP.html   the single-file app (the <script> with no src attribute)
TESTS.js   a test file that calls the app's pure functions and reports failures

Exit code mirrors Node's: 0 when every test passes. Also runs `node --check`
on the extracted script first so a syntax error is reported on its own line.

Note (Windows git-bash): pass native forward-slash paths (C:/Users/...) to this
script; MSYS does not translate /c/Users/... for the python/node binaries.
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile

# Minimal browser surface so a single-file app's top-level DOM calls do not throw.
STUB = r"""
const _el = () => ({ textContent:"", innerHTML:"", value:"", checked:false, dataset:{},
  addEventListener(){}, setAttribute(){}, classList:{toggle(){},add(){},remove(){}} });
global.document = { getElementById:_el, querySelectorAll:()=>[], addEventListener(){} };
global.window = { scrollTo(){}, print(){} };
global.localStorage = { getItem:()=>null, setItem(){}, removeItem(){} };
global.navigator = {};
global.alert = ()=>{}; global.confirm = ()=>false; global.prompt = ()=>null;
"""


def extract_script(html: str) -> str:
    """Return the largest <script> block that has no src attribute."""
    blocks = []
    for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S | re.I):
        blocks.append(m.group(1))
    if not blocks:
        sys.exit("error: no inline <script> block found in the HTML file")
    return max(blocks, key=len)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("html")
    ap.add_argument("tests")
    ap.add_argument("--node", default="node")
    ap.add_argument("--keep", action="store_true", help="keep the combined file for inspection")
    args = ap.parse_args()

    if not os.path.isfile(args.html):
        sys.exit(f"error: no such file: {args.html}")
    if not os.path.isfile(args.tests):
        sys.exit(f"error: no such file: {args.tests}")

    with open(args.html, encoding="utf-8") as f:
        html = f.read()
    with open(args.tests, encoding="utf-8") as f:
        tests = f.read()
    script = extract_script(html)
    combined = STUB + "\n;(function(){\n" + script + "\n})();\n" + tests + "\n"

    tmpdir = os.path.dirname(os.path.abspath(args.html)) if args.keep else tempfile.gettempdir()
    out = os.path.join(tmpdir, "_app_logic_check.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write(combined)

    # 1) syntax gate on the extracted script alone
    script_only = os.path.join(tmpdir, "_app_script_only.js")
    with open(script_only, "w", encoding="utf-8") as f:
        f.write(script)
    chk = subprocess.run([args.node, "--check", script_only], capture_output=True, text=True)
    if chk.returncode != 0:
        print("SYNTAX ERROR in app <script>:\n" + (chk.stderr or chk.stdout), file=sys.stderr)
        return chk.returncode
    print("syntax ok")

    # 2) run the logic tests
    run = subprocess.run([args.node, out], capture_output=True, text=True)
    sys.stdout.write(run.stdout)
    sys.stderr.write(run.stderr)

    if not args.keep:
        for p in (out, script_only):
            try:
                os.remove(p)
            except OSError:
                pass
    else:
        print(f"combined file kept at {out}")

    return run.returncode


if __name__ == "__main__":
    raise SystemExit(main())
