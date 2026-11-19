// Logic tests for CLEARANCE. Run through tests/build_and_run_logic_tests.py, which
// prepends the DOM stub and the app script, then this file. The app's exports are
// on globalThis.CLR (the harness wraps the app in an IIFE, so bare names are not
// in scope).

let pass = 0, fail = 0;
function chk(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? "PASS " : "FAIL ") + name + "  got=" + JSON.stringify(got) + (ok ? "" : "  want=" + JSON.stringify(want)));
}
const near = (name, got, want, tol) => chk(name, Math.abs(got - want) <= tol, true);

const C = globalThis.CLR;
chk("exports present", typeof C === "object" && typeof C.fmtTime === "function", true);

/* ---------------------------------------------------------------- timecodes */
chk("fmtTime zero", C.fmtTime(0), "0:00");
chk("fmtTime under an hour", C.fmtTime(62), "1:02");
chk("fmtTime over an hour", C.fmtTime(3723), "1:02:03");
chk("fmtTime null", C.fmtTime(null), "0:00");
chk("fmtLong hours", C.fmtLong(3723), "1h 02m 03s");
chk("fmtLong minutes", C.fmtLong(62), "01m 02s");
chk("parseTimecode hhmmss", C.parseTimecode("1:02:03"), 3723);
chk("parseTimecode mmss", C.parseTimecode("62:03"), 3723);
chk("parseTimecode bare seconds", C.parseTimecode("3723"), 3723);
chk("parseTimecode claim style", C.parseTimecode("14:22"), 862);
chk("parseTimecode empty", C.parseTimecode(""), null);
chk("parseTimecode junk", C.parseTimecode("abc"), null);

/* ---------------------------------------------------------------- risk engine */
const F = { scoreRegistered: true };
const Fbad = { scoreRegistered: false };
const mk = (o) => Object.assign({ id: "c1", start: 0, end: 10, underDialogue: false }, o);

chk("original score with full proof clears", C.riskFor(mk({ source: "score", proof: "full" }), F).level, "go");
chk("editor folder with no proof stops", C.riskFor(mk({ source: "editor", proof: "none" }), F).level, "stop");
chk("editor folder stops even with proof", C.riskFor(mk({ source: "editor", proof: "full" }), F).level, "stop");
chk("stock with full proof clears", C.riskFor(mk({ source: "stock", proof: "full", cid: false, licenceScope: "full" }), F).level, "go");
chk("stock without scope check watches", C.riskFor(mk({ source: "stock", proof: "full", cid: false, licenceScope: "narrow" }), F).level, "watch");
chk("audio library with no proof clears", C.riskFor(mk({ source: "ytal", proof: "none" }), F).level, "go");
chk("radio bleed stops", C.riskFor(mk({ source: "bleed", proof: "none" }), F).level, "stop");
chk("unregistered score adds exposure", C.riskFor(mk({ source: "score", proof: "full" }), Fbad).score - C.riskFor(mk({ source: "score", proof: "full" }), F).score, 5);
chk("registered with CID pushes a lease to stop", C.riskFor(mk({ source: "beatlease", proof: "part", cid: true }), F).level, "stop");
chk("third party registration stops", C.riskFor(mk({ source: "licensed", proof: "full", registration: "someone" }), F).level, "stop");
chk("under dialogue raises the score", C.riskFor(mk({ source: "stock", proof: "full", underDialogue: true }), F).score,
  C.riskFor(mk({ source: "stock", proof: "full", underDialogue: false }), F).score + 11);
chk("unknown source falls back to the worst route", C.riskFor(mk({ source: "" }), F).level, "stop");
chk("reasons are never empty", C.riskFor(mk({ source: "editor", proof: "none" }), F).reasons.length > 0, true);
chk("verdict for a bedded stop says replace", C.verdictLine(mk({ underDialogue: true }), { level: "stop" }), "Replace it. This one cannot be muted out.");
chk("verdict for a clear cue says leave it", C.verdictLine(mk({}), { level: "go" }).indexOf("Leave it") === 0, true);

