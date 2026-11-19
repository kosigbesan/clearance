/* ---------------------------------------------------------------------------
   CLEARANCE provenance marking.

   The problem this solves. Somebody downloads your film, lifts the soundtrack
   off it, pushes that audio to streaming through a distributor, and Content ID
   then claims YOUR film with YOUR music. You cannot stop the download: any
   audio that plays can be captured. What you can do is make the captured audio
   carry proof of where it came from.

   A mark is embedded in the score before it is mixed into the film. It is a
   spread spectrum pattern: eight narrowband carriers between 900 Hz and 5 kHz,
   each phase shift keyed by a chip sequence at 20 chips per second, both
   derived from a seed that belongs to the production. It sits about 44 dB below
   the programme, which is inaudible in a mix.

   Two decisions in here were made from measurement rather than taste, and both
   are explained where they appear:

     the carriers sit in the middle of the spectrum, not up at 16 kHz, because a
     lossy encode throws the top octave away and the mark has to survive one

     the chip sequence repeats every four seconds, because the attacker hands
     you an excerpt, not the whole film, and a one off sequence cannot be lined
     up against an excerpt whose start you do not know

   Detection is a matched filter: demodulate each carrier to baseband, decimate
   to the chip rate, correlate against the known chip sequence at every chip
   phase inside the period, and keep the best. The statistic is normalised so
   that audio with no mark reads a small number and audio carrying the mark
   reads a large one. The floor is not exactly 1.0, because keeping the best of
   a few hundred candidate phases raises it on its own; tests/mark.test.js
   measures the floor at about 2.5 across a score, a noise bed and a speech like
   signal, and the decision threshold sits well above it.

   What this does not do: it does not prevent the extraction, and it does not
   prove ownership in law. It proves that a suspect file carries the same
   pattern that was embedded in your score, which is a strong piece of evidence
   and a very awkward fact for somebody claiming they wrote it.
   ------------------------------------------------------------------------- */

const MARK_CARRIERS = 8;
const MARK_CHIP_RATE = 20;        /* chips per second */
const MARK_LOW_HZ = 900;
const MARK_HIGH_HZ = 5000;
const MARK_DEPTH_DB = -44;        /* relative to the programme RMS */
const MARK_PERIOD_CHIPS = 80;     /* four seconds: the alignment ambiguity */
const MARK_PHASES = 2;            /* sub chip alignment steps, per phase */

function markSeedInt(seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed == null ? "" : seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

function xorshift(x) {
  x = x >>> 0;
  x ^= (x << 13) >>> 0; x = x >>> 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  return x >>> 0;
}

/* Carriers and chips both come from the seed, so a mark made with one seed
   cannot be found with another. */
function markPattern(seed, sr, seconds) {
  let st = markSeedInt(seed);
  const freqs = [], phases = [];
  for (let k = 0; k < MARK_CARRIERS; k++) {
    st = xorshift(st);
    const jitter = ((st % 2000) / 1000 - 1) * 0.01;
    freqs.push(MARK_LOW_HZ * Math.pow(MARK_HIGH_HZ / MARK_LOW_HZ, k / (MARK_CARRIERS - 1)) * (1 + jitter));
    st = xorshift(st);
    phases.push(((st % 1000000) / 1000000) * 2 * Math.PI);
  }
  /* One period of chips, balanced exactly. The sequence is generated once and
     then repeated, so the receiver only has to search the length of one period
     to line up with an excerpt whose start it does not know. */
  const base = new Float32Array(MARK_PERIOD_CHIPS);
  let sum = 0;
  for (let c = 0; c < MARK_PERIOD_CHIPS; c++) {
    st = xorshift(st);
    base[c] = (st & 1) ? 1 : -1;
    sum += base[c];
  }
  /* Force an exact balance. An unbalanced sequence lets any residual DC in the
     demodulated baseband read as a mark. The sum of an even number of plus and
     minus ones is always even, so flipping one chip at a time always reaches
     zero exactly. */
  for (let c = 0; c < MARK_PERIOD_CHIPS && sum !== 0; c++) {
    const want = sum > 0 ? -1 : 1;
    if (base[c] !== want) {
      sum += want - base[c];
      base[c] = want;
    }
  }
  const nChips = Math.max(MARK_PERIOD_CHIPS * 2, Math.ceil((seconds || 1) * MARK_CHIP_RATE) + MARK_PERIOD_CHIPS);
  const chips = new Float32Array(nChips);
  for (let c = 0; c < nChips; c++) chips[c] = base[c % MARK_PERIOD_CHIPS];
  return {
    freqs: freqs, phases: phases, base: base, period: MARK_PERIOD_CHIPS,
    chips: chips, chipRate: MARK_CHIP_RATE, sr: sr,
  };
}

/* The mark waveform on its own, unit RMS. */
function markWave(pat, n) {
  const out = new Float32Array(n);
  const K = pat.freqs.length;
  const cs = new Float64Array(K), ss = new Float64Array(K);
  const cr = new Float64Array(K), ci = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    cs[k] = Math.cos(2 * Math.PI * pat.freqs[k] / pat.sr);
    ss[k] = Math.sin(2 * Math.PI * pat.freqs[k] / pat.sr);
    cr[k] = Math.cos(pat.phases[k]);
    ci[k] = Math.sin(pat.phases[k]);
  }
  const per = 1 / Math.sqrt(K);
  for (let i = 0; i < n; i++) {
    const chip = pat.chips[Math.min(pat.chips.length - 1, Math.floor(i / pat.sr * pat.chipRate))] || 0;
    let v = 0;
    for (let k = 0; k < K; k++) {
      v += ci[k];
      const nr = cr[k] * cs[k] - ci[k] * ss[k];
      const ni = cr[k] * ss[k] + ci[k] * cs[k];
      cr[k] = nr; ci[k] = ni;
    }
    out[i] = chip * v * per;
  }
  return out;
}

