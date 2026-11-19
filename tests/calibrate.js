// Calibration probe. Runs the app's own feature stage over a WAV and prints the
// numbers per second, plus a frame confusion matrix when a truth spec is given.
//
//   node tests/calibrate.js tests/truth.wav music:8-28,music:36-56,speech:0-8,speech:28-36,silence:56-64
//   node tests/calibrate.js tests/realspeech.wav speech:0-183
//
// Not part of the shipped app.

const fs = require("fs");
const path = require("path");
const C = require("../src/app.js");

function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("not a RIFF file");
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = { ch: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12) };
    if (id === "data") data = { start: pos + 8, size };
    pos += 8 + size + (size % 2);
  }
  const n = Math.floor(data.size / 2 / fmt.ch);
  const L = new Float32Array(n), R = fmt.ch > 1 ? new Float32Array(n) : null;
  for (let i = 0; i < n; i++) {
    L[i] = buf.readInt16LE(data.start + i * 2 * fmt.ch) / 32768;
    if (R) R[i] = buf.readInt16LE(data.start + (i * fmt.ch + 1) * 2) / 32768;
  }
  return { L, R, rate: fmt.rate, ch: fmt.ch };
}

const dec = (x, f) => {
  if (f <= 1) return x;
  const n = Math.floor(x.length / f), o = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < f; k++) s += x[i * f + k]; o[i] = s / f; }
  return o;
};

const file = process.argv[2] || path.join(__dirname, "truth.wav");
const spec = process.argv[3] || "";
const truth = spec.split(",").filter(Boolean).map((p) => {
  const [kind, range] = p.split(":");
  const [a, b] = range.split("-").map(Number);
  return { kind, a, b };
});
const wantAt = (t) => {
  for (const s of truth) if (t >= s.a && t < s.b) return s.kind;
  return null;
};

const w = readWav(file);
const factor = w.rate > 30000 ? 2 : 1;
const L = dec(w.L, factor), R = w.R ? dec(w.R, factor) : null, sr = w.rate / factor;
const dur = L.length / sr;
const fps = dur > 1200 ? 21.5 : 43;
const winSize = 1024, hop = Math.max(128, Math.round(sr / fps));
const fpsReal = sr / hop;
const frames = C.frameFeatures(L, R, sr, winSize, hop);
const env = C.envelopeFeatures(frames, fpsReal);
const db = frames.map((f) => f.rmsDb).slice().sort((a, b) => a - b);
const p90 = db[Math.floor(db.length * 0.9)];
const ctx = { silenceDb: Math.min(C.THRESH.silenceFloor, p90 - C.THRESH.silenceDrop) };
frames.forEach((f) => { f.label = C.classifyFrame(f, ctx); });

console.log("file " + path.basename(file) + "  " + w.rate + " Hz -> " + sr + " Hz  " + dur.toFixed(1) + "s  " + frames.length + " frames  fps " + fpsReal.toFixed(1));
console.log("tempo " + env.tempoBpm + " BPM   p90 " + p90.toFixed(1) + " dB   silence gate " + ctx.silenceDb.toFixed(1) + " dB");

const step = dur > 200 ? 10 : 1;
console.log("\n   t     want     rmsDb   syll  rhythm  stab   flat   crest  cent   label");
for (let t = 0; t < dur; t += step) {
  const inWin = frames.filter((f) => f.t >= t && f.t < t + step);
  if (!inWin.length) continue;
  const m = (k) => inWin.reduce((a, f) => a + f[k], 0) / inWin.length;
  const labels = {};
  inWin.forEach((f) => { labels[f.label] = (labels[f.label] || 0) + 1; });
  const got = Object.keys(labels).sort((a, b) => labels[b] - labels[a])[0];
  const want = wantAt(t) || "-";
  console.log(
    String(t).padStart(4) + "  " + want.padEnd(8) + m("rmsDb").toFixed(1).padStart(7) +
    m("syll").toFixed(3).padStart(7) + m("rhythm").toFixed(3).padStart(8) + m("tempoStable").toFixed(2).padStart(6) +
    m("flat").toFixed(3).padStart(7) + m("crest").toFixed(1).padStart(8) +
    m("centroid").toFixed(0).padStart(6) + "  " + got);
}

if (truth.length) {
  const conf = {};
  frames.forEach((f) => {
    const want = wantAt(f.t);
    if (!want) return;
    const k = want + " -> " + f.label;
    conf[k] = (conf[k] || 0) + 1;
  });
  console.log("\nframe confusion:");
  Object.keys(conf).sort().forEach((k) => console.log("  " + k.padEnd(22) + String(conf[k]).padStart(6)));
  ["music", "speech", "silence"].forEach(function (kind) {
    const v = frames.filter((f) => wantAt(f.t) === kind).map((f) => f.rhythm).sort((a, b) => a - b);
    if (!v.length) return;
    const q = (p) => v[Math.min(v.length - 1, Math.floor(v.length * p))].toFixed(3);
    console.log("  rhythm in " + kind.padEnd(8) + " p10 " + q(.1) + "  p50 " + q(.5) + "  p90 " + q(.9) + "  p99 " + q(.99) + "  max " + v[v.length - 1].toFixed(3));
    const sy = frames.filter((f) => wantAt(f.t) === kind).map((f) => f.syll).sort((a, b) => a - b);
    const q2 = (p) => sy[Math.min(sy.length - 1, Math.floor(sy.length * p))].toFixed(3);
    console.log("  syll   in " + kind.padEnd(8) + " p10 " + q2(.1) + "  p50 " + q2(.5) + "  p90 " + q2(.9) + "  min " + sy[0].toFixed(3));
  });
  const bad = frames.filter((f) => {
    const want = wantAt(f.t);
    if (want === "music") return f.label !== "music";
    if (want === "speech") return f.label === "music";
    return false;
  }).length;
  const tot = frames.filter((f) => wantAt(f.t)).length;
  console.log("\nmusic frames missed plus speech frames called music: " + bad + " of " + tot + " (" + (100 * bad / tot).toFixed(1) + "%)");
  const segs = C.mergeFrames(frames, { minDur: 2.5, smooth: 7 });
  console.log("segments: " + JSON.stringify(segs.map((s) => [s.type, +s.start.toFixed(2), +s.end.toFixed(2)])));
}
