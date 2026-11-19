#!/usr/bin/env python3
"""Headless RENDER verification for a self-contained single-file HTML app.

Companion to build_and_run_logic_tests.py. Same extraction, same syntax gate,
but it prepends a CACHING DOM stub (elements memoized by id) instead of a
fresh-element stub, so a render test can call a render function and then assert
on the HTML that was written to global.__els["<id>"].innerHTML.

Use it to prove a VIEW actually rendered (a board, a generated list, a sources
panel). Logic tests prove the pure functions; they do not prove anything was
rendered. Run both suites.

Usage:
    python build_and_run_render_tests.py APP.html TESTS.js [--keep] [--node NODE]

APP.html   the single-file app (the <script> with no src attribute)
TESTS.js   a render test that calls render functions and reads global.__els

The app's absolute path is exported as APP_HTML so a test can read static markup
from disk with fs.readFileSync(process.env.APP_HTML).

Exit code mirrors Node's: 0 when every assertion passes.

Note (Windows git-bash): pass native forward-slash paths (C:/Users/...) to this
script; MSYS does not translate /c/Users/... for the python/node binaries.
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile

# Caching browser surface: elements are memoized by id so rendered HTML survives.
CACHE_STUB = r"""
const _cache = {};
function _el(id){
  if(!_cache[id]){ _cache[id] = { id, textContent:"", innerHTML:"", value:"", checked:false, dataset:{},
    addEventListener(){}, setAttribute(){}, classList:{toggle(){},add(){},remove(){}} }; }
  return _cache[id];
}
global.document = { getElementById:_el, querySelectorAll:()=>[], addEventListener(){} };
global.window = { scrollTo(){}, print(){} };
global.localStorage = { getItem:()=>null, setItem(){}, removeItem(){} };
global.navigator = {};
global.alert = ()=>{}; global.confirm = ()=>false; global.prompt = ()=>null;
global.__els = _cache;
"""


def extract_script(html: str) -> str:
    """Return the largest <script> block that has no src attribute."""
    blocks = [m.group(1) for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S | re.I)]
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
    combined = CACHE_STUB + "\n;(function(){\n" + script + "\n})();\n" + tests + "\n"

    tmpdir = os.path.dirname(os.path.abspath(args.html)) if args.keep else tempfile.gettempdir()
    out = os.path.join(tmpdir, "_app_render_check.js")
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

    # 2) run the render tests (APP_HTML lets them read static markup from disk)
    env = dict(os.environ, APP_HTML=os.path.abspath(args.html))
    run = subprocess.run([args.node, out], capture_output=True, text=True, env=env)
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