/* ---------------------------------------------------------------- summary */
const cues = [
  mk({ id: "a", start: 10, end: 40, source: "editor", proof: "none" }),
  mk({ id: "b", start: 100, end: 130, source: "editor", proof: "none", underDialogue: true }),
  mk({ id: "c", start: 200, end: 230, source: "score", proof: "full" }),
];
const sum = C.filmSummary(cues, F);
chk("summary counts the stops", sum.counts.stop, 2);
chk("summary band is stop", sum.band, "stop");
chk("summary headline names the count", sum.headline.indexOf("2 cues will be claimed") === 0, true);
chk("summary counts music seconds", Math.round(sum.musicSec), 90);
chk("summary counts bedded cues", sum.bedded, 1);
chk("summary with no cues", C.filmSummary([], F).headline, "Nothing on the board will be claimed");
chk("summary reports the hijack exposure", C.filmSummary(cues, Fbad).hijack, true);
chk("summary clears the hijack flag once registered", C.filmSummary(cues, F).hijack, false);

/* ---------------------------------------------------------------- cue lookup */
const hit = C.cueAt(110, cues);
chk("cueAt finds the cue under the timestamp", hit.id, "b");
chk("cueAt falls back to the nearest", C.cueAt(5000, cues).id, "c");
chk("cueAt with no cues", C.cueAt(10, []), null);
chk("cueAt with a null time", C.cueAt(null, cues), null);

/* ---------------------------------------------------------------- claim parse */
const p = C.parseClaimText("Copyright claim on your video. Claimant: Chinonso Obiora. Asset: We Can Take It. Audio segment 14:22 to 15:40. Monetised by the claimant.");
chk("parse finds the timestamp", p.times[0].text, "14:22");
chk("parse converts the timestamp", p.times[0].sec, 862);
chk("parse finds the claimant", p.claimant.indexOf("Chinonso") === 0, true);
chk("parse finds the policy", p.policy, "monetised by the claimant");
chk("parse on empty text", C.parseClaimText("").times.length, 0);

/* ---------------------------------------------------------------- dispute */
const d = C.buildDispute({ matchTime: "14:22", claimant: "Mazi Enemuo", asset: "We Can Take It", basis: "licence" },
  cues[1], { name: "My 30th Wedding.mp4", channel: "Example TV", hash: "abc123", lockedAt: "2026-11-01 09:00" });
chk("dispute names the segment", d.indexOf("14:22") >= 0, true);
chk("dispute names the claimant", d.indexOf("Mazi Enemuo") >= 0, true);
chk("dispute names the film", d.indexOf("My 30th Wedding.mp4") >= 0, true);
chk("dispute carries the file hash", d.indexOf("abc123") >= 0, true);
chk("dispute rejects the weak bases", d.indexOf("does not rest on credit given") >= 0, true);
chk("dispute states a rights basis", d.indexOf("I hold a licence") >= 0, true);
const dOwn = C.buildDispute({ basis: "own" }, cues[0], {});
chk("ownership basis branch", dOwn.indexOf("I am the owner") >= 0, true);
const dWrong = C.buildDispute({ basis: "wrong" }, cues[0], {});
chk("misidentification basis branch", dWrong.indexOf("identifies the wrong material") >= 0, true);
const dDefault = C.buildDispute({ basis: "other" }, cues[0], {});
chk("default basis branch", dDefault.indexOf("used with the necessary rights") >= 0, true);

/* ---------------------------------------------------------------- certificate */
const cert = C.buildCertificate(cues, { name: "Test Film", channel: "Test TV", hash: "deadbeef", lockedAt: "2026-11-01 09:00" },
  { lufs: -21.4, peak: -2.6, corr: 0.93 });
chk("certificate titles itself", cert.indexOf("CLEARANCE CERTIFICATE") >= 0, true);
chk("certificate lists every cue", (cert.match(/route      /g) || []).length, 3);
chk("certificate carries the hash", cert.indexOf("deadbeef") >= 0, true);
chk("certificate flags the bedded cue", cert.indexOf("cannot be muted out") >= 0, true);
chk("certificate has a signature line", cert.indexOf("Signed ") >= 0, true);
chk("certificate with no cues says so", C.buildCertificate([], {}, null).indexOf("No music cues were detected") >= 0, true);

/* ---------------------------------------------------------------- csv */
const csv = C.csvFor(cues, F).split("\n");
chk("csv header", csv[0], "no,start,end,seconds,route,supplier,proof,position,risk,score,verdict");
chk("csv row count", csv.length, 4);
chk("csv quotes a field with a comma", C.csvFor([mk({ source: "stock", supplier: "Emeka, editor" })], F).indexOf('"Emeka, editor"') >= 0, true);
chk("csv names the stop", C.csvFor(cues, F).indexOf("Stop") >= 0, true);