function rmsOf(x, from, to) {
  let s = 0;
  const a = from || 0, b = to == null ? x.length : to;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

/* Embed. The depth follows the local programme level in one second blocks, so
   the mark stays under the music rather than under a quiet passage where it
   would be exposed. Returns a new array; the input is not touched. */
function embedMark(samples, seed, sr, opts) {
  opts = opts || {};
  const depth = opts.depthDb == null ? MARK_DEPTH_DB : opts.depthDb;
  const gain = Math.pow(10, depth / 20);
  const n = samples.length;
  const pat = markPattern(seed, sr, n / sr);
  const wave = markWave(pat, n);
  const out = new Float32Array(n);
  const block = Math.max(1024, Math.round(sr));
  let local = 0;
  for (let i = 0; i < n; i++) {
    if (i % block === 0) {
      local = rmsOf(samples, i, Math.min(n, i + block));
      if (local < 1e-6) local = rmsOf(samples, 0, n);
    }
    out[i] = samples[i] + wave[i] * local * gain;
  }
  return { samples: out, pattern: pat, depthDb: depth, rms: rmsOf(out, 0, n) };
}

/* Decimate one carrier to baseband at the chip rate, for one sub phase. */
function basebandFor(samples, pat, k, sr, phase) {
  const hop = sr / pat.chipRate;
  const start = Math.round(phase * hop);
  const nChips = Math.floor((samples.length - start) / hop);
  const I = new Float32Array(Math.max(0, nChips));
  const Q = new Float32Array(Math.max(0, nChips));
  const cs = Math.cos(2 * Math.PI * pat.freqs[k] / sr), ss = Math.sin(2 * Math.PI * pat.freqs[k] / sr);
  let cr = Math.cos(pat.phases[k]), ci = Math.sin(pat.phases[k]);
  let accI = 0, accQ = 0, c = 0, count = 0;
  for (let i = 0; i < start; i++) {
    const nr = cr * cs - ci * ss; ci = cr * ss + ci * cs; cr = nr;
  }
  for (let i = start; i < samples.length; i++) {
    const x = samples[i];
    accI += x * cr;
    accQ += x * ci;
    count++;
    const nr = cr * cs - ci * ss; ci = cr * ss + ci * cs; cr = nr;
    if (count >= hop) {
      if (c < nChips) { I[c] = accI / count; Q[c] = accQ / count; }
      c++; accI = 0; accQ = 0; count = 0;
    }
  }
  return { I: I, Q: Q, n: nChips };
}

/* Correlate one baseband against the chip sequence at one chip phase. */
function correlate(b, base, period, off, from, to) {
  /* De-mean first. Programme energy near a carrier leaves a DC term in the
     demodulated signal, and that term alone can look like a mark. */
  let mI = 0, mQ = 0, n = 0;
  for (let i = from; i < to; i++) {
    if (i >= b.n) break;
    mI += b.I[i]; mQ += b.Q[i]; n++;
  }
  if (!n) return { stat: 0, n: 0 };
  mI /= n; mQ /= n;
  let sr = 0, si = 0, e = 0;
  for (let i = from; i < to; i++) {
    if (i >= b.n) break;
    const ch = base[((i + off) % period + period) % period];
    const iv = b.I[i] - mI, qv = b.Q[i] - mQ;
    sr += iv * ch;
    si += qv * ch;
    e += iv * iv + qv * qv;
  }
  if (!n || e <= 1e-20) return { stat: 0, n: n };
  /* Under the null hypothesis the correlation sum has variance n times the
     baseband power, so this ratio sits near 1 with no mark present and rises
     with one. */
  return { stat: (sr * sr + si * si) / e, n: n };
}

/* Detect. Returns an index; audio with no mark reads about 2.5. */
function detectMark(samples, seed, sr, opts) {
  opts = opts || {};
  const pat = markPattern(seed, sr, samples.length / sr);
  const phases = opts.phases == null ? MARK_PHASES : opts.phases;
  const inner = opts.innerSeconds == null ? 30 : opts.innerSeconds;

  /* Correlate over the middle of the file, so a codec's leading and trailing
     artefacts are out of the window. */
  const hop = sr / pat.chipRate;
  const total = Math.floor(samples.length / hop) - 1;
  const mid = Math.floor(total / 2);
  const half = Math.min(mid, Math.round(inner * pat.chipRate / 2));
  const from = Math.max(0, mid - half), to = Math.min(total, mid + half);

  let best = { index: 0, offset: 0, phase: 0, perCarrier: [] };
  for (let p = 0; p < phases; p++) {
    const bands = [];
    for (let k = 0; k < pat.freqs.length; k++) bands.push(basebandFor(samples, pat, k, sr, p / phases));
    /* Only one period has to be searched, because the sequence repeats. */
    for (let off = 0; off < pat.period; off++) {
      let sum = 0;
      const per = [];
      for (let k = 0; k < bands.length; k++) {
        const c = correlate(bands[k], pat.base, pat.period, off, from, to);
        per.push(c.stat);
        sum += c.stat;
      }
      const index = sum / bands.length;
      if (index > best.index) best = { index: index, offset: off, phase: p, perCarrier: per };
    }
  }
  return {
    index: best.index, offsetChips: best.offset, phase: best.phase,
    perCarrier: best.perCarrier, seed: String(seed), chipRate: pat.chipRate,
    periodSeconds: pat.period / pat.chipRate,
    windowSeconds: (to - from) / pat.chipRate,
    floor: 2.5,
  };
}

/* A plain reading of the number, for the interface. */
function markVerdict(index) {
  if (index == null) return { level: "watch", label: "Not measured" };
  if (index >= 20) return { level: "stop", label: "Mark found, strongly" };
  if (index >= 8) return { level: "watch", label: "Mark present" };
  if (index >= 4) return { level: "watch", label: "Weak, inconclusive" };
  return { level: "go", label: "No mark" };
}

const MARK = {
  MARK_CARRIERS: MARK_CARRIERS, MARK_CHIP_RATE: MARK_CHIP_RATE,
  MARK_LOW_HZ: MARK_LOW_HZ, MARK_HIGH_HZ: MARK_HIGH_HZ, MARK_DEPTH_DB: MARK_DEPTH_DB,
  MARK_PERIOD_CHIPS: MARK_PERIOD_CHIPS, MARK_PHASES: MARK_PHASES, MARK_FLOOR: 2.5,
  markSeedInt: markSeedInt, xorshift: xorshift, markPattern: markPattern, markWave: markWave,
  embedMark: embedMark, detectMark: detectMark, markVerdict: markVerdict,
  basebandFor: basebandFor, correlate: correlate, rmsOf: rmsOf,
};
if (typeof module !== "undefined" && module.exports) module.exports = MARK;
if (typeof globalThis !== "undefined") globalThis.CLRMARK = MARK;
