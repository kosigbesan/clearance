// Render tests for CLEARANCE. Run through tests/build_and_run_render_tests.py,
// which prepends tests/dom_stub_cache.js (memoized elements) and the app script.
// Read rendered output from global.__els["<id>"].innerHTML.
//
// DYNAMIC assertions call a renderer and read the element it wrote to.
// STATIC assertions read the built page from disk (process.env.APP_HTML).

const fs = require("fs");
const html = fs.readFileSync(process.env.APP_HTML || "index.html", "utf8");

let ok = 0, bad = 0;
function A(name, cond) { cond ? ok++ : bad++; console.log((cond ? "PASS " : "FAIL ") + name); }
const C = globalThis.CLR;
const el = (id) => (global.__els[id] ? global.__els[id].innerHTML : "");

/* Fill the app with the sample cut and render every view. */
C.sampleFilm();

/* ---------------------------------------------------------------- scan view */
const sum = el("scanSummary");
A("scan summary rendered tiles", sum.length > 200);
A("scan summary counts ten cues", sum.indexOf(">10<") >= 0);
A("scan summary has a stop tile", sum.indexOf("Stop") >= 0);
A("scan summary tiles are clickable filters", sum.indexOf('data-filter="stop"') >= 0);
A("scan summary shows the music total", /of music/.test(sum));

const list = el("scanList");
A("scan list rendered cue cards", list.length > 1000);
A("scan list shows a timecode", /\d+:\d\d/.test(list));
A("scan list carries the level class", list.indexOf('class="cue stop"') >= 0);
A("scan list marks the bedded cue", list.indexOf("Under dialogue") >= 0);
A("scan list shows the route label", list.indexOf("Editor&#39;s own sound folder, origin unknown") >= 0 || list.indexOf("Editor's own sound folder, origin unknown") >= 0);
A("scan list shows a release likeness", list.indexOf("Release likeness") >= 0);

const tech = el("scanTech");
A("technical panel rendered", tech.indexOf("Technical pre-flight") >= 0);
A("technical panel flags the quiet mix", tech.indexOf("LUFS") >= 0 && tech.indexOf("quiet") >= 0);
A("technical panel reports stereo", tech.indexOf("Stereo") >= 0);

/* ---------------------------------------------------------------- cue sheet */
const sheet = el("cueSheet");
A("cue sheet rendered rows", sheet.length > 2000);
A("cue sheet has one row per cue", (sheet.match(/data-cue=/g) || []).length === 10);
A("cue sheet offers every route", (sheet.match(/<option value="(editor|beatlease|free|bleed|live|ai|stock|ytal|reuse|licensed|score)"/g) || []).length === 110);
A("cue sheet carries the proof field", sheet.indexOf('data-field="proof"') >= 0);
A("cue sheet carries the CID field", sheet.indexOf('data-field="cid"') >= 0);
A("cue sheet marks the bedded cue", sheet.indexOf("under dialogue") >= 0);

const routes = el("routeNotes");
A("route notes list every source", (routes.match(/Proof to hold:/g) || []).length === 11);
A("route notes carry the highest risk first", routes.indexOf("Editor&#39;s own sound folder") < routes.indexOf("YouTube Audio Library"));

/* ---------------------------------------------------------------- shield */
const shield = el("shieldBody");
A("shield rendered the five steps", (shield.match(/<li><span class="sn">/g) || []).length === 5);
A("shield names the hijack pattern", shield.indexOf("stranger extracting") >= 0 || shield.indexOf("extracting the film") >= 0);
A("shield reports the hash or offers to take one", shield.indexOf("Hashed") >= 0 || shield.indexOf('data-act="hash"') >= 0);
A("shield shows the evidence pack", shield.indexOf("evidence pack") >= 0);
A("shield warns about publishing before checks finish", shield.indexOf("still running") >= 0);

/* ---------------------------------------------------------------- dispute */
const disp = el("disputeBody");
A("dispute rendered the intake", disp.indexOf('id="claimText"') >= 0);
A("dispute rendered the clock heading", disp.indexOf("The clock") >= 0);
A("dispute rendered a statement", disp.indexOf("DISPUTE OF CONTENT ID CLAIM") >= 0);
A("dispute statement names the film", disp.indexOf("Behind Closed Doors") >= 0);
A("dispute warns about weak bases", disp.indexOf("not a valid basis") >= 0);
A("dispute offers the cue lookup action", disp.indexOf('data-act="useCue"') >= 0);

/* ---------------------------------------------------------------- brief */
const brief = el("briefBody");
A("brief rendered the lede", brief.indexOf("Content ID") >= 0);
A("brief rendered every trap", (brief.match(/<span class="tn">/g) || []).length === C.TRAPS.length);
A("brief rendered every plan", (brief.match(/<span class="pn">/g) || []).length === C.PLANS.length);
A("brief marks the recommended plan", brief.indexOf('class="plan rec"') >= 0);
A("brief states the per title tier", brief.indexOf("Per title") >= 0);
A("brief says nothing leaves the browser", brief.indexOf("ever leaves the browser") >= 0);

