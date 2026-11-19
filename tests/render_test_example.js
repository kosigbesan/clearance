// Example RENDER test for a single-file HTML app. Run through
// scripts/build_and_run_render_tests.py, which prepends templates/dom_stub_cache.js
// and the app's <script>, so the app's render functions are in scope and any HTML
// they write is readable via global.__els["<element-id>"].
//
// Assert two ways, and know which is which:
//   DYNAMIC: call the render function, then read global.__els["<id>"].innerHTML.
//   STATIC : text that lives in the page's static markup (an <aside>, a footer)
//            is NOT in any rendered element. Read the file from disk instead.
// Crossing them is the #1 false failure: it looks like a broken view when the
// string was simply never in that element. Read the raw file for static text.
//
// The runner passes the app path in APP_HTML so the disk read works from any cwd.

const fs = require("fs");
const html = fs.readFileSync(process.env.APP_HTML || "index.html", "utf8");

let ok = 0, bad = 0;
function A(name, cond) { cond ? ok++ : bad++; console.log((cond ? "PASS " : "FAIL ") + name); }

// --- DYNAMIC: exercise the renderer, then read what it wrote ---------------
renderLoans();
const loans = global.__els["loans-list"].innerHTML;
A("loans view rendered rows", loans.length > 0);
A("loans view lists a program", loans.includes("Total and Permanent Disability"));
A("loans view links out", loans.includes("studentaid.gov"));

// --- STATIC: text outside the <script> lives only in the file --------------
A("page carries the static notice", html.includes("promissory note"));

// --- COUNTS: a panel that enumerates things is easy to mis-count -----------
const src = global.__els["srcblock"].innerHTML;
A("sources block lists every entry", (src.match(/\[\d+\]/g) || []).length === 27);

console.log("\n" + ok + " passed, " + bad + " failed");
if (bad) process.exit(1);
