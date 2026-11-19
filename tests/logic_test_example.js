// Example logic test for a single-file HTML app. Run through
// scripts/build_and_run_logic_tests.py, which prepends the DOM stub and the
// app's <script>, so the app's top-level functions (here: triage, letterBureau)
// are in scope. One case per branch; assert on exact values, not "truthy".

let pass = 0, fail = 0;
function chk(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? "PASS " : "FAIL ") + name + "  got=" + got + (ok ? "" : "  want=" + want));
}

// helper to build a fixture with sensible defaults
const mk = (o) => Object.assign(
  { id: "x", type: "card", status: "late30", balance: "0", dofd: "", reason: "unsure" }, o);

// --- one case per branch of the pure logic -------------------------------
chk("under threshold -> special branch", triage(mk({ balance: "320" })).kind, "under");
chk("hardship -> soft path",             triage(mk({ status: "late90", reason: "accurate_hardship" })).kind, "goodwill");
chk("too old -> obsolescence",           triage(mk({ status: "collection", dofd: "2017-03" })).kind, "obsolescence");
chk("unknown -> review",                 triage(mk({ reason: "unsure" })).tier, "review");
chk("in good standing -> time",          triage(mk({ status: "current", reason: "accurate_other" })).tier, "time");

// --- generated text: assert the exact citation/substring that must appear --
const out = letterBureau([mk({ creditor: "Acme", status: "late30", dofd: "2025-02" })]);
chk("letter names the furnisher", out.includes("Acme") ? 1 : 0, 1);
chk("letter cites the statute",   out.includes("1681i") ? 1 : 0, 1);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