/* ---------------------------------------------------------------- identify + provenance */
const ident = el("identifyBody");
A("the identify panel rendered", ident.indexOf("Name the tracks") >= 0);
A("the identify panel carries the server address", ident.indexOf('id="srvUrl"') >= 0);
A("the identify panel offers the batch action", ident.indexOf('data-act="identifyAll"') >= 0);
A("the identify panel states the honest limit", ident.indexOf("No match is weak evidence") >= 0);
A("the identify panel counts the outcomes", ident.indexOf("Unchecked") >= 0);

const prov = el("provBody");
A("the provenance panel rendered", prov.indexOf("Provenance") >= 0);
A("provenance explains the mark is not a lock", prov.indexOf("not a lock") >= 0);
A("provenance offers marking a score", prov.indexOf('data-act="pickScore"') >= 0);
A("provenance shows the seed field", prov.indexOf('id="markSeed"') >= 0);
A("provenance states the measured detection figures", prov.indexOf("floor of two and a half") >= 0);

const susp = el("suspectBody");
A("the suspect panel rendered", susp.indexOf("Did this audio come out of my film?") >= 0);
A("the suspect panel offers a file", susp.indexOf('data-act="pickSuspect"') >= 0);
A("the suspect panel offers nothing until something is checked", susp.indexOf("Nothing checked yet") >= 0);
C.getState().suspect = { name: "suspect.mp3", at: "2026-11-19 11:00", index: 41.2, level: "stop", verdict: "Mark found, strongly", seconds: 187, seed: "s" };
C.renderSuspect();
const susp2 = el("suspectBody");
A("a suspect result renders a reading", susp2.indexOf("41.2") >= 0);
A("a suspect result states the verdict", susp2.indexOf("Mark found, strongly") >= 0);
A("a suspect result says the mark places the audio in the film", susp2.indexOf("places its audio inside your film") >= 0);
C.getState().suspect = { name: "clean.mp3", at: "2026-11-19 11:01", index: 2.1, level: "go", verdict: "No mark", seconds: 90, seed: "s" };
C.renderSuspect();
A("a negative reading is not overclaimed", el("suspectBody").indexOf("not proof the audio is not yours") >= 0);
A("the page carries both hidden file inputs", html.indexOf('id="scoreFile"') >= 0 && html.indexOf('id="suspectFile"') >= 0);

/* ---------------------------------------------------------------- the film line */
const fl = el("filmLine");
A("film line names the file", fl.indexOf("Behind Closed Doors") >= 0);
A("film line shows the hash prefix", fl.indexOf("sha256") >= 0);

/* ---------------------------------------------------------------- static markup */
A("page carries the tab bar", html.indexOf('id="tab-scan"') >= 0 && html.indexOf('id="tab-brief"') >= 0);
A("page carries all five views", ["scan", "cues", "shield", "dispute", "brief"].every((v) => html.indexOf('id="view-' + v + '"') >= 0));
A("page carries the drop zone", html.indexOf('id="drop"') >= 0);
A("page carries the honest footer", html.indexOf("not a clearance in law") >= 0);
A("page has no em or en dash", !/[\u2013\u2014]/.test(html));
A("page loads nothing external", !/(https?:)?\/\/(fonts|cdn|unpkg|jsdelivr)/i.test(html));
A("page is a single file with one inline script", (html.match(/<script/g) || []).length === 1);

/* ---------------------------------------------------------------- filter behaviour */
C.show("scan");
global.__els["scanSummary"].innerHTML = "";
C.renderScan();
A("tiles re-render after a filter change", global.__els["scanSummary"].innerHTML.indexOf("data-filter") >= 0);

/* ---------------------------------------------------------------- a live claim */
const st = C.getState();
st.claim.matchTime = "31:22";
st.claim.claimDate = "2026-11-01";
st.claim.claimant = "Mazi Enemuo";
st.claim.text = "Copyright claim on your video. Claimant: Mazi Enemuo. Audio segment 31:22 to 32:40. Monetised by the claimant.";
C.renderDispute();
const live = global.__els["disputeBody"].innerHTML;
A("clock panel renders once a date is set", live.indexOf("Day 30") >= 0);
A("clock computes the five day window", live.indexOf("2026-11-06") >= 0);
A("clock computes the ninety day window", live.indexOf("2027-01-30") >= 0);
A("the timestamp resolves to a cue", live.indexOf("That timestamp is this cue") >= 0);
A("the resolved cue is the one at 31:22", live.indexOf("31:22") >= 0);
A("the dispute statement carries the claimant", live.indexOf("Mazi Enemuo") >= 0);

console.log("\n" + ok + " passed, " + bad + " failed");
if (bad) process.exit(1);
