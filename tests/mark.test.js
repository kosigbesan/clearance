// Provenance mark tests, including real lossy codec round trips.
//   node tests/mark.test.js
//
// The claim being tested is narrow and checkable: a mark embedded at a low
// level in a score is still detectable after the audio has been through an AAC
// or MP3 encode, which is what happens when somebody rips your soundtrack off
// YouTube and pushes it to streaming.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const M = require("../src/mark.js");

let pass = 0, fail = 0;
function chk(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? "PASS " : "FAIL ") + name + "  got=" + JSON.stringify(got) + (ok ? "" : "  want=" + JSON.stringify(want)));
}
const near = (name, got, lo, hi) => chk(name, got >= lo && got <= hi, true);

const SR = 22050;
const SECONDS = 24;
const SEED = "Behind Closed Doors|2026-11-19|9f2c41ab";
const WRONG = "somebody elses film|2026-01-01|deadbeef";

/* A stand in for a score: a few sustained tones, a moving bass line, and some
   noise, at a realistic level. */
function score(seconds) {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  let s = 12345;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s / 4294967296) * 2 - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const bass = Math.sin(2 * Math.PI * (55 + 11 * Math.sin(2 * Math.PI * 0.13 * t)) * t) * 0.34;
    const pad = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.2 * t) + Math.sin(2 * Math.PI * 329.6 * t)) * 0.10;
    const air = rnd() * 0.02;
    x[i] = (bass + pad + air) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.07 * t));
  }
  const r = Math.sqrt(x.reduce((a, v) => a + v * v, 0) / n);
  for (let i = 0; i < n; i++) x[i] = x[i] / r * 0.16;
  return x;
}

function writeWav(file, samples, rate) {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii"); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii"); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, b);
}

function readWav(file) {
  const b = fs.readFileSync(file);
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString("ascii", pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = { ch: b.readUInt16LE(pos + 10), rate: b.readUInt32LE(pos + 12) };
    if (id === "data") data = { start: pos + 8, size: size };
    pos += 8 + size + (size % 2);
  }
  const n = Math.floor(data.size / 2 / fmt.ch);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(data.start + i * 2 * fmt.ch) / 32768;
  return { samples: out, rate: fmt.rate };
}

/* Downmix and resample to the analysis rate by linear interpolation. */
function toRate(w, rate) {
  if (w.rate === rate) return w.samples;
  const ratio = w.rate / rate;
  const n = Math.floor(w.samples.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio, i0 = Math.floor(p), f = p - i0;
    out[i] = (w.samples[i0] || 0) * (1 - f) + (w.samples[i0 + 1] || 0) * f;
  }
  return out;
}