/* ---------------------------------------------------------------- folder triage */
const tri = C.triageFilenames([
  "no copyright afrobeat.mp3",
  "prod by kay instrumental 2.mp3",
  "scene 14 room tone.wav",
  "church choir take 3.wav",
  "suno track 8.mp3",
  "score final v4.wav",
].join("\n"));
chk("triage counts the audio files", tri.audio, 6);
chk("triage flags the free download", tri.hits.some((h) => h.name === "no copyright afrobeat.mp3"), true);
chk("triage flags the type beat producer", tri.hits.some((h) => h.name === "prod by kay instrumental 2.mp3"), true);
chk("triage flags the AI track", tri.hits.some((h) => h.name === "suno track 8.mp3"), true);
chk("triage leaves the room tone alone", tri.clean.indexOf("scene 14 room tone.wav") >= 0, true);
chk("triage explains itself", tri.hits[0].why.length > 0, true);
chk("triage on empty input", C.triageFilenames("").total, 0);

/* ---------------------------------------------------------------- loudness verdict */
chk("quiet mix is flagged", C.lufsVerdict(-21.4, -2.6).label, "Quiet");
chk("in range mix passes", C.lufsVerdict(-14, -2.6).level, "go");
chk("loud mix is flagged", C.lufsVerdict(-9, -2.6).label, "Loud");
chk("hot peaks stop the file", C.lufsVerdict(-14, 1.2).level, "stop");
chk("unmeasured audio says so", C.lufsVerdict(null, null).label, "Not measured");

/* ---------------------------------------------------------------- segmentation */
const fps = 43;
function seg(startSec, endSec, label, rms) {
  const out = [];
  for (let t = startSec; t < endSec; t += 1 / fps) {
    out.push({ t: t, label: label, rms: rms, rmsDb: 20 * Math.log10(rms),
      rhythm: label === "music" ? 0.5 : 0.1,
      syll: label === "speech" ? 0.6 : 0.1, flat: 0.1, centroid: 900, width: 0.4, corr: 0.6 });
  }
  return out;
}
const frames = [].concat(
  seg(0, 5, "speech", 0.08), seg(5, 25, "music", 0.2), seg(25, 30, "speech", 0.08),
  seg(30, 50, "music", 0.2), seg(50, 54, "speech", 0.08));
const segs = C.mergeFrames(frames, { minDur: 2.5, smooth: 7 });
const musicSegs = segs.filter((s) => s.type === "music");
chk("two music cues found", musicSegs.length, 2);
near("first cue starts at 5s", musicSegs[0].start, 5, 0.4);
near("first cue ends at 25s", musicSegs[0].end, 25, 0.4);
near("second cue starts at 30s", musicSegs[1].start, 30, 0.4);
chk("music mean level is carried through", musicSegs[0].rmsDb > -15 && musicSegs[0].rmsDb < -12, true);

const shortRuns = [].concat(seg(0, 10, "speech", 0.08), seg(10, 10.6, "music", 0.2), seg(10.6, 20, "speech", 0.08));
chk("a run too short to act on is absorbed", C.mergeFrames(shortRuns, { minDur: 2.5, smooth: 3 }).filter((s) => s.type === "music").length, 0);
chk("mergeFrames on nothing", C.mergeFrames([], {}).length, 0);

/* median filter removes a one frame flicker */
chk("median filter kills a flicker", C.medianFilter(["a", "a", "b", "a", "a"], 3).join(""), "aaaaa");

/* ---------------------------------------------------------------- release likeness */
const relQuiet = C.releaseScore({ start: 0, end: 8, rhythm: 0.1, width: 0.05, rmsDb: -30, flat: 0.4 }, { musicMeanDb: -20 });
const relSong = C.releaseScore({ start: 0, end: 120, rhythm: 0.5, width: 0.6, rmsDb: -12, flat: 0.05 }, { musicMeanDb: -20 });
chk("a sting scores low", relQuiet.score < 25, true);
chk("a full song scores high", relSong.score > 70, true);

/* ---------------------------------------------------------------- dialogue overlap */
const ovl = C.dialogueOverlap({ start: 0, end: 100 },
  [{ type: "speech", start: 0, end: 70 }, { type: "music", start: 0, end: 100 }]);
chk("overlap fraction is measured", ovl.frac, 0.7);
chk("heavy overlap means bedded", ovl.bedded, true);
chk("no speech means exposed", C.dialogueOverlap({ start: 0, end: 100 }, [{ type: "speech", start: 200, end: 300 }]).bedded, false);

