"""Build the single-file CLEARANCE app from src/app.js and src/index.template.html.

One file out, no build step to run it, no CDN, no external font. The template
carries a /*INLINE_JS*/ marker where the script goes.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
OUT = os.path.join(HERE, "index.html")

tpl = io.open(os.path.join(SRC, "index.template.html"), encoding="utf-8").read()
js = io.open(os.path.join(SRC, "app.js"), encoding="utf-8").read()

if "/*INLINE_JS*/" not in tpl:
    sys.exit("marker /*INLINE_JS*/ missing from the template")

js_browser = js

html = tpl.replace("/*INLINE_JS*/", js_browser)
io.open(OUT, "w", encoding="utf-8", newline="\n").write(html)

# Guards: the two user rules that must never regress.
dashes = [c for c in html if c in ("\u2014", "\u2013")]
if dashes:
    sys.exit("em or en dash found in the built file: %d occurrence(s)" % len(dashes))

for must in ("<style>", "</script>", 'id="view-scan"', 'id="view-dispute"', "makeFFT"):
    if must not in html:
        sys.exit("built file is missing " + must)

print("index.html written, %d bytes" % len(html.encode("utf-8")))
print("script size %d bytes, template %d bytes" % (len(js_browser), len(tpl)))