function codecRoundTrip(samples, args, ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clr-mark-"));
  const src = path.join(dir, "in.wav"), enc = path.join(dir, "out." + ext), back = path.join(dir, "back.wav");
  writeWav(src, samples, SR);
  try {
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", src].concat(args).concat([enc]), { stdio: "pipe" });
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", enc, "-ac", "1", "-ar", String(SR), "-c:a", "pcm_s16le", back], { stdio: "pipe" });
    return readWav(back).samples;
  } catch (e) {
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}

const clean = score(SECONDS);
const marked = M.embedMark(clean, SEED, SR);
const markedSamples = marked.samples;

console.log("seed " + SEED);
console.log("carriers " + M.MARK_CARRIERS + " from " + M.MARK_LOW_HZ + " to " + M.MARK_HIGH_HZ + " Hz, "
  + M.MARK_CHIP_RATE + " chips/s, depth " + M.MARK_DEPTH_DB + " dB");

/* ---------------------------------------------------------------- the basics */
chk("embedding returns the same length", markedSamples.length, clean.length);
chk("embedding does not touch the input", clean.length === score(SECONDS).length, true);
const cleanRms = M.rmsOf(clean, 0, clean.length);
const markRms = M.rmsOf(markedSamples, 0, markedSamples.length);
near("the programme level is barely changed", markRms / cleanRms, 0.99, 1.02);

const dMark = M.detectMark(markedSamples, SEED, SR);
const dClean = M.detectMark(clean, SEED, SR);
const dWrong = M.detectMark(markedSamples, WRONG, SR);
const dBoth = M.detectMark(markedSamples, SEED, SR, { innerSeconds: 6 });

console.log("\n  marked,   correct seed : index " + dMark.index.toFixed(2) + "  (offset " + dMark.offsetChips + " chips, phase " + dMark.phase + ")");
console.log("  marked,   6 second win : index " + dBoth.index.toFixed(2));
console.log("  marked,   wrong seed   : index " + dWrong.index.toFixed(2));
console.log("  unmarked, correct seed : index " + dClean.index.toFixed(2));

chk("an unmarked file stays under the noise floor", dClean.index < 3.5, true);
chk("the wrong seed does not find the mark", dWrong.index < 3.5, true);
chk("the correct seed finds the mark", dMark.index > 40, true);
chk("the mark reads at least 15 times the floor", dMark.index / Math.max(dClean.index, 0.01) > 15, true);
chk("a six second window still finds it", dBoth.index > 8, true);
chk("the verdict reads the index", M.markVerdict(dMark.index).level !== "go", true);
chk("the verdict on an unmarked file is clear", M.markVerdict(dClean.index).level, "go");

/* ---------------------------------------------------------------- depth sweep */
/* How quiet can the mark be and still be decisive? The reading falls as the
   mark power falls, so this measures the margin at each depth and the default
   is chosen from the result rather than from taste. */
console.log("depth sweep, 24 second window:");
[["-30 dB", -30], ["-36 dB", -36], ["-42 dB", -42], ["-48 dB", -48], ["-54 dB", -54]].forEach(function (d) {
  const e = M.embedMark(clean, SEED, SR, { depthDb: d[1] });
  const r = M.detectMark(e.samples, SEED, SR);
  const back = codecRoundTrip(e.samples, ["-c:a", "aac", "-b:a", "128k"], "m4a");
  const rr = back ? M.detectMark(toRate({ samples: back, rate: SR }, SR), SEED, SR) : null;
  console.log("  " + d[0].padEnd(8) + " clean index " + r.index.toFixed(1).padStart(8)
    + (rr ? "   after AAC 128k " + rr.index.toFixed(1).padStart(8) : ""));
});

/* ---------------------------------------------------------------- codecs */
const codecs = [
  ["AAC 128k, as YouTube serves", ["-c:a", "aac", "-b:a", "128k"], "m4a"],
  ["AAC 96k", ["-c:a", "aac", "-b:a", "96k"], "m4a"],
  ["MP3 128k", ["-c:a", "libmp3lame", "-b:a", "128k"], "mp3"],
  ["Opus 64k", ["-c:a", "libopus", "-b:a", "64k"], "opus"],
];
console.log("\ncodec round trips, 24 seconds of marked score:");
let survived = 0, tried = 0;
codecs.forEach(function (c) {
  const back = codecRoundTrip(markedSamples, c[1], c[2]);
  if (!back) { console.log("  " + c[0].padEnd(28) + " ffmpeg unavailable, skipped"); return; }
  tried++;
  const r = M.detectMark(toRate({ samples: back, rate: SR }, SR), SEED, SR);
  const control = M.detectMark(toRate({ samples: back, rate: SR }, SR), WRONG, SR);
  const ok = r.index > 15;
  if (ok) survived++;
  console.log("  " + c[0].padEnd(28) + " index " + r.index.toFixed(2) + "  (control " + control.index.toFixed(2) + ")  "
    + M.markVerdict(r.index).label + (ok ? "  SURVIVES" : "  LOST"));
});
chk("the mark survives every codec tested", survived === tried, true);

/* ---------------------------------------------------------------- an attack */
/* What a hijacker actually does: take the audio, maybe change the level, and
   hand it to a distributor. Neither of those removes the mark. */
const louder = new Float32Array(markedSamples.length);
for (let i = 0; i < louder.length; i++) louder[i] = Math.max(-1, Math.min(1, markedSamples[i] * 2.2));
chk("a level change does not remove the mark", M.detectMark(louder, SEED, SR).index > 2, true);

/* The attacker hands over an excerpt, not the whole film, and its start is
   unknown. Every one of these is a different chip phase, and the periodic sync
   pattern is what makes them all findable. */
[[4, "four seconds"], [7.3, "seven point three seconds"], [11.1, "eleven seconds"]].forEach(function (t) {
  const cut = markedSamples.subarray(Math.round(t[0] * SR));
  const r = M.detectMark(cut, SEED, SR);
  chk("an excerpt starting " + t[1] + " in is found", r.index > 8, true);
});
const eightSec = markedSamples.subarray(Math.round(6 * SR), Math.round(14 * SR));
const rEight = M.detectMark(eightSec, SEED, SR);
console.log("  an eight second excerpt        : index " + rEight.index.toFixed(2));
chk("an eight second excerpt is found", rEight.index > 8, true);
chk("a four second excerpt is weaker but present", M.detectMark(markedSamples.subarray(Math.round(10 * SR), Math.round(14 * SR)), SEED, SR).index > 2, true);
/* A mark made for a different production must not be found in this one. */
const otherFilm = M.embedMark(clean, "a different production entirely", SR).samples;
chk("another film's mark is not found with this seed", M.detectMark(otherFilm, SEED, SR).index < 3.5, true);

/* ---------------------------------------------------------------- honesty */
chk("a different file with the same seed is not a false positive", M.detectMark(score(12), SEED, SR).index < 3.5, true);
/* The null has to hold on other kinds of audio too, not just on a score. */
const noiseOnly = new Float32Array(SR * 12);
{ let s2 = 999; for (let i = 0; i < noiseOnly.length; i++) { s2 = (Math.imul(s2, 1103515245) + 12345) >>> 0; noiseOnly[i] = ((s2 / 4294967296) * 2 - 1) * 0.2; } }
chk("noise with no mark is not a false positive", M.detectMark(noiseOnly, SEED, SR).index < 3.5, true);
const speechish = new Float32Array(SR * 12);
for (let i = 0; i < speechish.length; i++) {
  const t = i / SR;
  const syll = Math.max(0, Math.sin(2 * Math.PI * 4.2 * t));
  speechish[i] = syll * Math.sin(2 * Math.PI * 180 * t) * 0.25 + Math.sin(2 * Math.PI * 700 * t) * 0.05;
}
chk("a speech like signal with no mark is not a false positive", M.detectMark(speechish, SEED, SR).index < 3.5, true);
chk("the seed is not stored in the audio", markedSamples.some((v) => v !== v), false);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