/* ---------------------------------------------------------------- classification */
const ctx = { silenceDb: -50 };
chk("silence is silence", C.classifyFrame({ rmsDb: -70, syll: 0.9, rhythm: 0.9 }, ctx), "silence");
chk("syllabic level reads as speech", C.classifyFrame({ rmsDb: -24, syll: 0.7, rhythm: 0.05 }, ctx), "speech");
chk("a stable pulse reads as music", C.classifyFrame({ rmsDb: -20, syll: 0.1, rhythm: 0.6 }, ctx), "music");
chk("a sustained tone is not claimed as music", C.classifyFrame({ rmsDb: -20, syll: 0.2, rhythm: 0.05, flat: 0.05, centroid: 900 }, ctx), "speech");
chk("the middle band reads as mixed", C.classifyFrame({ rmsDb: -30, syll: 0.2, rhythm: 0.2 }, ctx), "mixed");

/* The calibration, as a regression test. These are the measured extremes from
   tests/calibrate.js: 0.293 is the highest tempo stability score seen on real
   spoken word, 0.340 the lowest seen inside a song. Nothing may cross. */
chk("the worst real dialogue frame stays out of music", C.classifyFrame({ rmsDb: -30, syll: 0.1, rhythm: 0.293 }, ctx), "mixed");
chk("the quietest music frame is still music", C.classifyFrame({ rmsDb: -30, syll: 0.5, rhythm: 0.340 }, ctx), "music");
chk("the gate sits inside the measured gap", C.THRESH.rhythmMusic > 0.293 && C.THRESH.rhythmMusic <= 0.340, true);

/* ---------------------------------------------------------------- dsp */
/* A 1000 Hz tone must land in the centroid bin nearest 1000 Hz. */
const sr = 22050;
const tone = new Float32Array(sr);
for (let i = 0; i < sr; i++) tone[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / sr);
const ff = C.frameFeatures(tone, null, sr, 1024, 512);
near("centroid finds a 1000 Hz tone", ff[5].centroid, 1000, 90);
chk("a pure tone is tonal not flat", ff[5].flat < 0.05, true);
chk("frames are produced across the file", ff.length > 40, true);

/* FFT against a naive DFT on a small mixed signal. */
const fft = C.makeFFT(8);
const re = Float64Array.from([1, 2, 3, 4, 4, 3, 2, 1]);
const im = new Float64Array(8);
fft(re, im);
let worst = 0;
for (let k = 0; k < 8; k++) {
  let dr = 0, di = 0;
  const x = [1, 2, 3, 4, 4, 3, 2, 1];
  for (let n = 0; n < 8; n++) {
    dr += x[n] * Math.cos(2 * Math.PI * k * n / 8);
    di -= x[n] * Math.sin(2 * Math.PI * k * n / 8);
  }
  worst = Math.max(worst, Math.abs(re[k] - dr), Math.abs(im[k] - di));
}
chk("FFT matches a naive DFT", worst < 1e-9, true);

/* Decimation averages blocks. */
chk("decimate averages pairs", Array.from(C.decimate(Float32Array.from([1, 2, 3, 4]), 2)).join(","), "1.5,3.5");
chk("decimate by one is a pass through", C.decimate(Float32Array.from([1, 2]), 1).length, 2);

/* Silence detection over the frame list. */
const gaps = C.silentGaps([].concat(seg(0, 10, "music", 0.2), seg(10, 16, "silence", 0.0001), seg(16, 20, "music", 0.2)), 3, ctx);
chk("a long silent stretch is found", gaps.length, 1);
near("silence starts where it starts", gaps[0].start, 10, 0.2);

/* ---------------------------------------------------------------- content guards */
chk("every route has a note and a proof line", C.SOURCES.every((s) => s.note.length > 40 && s.proof.length > 20), true);
chk("every trap has a body", C.TRAPS.every((t) => t.t.length > 4 && t.b.length > 60), true);
chk("every plan has items and a price", C.PLANS.every((p) => p.items.length >= 4 && p.price.length > 0), true);
chk("exactly one recommended plan", C.PLANS.filter((p) => p.rec).length, 1);
chk("no em or en dashes in the copy", C.SOURCES.concat(C.TRAPS, C.PLANS)
  .map((x) => JSON.stringify(x)).join("").match(/[\u2013\u2014]/), null);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
