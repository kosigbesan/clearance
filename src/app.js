/* ============================================================================
   CLEARANCE  ·  pre-upload clearance desk for films going to YouTube
   ----------------------------------------------------------------------------
   Everything in this file runs on the user's own machine. No film, no audio and
   no cue sheet ever leaves the browser. That is a product decision, not a
   technical one: a producer will not hand a finished film to a stranger's
   server, and the analysis is cheap enough to do locally.

   Sections
     1. constants and palettes
     2. small utilities (timecodes, hashing, escaping)
     3. the rights engine (sources, risk, certificate, dispute, triage)
     4. the audio engine (FFT, frame features, envelope features, segmentation)
     5. the technical report (loudness, peaks, mono compatibility)
     6. state and persistence
     7. rendering
     8. wiring
   Pure functions (sections 2, 3, 4) never touch the DOM, so the test harness can
   call them directly.
   ========================================================================== */

/* ------------------------------------------------------------------ 1. constants */

const APP = "clearance";
const VERSION = 1;
const KEY = APP + ".v" + VERSION;

const PALETTES = [
  { id: "ice",  name: "Ice",  ground: "#E7EFF7", card: "#F7FAFD", ink: "#101F2C",
    muted: "#5C7387", hair: "#BECEDD", accent: "#1B5FA8", accentText: "#FFFFFF",
    stop: "#B3321F", watch: "#9A6A12", go: "#1E6B4E" },
  { id: "clay", name: "Clay", ground: "#F3E9E2", card: "#FCF7F3", ink: "#231812",
    muted: "#7A6558", hair: "#DCC9BC", accent: "#9C3B1B", accentText: "#FFFFFF",
    stop: "#A82A1E", watch: "#8E6412", go: "#2A5B42" },
  { id: "ink",  name: "Ink",  ground: "#0F1A22", card: "#17242E", ink: "#EAF2F8",
    muted: "#8FA6B6", hair: "#2C3D4A", accent: "#5FB2F0", accentText: "#08131A",
    stop: "#FF7A5C", watch: "#E9C15B", go: "#6FD3A2" },
];

/* Where a cue came from. `base` is the raw exposure of that route to a claim,
   0 to 100, before any paperwork is considered. These are editorial judgements
   built from the documented failure modes in the field, not measurements. */
const SOURCES = [
  { id: "score", label: "Original score, work for hire", short: "Original score", base: 12,
    proof: "Signed composer agreement with an assignment or work for hire clause, plus delivery of the stems.",
    note: "The cleanest route on the board. Get the assignment in writing, and register the score yourself before the film goes public." },
  { id: "licensed", label: "Licensed commercial track", short: "Licensed commercial track", base: 30,
    proof: "A signed sync licence that names this production, the territory, the term, and YouTube.",
    note: "A sync licence is not an exemption from Content ID. Ask the licensor to whitelist your channel, or expect a claim you have to dispute with the licence attached." },
  { id: "stock", label: "Stock or subscription library", short: "Stock or subscription library", base: 38,
    proof: "The licence PDF, the plan that was active on the edit date, and the channel name the licence covers.",
    note: "Check that the plan covers YouTube monetisation and that your channel is registered on it. A stock claim is the easiest kind to beat, if the invoice still exists." },
  { id: "ytal", label: "YouTube Audio Library", short: "YouTube Audio Library", base: 14,
    proof: "A screenshot of the track page, plus the attribution text if the track requires it.",
    note: "YouTube states that Audio Library music is copyright safe. Keep the attribution line, and know that a small number of these tracks have been claimed by third parties." },
  { id: "ai", label: "AI generated (Suno, Udio and similar)", short: "AI generated", base: 62,
    proof: "The generation date, the plan tier, and the receipt. Paid tiers grant commercial use.",
    note: "Two traps. Your own track can be claimed by somebody else's earlier, similar generation, and most distributors will not register AI audio with Content ID, so you cannot pre-empt a hijacker. Keep the generation receipts and export the stems." },
  { id: "reuse", label: "Reused from an earlier film of yours", short: "Reused from an earlier film", base: 66,
    proof: "The original agreement, plus a check that the track is not already claimed on the earlier film.",
    note: "If an earlier film was claimed on this track, this film will be claimed too. Open the earlier film's Copyright column before you upload." },
  { id: "live", label: "Live performance in shot (choir, DJ, band, karaoke)", short: "Live performance in shot", base: 71,
    proof: "A clearance from the publisher of the composition, not from the performers.",
    note: "The recording may be yours. The composition is not. Content ID matches live versions, covers, and heavily altered audio." },
  { id: "beatlease", label: "Beat on a non-exclusive lease", short: "Non-exclusive beat lease", base: 74,
    proof: "The invoice, the lease terms, and written confirmation that the beat is not registered with Content ID.",
    note: "Content ID cannot read a licence. If the producer or their distributor registered the beat, you get claimed even though you paid in full. Ask for the lease to state that the beat is not registered, or buy exclusive." },
  { id: "bleed", label: "Radio, TV or a phone speaker inside the scene", short: "Radio or TV inside the scene", base: 79,
    proof: "None that works. The broadcast is a registered recording.",
    note: "Not fixable by swapping a track. You must mute that moment or reshoot it. This also covers a match commentary, a shop radio, and a ringtone in shot." },
  { id: "free", label: "'No copyright' free download site", short: "'No copyright' download", base: 82,
    proof: "A screenshot of a download page is not a licence. You need terms that grant commercial sync rights.",
    note: "The single biggest cause of claims on YouTube. These sites frequently upload other people's music and label it free." },
  { id: "editor", label: "Editor's own sound folder, origin unknown", short: "Editor's folder, unknown", base: 88,
    proof: "Nothing you can produce, because nobody can name the source.",
    note: "This is the failure in most Nollywood takedowns. If the folder cannot be traced to a licence, treat every file in it as claimed." },
];

const SOURCE_BY_ID = {};
SOURCES.forEach(function (s) { SOURCE_BY_ID[s.id] = s; });

/* Filename tokens that give a downloaded third party track away. The editor's
   folder is where most of these arrive from. */
const RED_FLAGS = [
  { re: /\btype\s?beat\b/i, why: "'type beat' means the beat belongs to a producer who sells it to many people at once. Non-exclusive, and very often registered." },
  { re: /\bprod\.?\s*(by)?\s*[a-z0-9]/i, why: "A producer credit in the filename means somebody else owns the master." },
  { re: /\bno\s?copyright\b|\bcopyright\s?free\b|\broyalty\s?free\b|\bfree\s?download\b|\bfree\s?beat\b/i, why: "The phrase in the filename is a claim by an uploader, not a licence from the owner." },
  { re: /\bncs\b|\bno\s?copyright\s?sounds\b/i, why: "NCS releases are licensed to channels on condition, and a subset has been claimed. Keep the terms." },
  { re: /\bsuno\b|\budio\b|\belev?en\s?labs\b|\bmureka\b|\bboomy\b/i, why: "AI generated. Your own track can be claimed by an earlier, similar generation, and most distributors will not register it for you." },
  { re: /\bpixabay\b|\bbensound\b|\bfesliyan\b|\bkevin\s?mac\s?leod\b|\bincompetech\b/i, why: "Free libraries where the licence terms vary by track and attribution is often required." },
  { re: /\binstrumental\b|\bkaraoke\b|\bcover\b|\bref\b|\bversion\b/i, why: "Instrumental or cover versions are the classic false comfort. The composition is still owned by the publisher." },
  { re: /\bfrom\s+youtube\b|\byoutube\b|\bdownloaded\b|\bdowload\b|\bmp3\s?converter\b|\by2mate\b|\bssyoutube\b/i, why: "Downloaded from a platform. There is no licence attached to a rip." },
  { re: /\bsoundcloud\b|\bspotify\b|\bapple\s?music\b|\bboomplay\b|\baudiomack\b/i, why: "A streaming platform is not a source of rights. A rip from one is the clearest possible claim." },
  { re: /\bwav\s?\(\d\)|copy\s?of|\bcopy\b|\bfinal\s?final\b|\b2\b/i, why: "Duplicated files. Check which version the editor actually used, and clear the one in the cut." },
];

/* The trap list, kept short enough to be read. */
const TRAPS = [
  { t: "A claim is not a strike", b: "A Content ID claim takes the money from that video, or blocks it. A strike is a legal notice that threatens the channel. Three strikes in 90 days ends the channel. Producers treat a claim as a strike and panic, then take the film down and lose the views as well as the revenue." },
  { t: "YouTube will not stop you for copyright", b: "The upload flow runs a copyright check, but the warning screen before publishing only appears for ad suitability. YouTube will let you publish with a claim pending, and it will let you publish while the check is still running. That is how a film goes live and is demonetised the next morning." },
  { t: "A clean check is not final", b: "YouTube says so itself. Future manual claims, later Content ID matches and edits to your video settings can all change the result. A clean scan is a starting position, not a certificate." },
  { t: "Dispute inside five days", b: "If you dispute within five days of the claim, revenue is held from the first day the claim was placed. Dispute later and the hold starts from the dispute date, so the earlier money is simply gone. The clock is worth money." },
  { t: "Nobody disputes with proof", b: "YouTube lists what is not a valid reason to dispute: giving credit, owning a copy, using only a few seconds, changing the speed, and not monetising. You need a rights basis and the document that shows it. Most producers have neither, so they lose by default." },
  { t: "The hijack is the fast growing risk", b: "The pattern in the Nigerian cases is not a producer using somebody's song. It is a stranger extracting the film's own soundtrack, pushing it to streaming through a distributor, and letting Content ID claim the film. Registering your own score first is the only real defence." },
  { t: "Fixing one sound does not fix the film", b: "Each new edit is a new file with a new fingerprint, so it gets scanned from scratch. Fixing the audio means a fresh upload, which means the view count, the watch time and the algorithm history start again. This is why the scan belongs before the first upload, not after the first claim." },
  { t: "Muting only works when the music is alone", b: "If the claimed music sits under dialogue, you cannot mute it without killing the dialogue, and you cannot replace it without re-editing the scene. Whether a cue is exposed or bedded decides whether a claim costs you a click or the whole film." },
  { t: "Your own registration will claim you", b: "If you do register your score with a distributor, your own channel must be allowlisted, or your next upload gets claimed by yourself. This is a documented and very confusing way to lose a day." },
];

const PLANS = [
  { id: "desk", name: "Desk", price: "Free", per: "always",
    who: "One producer, one film at a time",
    line: "The scan, the cue sheet, the certificate and the dispute pack. The analysis runs on your machine, so it costs us nothing to give away, and a producer who clears one film tells the next producer.",
    items: ["Unlimited scans of one film", "Cue sheet with timecodes and stills", "Clearance certificate", "Dispute statement builder", "Everything stays on your device"] },
  { id: "studio", name: "Studio", price: "N15,000", per: "per month, or $9",
    who: "A production company releasing monthly",
    line: "The desk, plus a vault. Every certificate is stored with its file hash and a timestamp, so a claim that lands in two years is answered in minutes instead of weeks.",
    items: ["Unlimited films and editors", "Evidence vault with file hashes", "Editor folder triage on every drop", "Three seats", "Release calendar with the scan gate"],
    rec: true },
  { id: "house", name: "House", price: "N60,000", per: "per month, or $39",
    who: "A channel or production house with a slate",
    line: "Sits at the point where the money actually leaves. A film cannot be scheduled until every cue has a declared source, and the certificate carries the house mark.",
    items: ["Ten seats, roles and approvals", "Publishing gate on the release calendar", "White label certificate", "API for your aggregator", "Quarterly exposure report across the slate"] },
  { id: "title", name: "Per title", price: "$3", per: "per film, for aggregators",
    who: "Aggregators, channel managers and distributors",
    line: "The aggregator carries the strike risk on the channel, so the aggregator is the natural buyer. Charged per title at intake, before the file is accepted onto the network.",
    items: ["Bulk intake, charged per title", "Reject or hold before publishing", "Portfolio view of claims by title", "Bespoke to your intake process"] },
];

/* Classifier thresholds, measured rather than guessed. Over the calibration
   set (tests/truth.wav, and 183 seconds of real spoken word from a phone
   video) the tempo stability score reaches 0.29 at its highest on dialogue and
   starts at 0.34 on music, so the gate sits at 0.30, inside the gap. See
   BRIEFING.md for the percentiles behind each number. */
const THRESH = {
  silenceFloor: -42,
  silenceDrop: 26,
  rhythmMusic: 0.30,
  rhythmWeak: 0.14,
  syllSpeech: 0.34,
  flatTonal: 0.16,
  centroidLo: 120,
  centroidHi: 5200,
};

const AUDIT = {
  lufsTarget: -14,
  peakCeiling: -1.0,
  lufsTolerance: 2.0,
};

/* ------------------------------------------------------------------ 2. utilities */

function pad2(n) { return (n < 10 ? "0" : "") + n; }

/* Seconds to a YouTube style timecode. Under an hour: 4:07. Over an hour: 1:04:07. */
function fmtTime(sec) {
  if (sec == null || isNaN(sec) || sec < 0) return "0:00";
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? h + ":" + pad2(m) + ":" + pad2(s) : m + ":" + pad2(s);
}

/* Long form, for a report: 1h 04m 07s */
function fmtLong(sec) {
  if (sec == null || isNaN(sec)) return "0s";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const out = [];
  if (h) out.push(h + "h");
  if (m || h) out.push(pad2(m) + "m");
  out.push(pad2(s) + "s");
  return out.join(" ");
}

/* Accepts 1:04:07, 62:07, 3727, 14.22 or 1h04m. Returns seconds, or null. */
function parseTimecode(str) {
  if (str == null) return null;
  let t = String(str).trim().toLowerCase();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  t = t.replace(/^(\d+)h/, "$1:");
  t = t.replace(/(\d+)m/g, "$1:");
  t = t.replace(/s\b/g, "");
  t = t.replace(/[^\d:.]/g, "");
  if (!t) return null;
  const parts = t.split(":").filter(function (p) { return p !== ""; });
  if (!parts.length) return null;
  let sec = 0;
  for (let i = 0; i < parts.length; i++) {
    const v = parseFloat(parts[i]);
    if (isNaN(v)) return null;
    sec = sec * 60 + v;
  }
  return sec;
}

function bytesLabel(n) {
  if (n == null) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)) + " " + u[i];
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/* SHA-256 of an ArrayBuffer, as hex. Used for the evidence pack. */
async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  const b = new Uint8Array(d);
  let s = "";
  for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
  return s;
}

function nowStamp(d) {
  d = d || new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00");
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

/* ------------------------------------------------------------------ 3. rights engine */

/* Risk for one cue. Returns a level, a score, and the reasons in plain words. */
function riskFor(decl, film) {
  decl = decl || {};
  film = film || {};
  const src = SOURCE_BY_ID[decl.source] || SOURCE_BY_ID.editor;
  let score = src.base;
  const reasons = [];

  if (decl.proof === "none") {
    score += 9;
    reasons.push("No paperwork on file. A dispute needs a rights basis, and 'I paid for it' is not one.");
  } else if (decl.proof === "part") {
    score += 4;
    reasons.push("Proof is partial. A receipt shows a purchase, not a licence that covers YouTube.");
  } else if (decl.proof === "full") {
    score -= 12;
  }

  if (decl.underDialogue) {
    score += 11;
    reasons.push("The music runs under dialogue, so a claim here cannot be muted out. It has to be replaced, which means a new edit and a fresh scan.");
  }
  if (decl.cid === true) {
    score += 16;
    reasons.push("This audio is registered with Content ID, so a match is close to certain. If it is not yours, plan the replacement now.");
  } else if (decl.cid === "unsure") {
    score += 8;
    reasons.push("Nobody knows whether this audio is registered. Treat unknown as registered until the producer confirms it in writing.");
  }
  if (decl.registration === "someone") {
    /* An existing third party registration is not a risk to weigh, it is a
       decision already taken by somebody else about your film. */
    score = Math.max(score + 14, 72);
    reasons.push("A third party has already registered this audio. Uploading it as it stands hands them the revenue on the whole film.");
  }
  if (decl.exposed === false) { /* handled by underDialogue */ }
  if (decl.licenceScope === "narrow") {
    score += 8;
    reasons.push("The licence does not clearly cover YouTube monetisation for this channel. That gap is where stock claims come from.");
  }

  /* The unregistered score is a fact about the film, not about the cue, so it
     raises every score but is stated once at the top of the scan instead of
     repeated under every cue. */
  if (film.scoreRegistered === false) score += 5;
  if (src.id === "editor") {
    reasons.push("No name, no invoice, no terms. This is the route that took the film down in the case this tool was built for.");
  }
  if (src.id === "free") {
    reasons.push("Sites that label music free are not the owner. They are the most common origin of a claim on a Nigerian film.");
  }
  if (src.id === "bleed") {
    reasons.push("There is no document that fixes this one. The only fix is silence at that moment, or a different take.");
  }
  if (src.id === "live") {
    reasons.push("The publisher owns the composition even where you own the recording. Performers cannot grant you the rights.");
  }
  if (src.id === "ai" && decl.cid !== true) {
    reasons.push("AI audio is usually not in Content ID as your reference, so you cannot pre-empt a hijacker with your own claim. Keep the generation receipts.");
  }
  if (decl.proof === "full" && src.base <= 40) {
    reasons.push("You hold the document. Keep it attached to this cue: this is the kind of claim you win.");
  }

  score = clamp(Math.round(score), 0, 100);
  let level = "go";
  if (score >= 62) level = "stop";
  else if (score >= 34) level = "watch";
  return { score: score, level: level, reasons: reasons, source: src };
}

const LEVEL_LABEL = { go: "Clear", watch: "Check", stop: "Stop" };

/* One line a producer can act on. */
function verdictLine(cue, risk) {
  if (risk.level === "stop") {
    if (cue.underDialogue) return "Replace it. This one cannot be muted out.";
    return "Replace it or cut it before upload.";
  }
  if (risk.level === "watch") return "Keep the paperwork with the film, and check the Copyright column after upload.";
  return "Leave it. Keep the document with the certificate.";
}

/* Whole film exposure summary. */
function filmSummary(cues, film) {
  film = film || {};
  const counts = { go: 0, watch: 0, stop: 0 };
  let worst = null, musicSec = 0, bedded = 0;
  (cues || []).forEach(function (c) {
    const r = riskFor(c, film);
    counts[r.level]++;
    if (!worst || r.score > riskFor(worst, film).score) worst = c;
    musicSec += (c.end - c.start);
    if (c.underDialogue) bedded++;
  });
  let band = "go";
  if (counts.stop > 0) band = "stop";
  else if (counts.watch > 0) band = "watch";
  const undecided = (cues || []).filter(function (c) { return !c.source; }).length;
  return {
    counts: counts, band: band, worst: worst, undecided: undecided,
    musicSec: musicSec, bedded: bedded, total: (cues || []).length,
    hijack: film.scoreRegistered === false,
    headline: counts.stop > 0
      ? counts.stop + " cue" + (counts.stop > 1 ? "s" : "") + " will be claimed"
      : (undecided > 0 ? undecided + " cue" + (undecided > 1 ? "s" : "") + " still undeclared"
        : (counts.watch > 0 ? counts.watch + " cue" + (counts.watch > 1 ? "s" : "") + " to keep paperwork on" : "Nothing on the board will be claimed")),
  };
}

/* A claim arrives. Which cue is it? */
function cueAt(seconds, cues) {
  if (seconds == null || !cues || !cues.length) return null;
  let best = null, bestGap = Infinity;
  cues.forEach(function (c) {
    if (seconds >= c.start - 1 && seconds <= c.end + 1) {
      if (!best) best = c;
    }
    const mid = (c.start + c.end) / 2;
    const gap = Math.abs(mid - seconds);
    if (gap < bestGap) { bestGap = gap; best = c; }
  });
  return best;
}

/* Pull the useful facts out of a pasted claim email or Studio notice. */
function parseClaimText(text) {
  const out = { times: [], claimant: "", asset: "", policy: "" };
  if (!text) return out;
  const t = String(text).replace(/\s+/g, " ");
  const timeRe = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g;
  let m;
  while ((m = timeRe.exec(t)) !== null) {
    const sec = parseTimecode(m[1]);
    if (sec != null) out.times.push({ text: m[1], sec: sec });
  }
  const who = t.match(/(?:claimant|claim by|owner|on behalf of|from)[:\s]+([A-Za-z][\w'&.\- ]{2,48})/i);
  if (who) out.claimant = who[1].replace(/[.,;:\s]+$/, "").trim();
  const asset = t.match(/(?:asset|track|song|title|content)[:\s]+[\u201c"']?([^"\u201d'\n]{3,60})/i);
  if (asset) out.asset = asset[1].trim();
  if (/block(ed)?/i.test(t)) out.policy = "blocked";
  else if (/monetis|monetiz/i.test(t)) out.policy = "monetised by the claimant";
  else if (/\btrack/i.test(t)) out.policy = "tracked only";
  return out;
}

/* The dispute statement. Structured the way a claimant's reviewer reads it:
   what is matched, who we are, what our rights basis is, what proves it. */
function buildDispute(claim, cue, film) {
  claim = claim || {};
  film = film || {};
  const src = cue && cue.source ? SOURCE_BY_ID[cue.source] : null;
  const stamp = claim.matchTime || (cue ? fmtTime(cue.start) + " to " + fmtTime(cue.end) : "[timestamp]");
  const lines = [];
  lines.push("DISPUTE OF CONTENT ID CLAIM");
  lines.push("");
  lines.push("Video: " + (film.name || "[your film title]") + " (" + (film.channel || "[your channel]") + ")");
  lines.push("Matched segment: " + stamp + "  (duration " + (cue ? fmtLong(cue.end - cue.start) : "[duration]") + ")");
  if (claim.claimant) lines.push("Claimant shown by YouTube: " + claim.claimant);
  if (claim.asset) lines.push("Claimed asset as shown by YouTube: " + claim.asset);
  lines.push("");
  lines.push("BASIS FOR DISPUTE");
  if (claim.basis === "own") {
    lines.push("I am the owner of the material identified in this claim. The audio at the matched segment is part of the original score of this film, created for this production, and I control the rights in it.");
  } else if (claim.basis === "licence") {
    lines.push("I hold a licence that covers this use. The matched audio is " +
      (src ? src.label.toLowerCase() : "[describe the material]") +
      " used under a licence that permits use in this production on YouTube, and I can supply the licence.");
  } else if (claim.basis === "wrong") {
    lines.push("The claim identifies the wrong material. The audio at the matched segment is not the work named in the claim, and the match appears to be a false positive against a shared or similar sounding source.");
  } else {
    lines.push("The material identified in this claim is used with the necessary rights for this production, as set out below.");
  }
  lines.push("");
  lines.push("EVIDENCE");
  const ev = [];
  ev.push("Clearance certificate for this film, listing every music cue with its source, licence and supplier.");
  if (film.hash) ev.push("SHA-256 hash of the released file, recorded before upload: " + film.hash);
  if (film.lockedAt) ev.push("Date the picture was locked and the file hashed: " + film.lockedAt + ".");
  if (src && cue.proofRef) ev.push("Proof for this cue (" + src.label + "): " + cue.proofRef);
  else if (src) ev.push("Proof for this cue, route: " + src.label + ". " + src.proof);
  if (cue && cue.supplier) ev.push("Supplier of this cue: " + cue.supplier + ".");
  ev.forEach(function (e, i) { lines.push("  " + (i + 1) + ". " + e); });
  lines.push("");
  lines.push("NOT RELIED ON");
  lines.push("This dispute does not rest on credit given, on possession of a copy, on the length of the segment, or on the video being unmonetised. Each of those is a weak basis and none of them is offered here.");
  lines.push("");
  lines.push("REQUEST");
  lines.push("Please review the attached evidence and release this claim.");
  return lines.join("\n");
}

/* Printable certificate. This is the document that goes into the dispute. */
function buildCertificate(cues, film, tech) {
  film = film || {};
  const L = [];
  L.push("CLEARANCE CERTIFICATE");
  L.push("");
  L.push("Film        " + (film.name || "[untitled]"));
  L.push("Channel     " + (film.channel || "[not set]"));
  L.push("Duration    " + (film.duration ? fmtLong(film.duration) : "[unknown]"));
  L.push("File hash   " + (film.hash || "[not hashed]"));
  L.push("Locked      " + (film.lockedAt || "[not locked]"));
  L.push("Issued      " + nowStamp());
  L.push("Engine      CLEARANCE v" + VERSION + ", analysis run on the producer's own machine");
  L.push("");
  L.push("MUSIC CUE SCHEDULE");
  L.push("");
  const rows = (cues || []).slice().sort(function (a, b) { return a.start - b.start; });
  if (!rows.length) {
    L.push("  No music cues were detected in this cut.");
  } else {
    rows.forEach(function (c, i) {
      const r = riskFor(c, film);
      const src = c.source ? SOURCE_BY_ID[c.source] : null;
      L.push("  " + pad2(i + 1) + "  " + fmtTime(c.start) + " to " + fmtTime(c.end) +
        "  " + fmtLong(c.end - c.start) +
        "  " + LEVEL_LABEL[r.level].toUpperCase() + " (" + r.score + "/100)");
      L.push("      route      " + (src ? src.label : "NOT DECLARED"));
      if (c.supplier) L.push("      supplied   " + c.supplier);
      if (c.proofRef) L.push("      proof      " + c.proofRef);
      L.push("      position   " + (c.underDialogue ? "under dialogue, cannot be muted out" : "exposed, can be muted or trimmed"));
      L.push("");
    });
  }
  L.push("TECHNICAL");
  L.push("  Integrated loudness   " + (tech && tech.lufs != null ? tech.lufs.toFixed(1) + " LUFS" : "not measured"));
  L.push("  Sample peak           " + (tech && tech.peak != null ? tech.peak.toFixed(1) + " dBFS" : "not measured"));
  L.push("  Stereo correlation    " + (tech && tech.corr != null ? tech.corr.toFixed(2) : "not measured"));
  L.push("");
  L.push("DECLARATION");
  L.push("  The producer named above declares that every music cue in this schedule is either");
  L.push("  owned by this production or used under a licence that covers YouTube distribution");
  L.push("  and monetisation for the channel named above, and that the proof listed for each");
  L.push("  cue exists and can be produced on request.");
  L.push("");
  L.push("  Signed ______________________     Date ______________________");
  return L.join("\n");
}

/* Export the cue sheet as CSV for the editor, the aggregator or a lawyer. */
function csvFor(cues, film) {
  film = film || {};
  const head = ["no", "start", "end", "seconds", "route", "supplier", "proof", "position", "risk", "score", "verdict"];
  const out = [head.join(",")];
  (cues || []).slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (c, i) {
    const r = riskFor(c, film);
    const src = c.source ? SOURCE_BY_ID[c.source] : null;
    const row = [
      i + 1, fmtTime(c.start), fmtTime(c.end), (c.end - c.start).toFixed(1),
      src ? src.label : "NOT DECLARED", c.supplier || "", c.proofRef || "",
      c.underDialogue ? "under dialogue" : "exposed",
      LEVEL_LABEL[r.level], r.score, verdictLine(c, r),
    ].map(function (v) {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    });
    out.push(row.join(","));
  });
  return out.join("\n");
}

/* Triage a pasted folder listing from the editor. */
function triageFilenames(text) {
  const lines = String(text || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  const hits = [], clean = [];
  lines.forEach(function (line) {
    const name = line.replace(/^.*[\\/]/, "");
    const found = [];
    RED_FLAGS.forEach(function (f) { if (f.re.test(name)) found.push(f.why); });
    if (found.length) hits.push({ name: name, why: found });
    else clean.push(name);
  });
  const audio = lines.filter(function (l) { return /\.(mp3|wav|m4a|aac|flac|ogg|aif|aiff)$/i.test(l); });
  return { total: lines.length, audio: audio.length, hits: hits, clean: clean };
}

/* Loudness verdict against how YouTube plays things back. */
function lufsVerdict(lufs, peak) {
  const notes = [];
  let level = "go", label = "In range";
  if (lufs == null) return { level: "watch", label: "Not measured", notes: ["No audio was decoded, so loudness was not measured."] };
  const d = lufs - AUDIT.lufsTarget;
  if (d < -AUDIT.lufsTolerance) {
    level = "watch"; label = "Quiet";
    notes.push("YouTube turns loud uploads down but does not turn quiet ones up. At " + lufs.toFixed(1) + " LUFS this film will play " +
      Math.round(-d) + " LU quieter than a film mixed to " + AUDIT.lufsTarget + " LUFS, which reads as thin on a phone next to the competition.");
  } else if (d > AUDIT.lufsTolerance) {
    level = "watch"; label = "Loud";
    notes.push("At " + lufs.toFixed(1) + " LUFS this is above the level YouTube plays back at. The loudness will be turned down and the peaks will lose their punch. No penalty, but no gain either.");
  } else {
    notes.push("At " + lufs.toFixed(1) + " LUFS this sits where YouTube plays back, so the mix will not be altered on the platform.");
  }
  if (peak != null && peak > AUDIT.peakCeiling) {
    level = "stop"; label = "Peaks too hot";
    notes.push("Sample peak is " + peak.toFixed(1) + " dBFS. YouTube asks for peaks no higher than " + AUDIT.peakCeiling.toFixed(1) +
      " dBFS, and anything above 0 clips after lossy encoding. Leave headroom before upload.");
  }
  return { level: level, label: label, notes: notes };
}

/* ------------------------------------------------------------------ 4. audio engine */

function makeFFT(n) {
  const levels = Math.round(Math.log2(n));
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos(2 * Math.PI * i / n);
    sin[i] = Math.sin(2 * Math.PI * i / n);
  }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i, r = 0;
    for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  return function (re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half, c = cos[k], s = sin[k];
          const tr = re[l] * c + im[l] * s, ti = -re[l] * s + im[l] * c;
          re[l] = re[j] - tr; im[l] = im[j] - ti;
          re[j] += tr; im[j] += ti;
        }
      }
    }
  };
}

/* Box decimation. Good enough to halve the work, and it also low passes, which
   keeps the higher bands from folding back into the features. */
function decimate(src, factor) {
  if (factor <= 1) return src;
  const n = Math.floor(src.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const o = i * factor;
    for (let k = 0; k < factor; k++) s += src[o + k];
    out[i] = s / factor;
  }
  return out;
}

/* Frame level features. Speech and music separate on four things: how much the
   level wobbles at syllable rate, how periodic the onsets are, how tonal the
   spectrum is, and how wide the stereo image is. */
function frameFeatures(L, R, sr, winSize, hop) {
  const fft = makeFFT(winSize);
  const half = winSize >> 1;
  const re = new Float64Array(winSize), im = new Float64Array(winSize);
  const pow = new Float64Array(half + 1);
  const win = new Float64Array(winSize);
  for (let i = 0; i < winSize; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (winSize - 1));
  const prev = new Float64Array(half + 1);
  /* Flatness is only meaningful on an averaged spectrum. A single periodogram
     of noise is exponentially distributed, so its geometric mean sits far below
     its arithmetic mean and noise reads as tonal. Averaging four frames fixes
     that, and it costs one running sum. */
  const K = 4;
  const ring = [];
  for (let k = 0; k < K; k++) ring.push(new Float64Array(half + 1));
  let ringI = 0, ringN = 0;
  const sumSpec = new Float64Array(half + 1);
  const binHz = sr / winSize;
  const frames = [];
  const n = L.length;
  let idx = 0;
  while (idx + winSize <= n) {
    let sum2 = 0, zc = 0, prevS = 0, l2 = 0, r2 = 0, lr = 0;
    for (let i = 0; i < winSize; i++) {
      const s = L[idx + i];
      sum2 += s * s;
      if ((s >= 0) !== (prevS >= 0)) zc++;
      prevS = s;
      re[i] = s * win[i];
      im[i] = 0;
      if (R) {
        const t = R[idx + i];
        l2 += s * s; r2 += t * t; lr += s * t;
      }
    }
    fft(re, im);
    let sp = 0, csum = 0, pmax = 0, flux = 0;
    for (let k = 1; k <= half; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      pow[k] = p;
      sp += p;
      csum += (k * binHz) * p;
      if (p > pmax) pmax = p;
      if (p > prev[k]) flux += p - prev[k];
    }
    for (let k = 1; k <= half; k++) prev[k] = pow[k];

    const old = ring[ringI];
    for (let k = 1; k <= half; k++) sumSpec[k] += pow[k] - old[k];
    old.set(pow.subarray(0, half + 1));
    ringI = (ringI + 1) % K;
    if (ringN < K) ringN++;
    let asum = 0, logsum = 0, amax = 0;
    for (let k = 1; k <= half; k++) {
      /* The running sum drifts a hair below zero once the window slides over
         silence, and a negative value under a log poisons every later frame
         with NaN. Clamp it. */
      const a = Math.max(0, sumSpec[k] / ringN);
      asum += a;
      logsum += Math.log(a + 1e-15);
      if (a > amax) amax = a;
    }
    const mean = asum / half;
    const geo = Math.exp(logsum / half);
    let roll = 0, acc = 0;
    for (let k = 1; k <= half; k++) { acc += pow[k]; if (acc >= 0.85 * sp) { roll = k * binHz; break; } }
    let corr = 1;
    if (R && l2 > 1e-12 && r2 > 1e-12) corr = lr / Math.sqrt(l2 * r2);
    frames.push({
      t: idx / sr,
      rms: Math.sqrt(sum2 / winSize),
      centroid: sp > 1e-12 ? csum / sp : 0,
      flat: mean > 1e-15 ? geo / mean : 0,
      crest: mean > 1e-15 ? amax / mean : 0,
      roll: roll,
      zcr: zc / winSize,
      flux: sp > 1e-12 ? flux / sp : 0,
      corr: corr,
      width: clamp(1 - corr, 0, 2),
    });
    idx += hop;
  }
  return frames;
}

/* Envelope level features. Two questions are asked of the level envelope: does
   it wobble at syllable rate, and are its onsets periodic? The first is
   answered by a windowed DFT of the envelope across the 3 to 8 Hz band, which
   is where syllables live. The second is answered by the autocorrelation of the
   onset envelope across the range of musical tempo, 60 to 190 BPM. A fixed
   amplitude modulation would answer both wrongly, which is why the window is
   Hann shaped and the band starts above the beat. */
function envelopeFeatures(frames, fps) {
  const n = frames.length;
  const rms = new Float64Array(n), flux = new Float64Array(n);
  for (let i = 0; i < n; i++) { rms[i] = frames[i].rms; flux[i] = frames[i].flux; }

  /* Syllabic modulation: energy between 3 and 8 Hz, over the energy below the
     Nyquist of the envelope. Speech is high here, a sustained bed is near zero. */
  const SW = Math.max(3, Math.round(fps * 1.6));
  const slow = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - SW); j <= Math.min(n - 1, i + SW); j++) { s += rms[j]; c++; }
    slow[i] = s / c;
  }
  const NW = Math.max(16, Math.round(fps * 1.6)) | 1;
  const halfW = NW >> 1;
  const hann = new Float64Array(NW);
  for (let j = 0; j < NW; j++) hann[j] = 0.5 - 0.5 * Math.cos(2 * Math.PI * j / (NW - 1));
  const cosT = new Float64Array(halfW * NW), sinT = new Float64Array(halfW * NW);
  const isSyll = new Uint8Array(halfW), isSlow = new Uint8Array(halfW);
  for (let k = 1; k < halfW; k++) {
    const hz = k * fps / NW;
    if (hz >= 3.0 && hz <= 8.0) isSyll[k] = 1;
    else if (hz >= 1.2 && hz < 3.0) isSlow[k] = 1;
    for (let j = 0; j < NW; j++) {
      const a = 2 * Math.PI * k * j / NW;
      cosT[k * NW + j] = Math.cos(a);
      sinT[k * NW + j] = Math.sin(a);
    }
  }
  const syll = new Float64Array(n);
  const env = new Float64Array(NW);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < NW; j++) {
      const idx = clamp(i - halfW + j, 0, n - 1);
      env[j] = (rms[idx] / (slow[idx] + 1e-12) - 1) * hann[j];
    }
    let band = 0, low = 0;
    for (let k = 1; k < halfW; k++) {
      let cr = 0, ci = 0;
      const base = k * NW;
      for (let j = 0; j < NW; j++) {
        const v = env[j];
        cr += v * cosT[base + j];
        ci -= v * sinT[base + j];
      }
      const p = cr * cr + ci * ci;
      if (isSyll[k]) band += p;
      else if (isSlow[k]) low += p;
    }
    /* The comparison that separates dialogue from a song is where the energy
       sits, not how much there is. Speech puts its modulation between 3 and
       8 Hz, at syllable rate. A song puts it at the tempo, which for anything
       from 70 to 180 BPM is between about 1.2 and 3 Hz. So the score is the
       share of the 1.2 to 8 Hz band that sits above 3 Hz. */
    syll[i] = (band + low) > 1e-12 ? band / (band + low) : 0;
  }

  /* Onset periodicity: normalise the onset envelope against its own local
     mean, then look for a repeating lag inside the tempo range. Normalising
     locally is what makes a quiet passage as measurable as a loud one. */
  const FW = Math.max(3, Math.round(fps * 1.5));
  const slowF = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - FW); j <= Math.min(n - 1, i + FW); j++) { s += flux[j]; c++; }
    slowF[i] = s / c;
  }
  const rel = new Float64Array(n);
  for (let i = 0; i < n; i++) rel[i] = Math.max(0, flux[i] / (slowF[i] + 1e-12) - 1);

  const lagMin = Math.max(2, Math.round(fps * 60 / 190));
  const lagMax = Math.max(lagMin + 1, Math.round(fps * 60 / 60));
  /* Every integer lag in the range. A coarse grid misses tempos that fall
     between its points: at a 16 per cent step, 120 BPM lands between two lags
     and the peak is split, so a song scores lower than the dialogue it is
     meant to be distinguished from. */
  const lags = [];
  for (let L = lagMin; L <= lagMax; L++) lags.push(L);
  const RW = Math.max(6, Math.round(fps * 1.5));
  const rhythm = new Float64Array(n);
  const tempoLag = new Float64Array(n);
  const win = new Float64Array(2 * RW + 1);
  const stride = 2;
  for (let i = 0; i < n; i += stride) {
    const j0 = Math.max(0, i - RW), j1 = Math.min(n - 1, i + RW);
    const m = j1 - j0 + 1;
    let mu = 0;
    for (let j = j0; j <= j1; j++) mu += rel[j];
    mu /= m;
    let e = 0;
    for (let j = j0; j <= j1; j++) {
      const v = rel[j] - mu;
      win[j - j0] = v;
      e += v * v;
    }
    /* What matters is not how correlated the onsets are, but whether there is
       a peak at one lag that stands out from the other lags. Speech has no
       such peak: its onsets are irregular, so every lag scores about the same.
       A drum pattern scores high at its beat period and low everywhere else,
       which is exactly the difference between dialogue and a song. */
    let bv = -1, bl = 0, sum = 0, cnt = 0;
    if (e > 1e-9) {
      for (let li = 0; li < lags.length; li++) {
        const lag = lags[li];
        let acc = 0, c = 0;
        for (let j = j0 + lag; j <= j1; j++) { acc += win[j - j0] * win[j - lag - j0]; c++; }
        const v = c ? acc / e : 0;
        sum += v;
        cnt++;
        if (v > bv) { bv = v; bl = lag; }
      }
    }
    const prom = cnt ? Math.max(0, bv - sum / cnt) : 0;
    for (let j = i; j < Math.min(n, i + stride); j++) { rhythm[j] = prom; tempoLag[j] = bl; }
  }

  /* Tempo stability. A prominent peak on its own is not enough: real dialogue
     produces a modest peak somewhere, because a sentence has a rhythm of its
     own. What dialogue cannot do is hold the same tempo for seconds at a time.
     So each frame is weighted by how many of its neighbours agree with it on
     the tempo, and that is what separates a song from a monologue. */
  const stab = new Float64Array(n);
  const SW2 = Math.max(4, Math.round(fps * 2));
  for (let i = 0; i < n; i++) {
    const k0 = Math.max(0, i - SW2), k1 = Math.min(n - 1, i + SW2);
    const counts = {};
    let best = 0, bestLag = 0, tot = 0;
    for (let j = k0; j <= k1; j++) {
      const l = tempoLag[j];
      if (!l) continue;
      tot++;
      counts[l] = (counts[l] || 0) + 1;
      if (counts[l] > best) { best = counts[l]; bestLag = l; }
    }
    let near = 0;
    for (let j = k0; j <= k1; j++) {
      const l = tempoLag[j];
      if (l && Math.abs(l - bestLag) <= 1) near++;
    }
    stab[i] = tot ? near / tot : 0;
  }
  for (let i = 0; i < n; i++) rhythm[i] *= stab[i];

  /* Tempo is reported from the music rather than from the file, because a film
     is mostly dialogue and dialogue has no tempo. */
  let bestLag = 0;
  const counts = {};
  for (let i = 0; i < n; i++) {
    if (rhythm[i] >= THRESH.rhythmMusic && tempoLag[i]) {
      const k = tempoLag[i];
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  Object.keys(counts).forEach(function (k) { if (!bestLag || counts[k] > counts[bestLag]) bestLag = +k; });

  for (let i = 0; i < n; i++) {
    frames[i].syll = syll[i];
    frames[i].rhythm = rhythm[i];
    frames[i].tempoLag = tempoLag[i];
    frames[i].tempoStable = stab[i];
    frames[i].rmsDb = 20 * Math.log10(frames[i].rms + 1e-9);
  }
  return { tempoBpm: bestLag ? Math.round(fps * 60 / bestLag) : 0 };
}

/* One frame to one label. Thresholds are calibrated against synthetic ground
   truth and a real talking head video; see tests/ and BRIEFING.md. */
function classifyFrame(f, ctx) {
  if (f.rmsDb < ctx.silenceDb) return "silence";
  const syll = f.syll, rhythm = f.rhythm;
  /* Only a stable, prominent pulse counts as music. A sustained score with no
     percussion is not detected here, and the interface says so and offers a
     way to place a cue by hand rather than pretending to find it. */
  if (rhythm >= THRESH.rhythmMusic) return "music";
  if (syll >= THRESH.syllSpeech) return "speech";
  if (rhythm >= THRESH.rhythmWeak) return "mixed";
  return "speech";
}

function medianFilter(labels, w) {
  const half = Math.floor(w / 2), out = labels.slice();
  for (let i = 0; i < labels.length; i++) {
    const c = {};
    for (let j = i - half; j <= i + half; j++) {
      const k = clamp(j, 0, labels.length - 1);
      c[labels[k]] = (c[labels[k]] || 0) + 1;
    }
    let best = labels[i], bn = 0;
    Object.keys(c).forEach(function (k) { if (c[k] > bn) { bn = c[k]; best = k; } });
    out[i] = best;
  }
  return out;
}

/* Runs of frames to segments, absorbing runs too short to act on. */
function mergeFrames(frames, opts) {
  opts = opts || {};
  const minDur = opts.minDur == null ? 2.5 : opts.minDur;
  if (!frames.length) return [];
  const labels = medianFilter(frames.map(function (f) { return f.label; }), opts.smooth == null ? 7 : opts.smooth);
  const runs = [];
  let s = 0;
  for (let i = 1; i <= frames.length; i++) {
    if (i === frames.length || labels[i] !== labels[s]) {
      const a = frames[s].t;
      const b = i < frames.length ? frames[i].t : frames[frames.length - 1].t + (frames[frames.length - 1].t - (frames[frames.length - 2] ? frames[frames.length - 2].t : 0));
      runs.push({ type: labels[s], start: a, end: b, frames: frames.slice(s, i) });
      s = i;
    }
  }
  /* Absorb short runs into the neighbour with the closer mean level. */
  const keep = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.end - r.start < minDur && runs.length > 1) {
      const prev = keep[keep.length - 1], next = runs[i + 1];
      const mean = function (x) { return x.frames.reduce(function (a, f) { return a + f.rms; }, 0) / Math.max(x.frames.length, 1); };
      const m = mean(r);
      if (prev && (!next || Math.abs(mean(prev) - m) <= Math.abs(mean(next) - m))) {
        prev.end = r.end;
        prev.frames = prev.frames.concat(r.frames);
      } else if (next) {
        next.start = r.start;
        next.frames = r.frames.concat(next.frames);
      } else if (prev) {
        prev.end = r.end;
        prev.frames = prev.frames.concat(r.frames);
      }
      continue;
    }
    keep.push(r);
  }
  /* Merge touching runs of the same type created by absorption. */
  const out = [];
  keep.forEach(function (r) {
    const last = out[out.length - 1];
    if (last && last.type === r.type && Math.abs(last.end - r.start) < 0.05) {
      last.end = r.end;
      last.frames = last.frames.concat(r.frames);
    } else out.push(r);
  });
  return out.map(function (r) {
    const mean = function (key) { return r.frames.reduce(function (a, f) { return a + f[key]; }, 0) / Math.max(r.frames.length, 1); };
    return {
      type: r.type,
      start: r.start,
      end: r.end,
      rmsDb: 20 * Math.log10(mean("rms") + 1e-9),
      rhythm: mean("rhythm"),
      syll: mean("syll"),
      flat: mean("flat"),
      centroid: mean("centroid"),
      width: mean("width"),
      corr: mean("corr"),
    };
  });
}

/* How likely is this music to be a released recording rather than a written
   score, a sting or a piece of diegetic sound? Named release-likeness because
   that is all it is: a shape, not an identification. */
function releaseScore(seg, ctx) {
  const dur = seg.end - seg.start;
  const pulse = clamp(seg.rhythm / 0.45, 0, 1);
  const width = clamp(seg.width / 0.55, 0, 1);
  const loud = clamp((seg.rmsDb - (ctx.musicMeanDb - 9)) / 12, 0, 1);
  const len = clamp(dur / 75, 0, 1);
  const tone = clamp((0.30 - seg.flat) / 0.30, 0, 1);
  const s = 0.34 * pulse + 0.22 * width + 0.18 * loud + 0.16 * len + 0.10 * tone;
  return { score: Math.round(clamp(s, 0, 1) * 100), pulse: pulse, width: width, loud: loud, len: len, tone: tone, dur: dur };
}

/* Speech inside a music run decides whether a claim can be muted out. */
function dialogueOverlap(musicSeg, segs) {
  let covered = 0;
  segs.forEach(function (s) {
    if (s.type !== "speech" && s.type !== "mixed") return;
    const a = Math.max(s.start, musicSeg.start), b = Math.min(s.end, musicSeg.end);
    if (b > a) covered += (b - a);
  });
  const dur = Math.max(musicSeg.end - musicSeg.start, 0.001);
  return { frac: clamp(covered / dur, 0, 1), bedded: covered / dur >= 0.45 };
}

/* ------------------------------------------------------------------ 5. technical report */

/* BS.1770 style K-weighting, as two biquads, then gated block loudness. This is
   an approximation of the standard: good enough to tell a producer that the film
   is 6 LU under where YouTube plays back, which is the decision it is used for. */
function kWeight(x, sr) {
  const out = new Float32Array(x.length);
  const bq = function (f0, q, gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * f0 / sr;
    const alpha = Math.sin(w0) / (2 * q);
    const cw = Math.cos(w0);
    const b0 = A * ((A + 1) + (A - 1) * cw + 2 * Math.sqrt(A) * alpha);
    const b1 = -2 * A * ((A - 1) + (A + 1) * cw);
    const b2 = A * ((A + 1) + (A - 1) * cw - 2 * Math.sqrt(A) * alpha);
    const a0 = (A + 1) - (A - 1) * cw + 2 * Math.sqrt(A) * alpha;
    const a1 = 2 * ((A - 1) - (A + 1) * cw);
    const a2 = (A + 1) - (A - 1) * cw - 2 * Math.sqrt(A) * alpha;
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  };
  const shelf = bq(1681.97, 0.7071752, 3.999843);
  const hp = bq(38.135, 0.5003270, 0);
  [shelf, hp].forEach(function (c) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const y = c[0] * v + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      out[i] = y;
    }
    x = out;
  });
  return x;
}

function loudness(L, R, sr) {
  const blocks = Math.max(1, Math.round(sr * 0.4));
  const step = Math.max(1, Math.round(blocks / 4));
  const kl = kWeight(L, sr);
  const kr = R ? kWeight(R, sr) : null;
  const zs = [];
  for (let i = 0; i + blocks <= kl.length; i += step) {
    let s = 0;
    for (let j = 0; j < blocks; j++) {
      s += kl[i + j] * kl[i + j];
      if (kr) s += kr[i + j] * kr[i + j];
    }
    zs.push(s / blocks);
  }
  if (!zs.length) return null;
  const loud = zs.map(function (z) { return -0.691 + 10 * Math.log10(z + 1e-12); });
  const gate = -70;
  let pass = loud.map(function (v, i) { return v > gate ? i : -1; }).filter(function (i) { return i >= 0; });
  if (!pass.length) return -70;
  let mean = pass.reduce(function (a, i) { return a + zs[i]; }, 0) / pass.length;
  let rel = -0.691 + 10 * Math.log10(mean) - 10;
  const pass2 = pass.filter(function (i) { return loud[i] > rel; });
  const use = pass2.length ? pass2 : pass;
  mean = use.reduce(function (a, i) { return a + zs[i]; }, 0) / use.length;
  return -0.691 + 10 * Math.log10(mean + 1e-12);
}

function peakAndCorr(L, R) {
  let peak = 0, clipped = 0, l2 = 0, r2 = 0, lr = 0, dc = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.abs(L[i]);
    if (a > peak) peak = a;
    if (a >= 0.999) clipped++;
    dc += L[i];
    if (R) {
      const b = R[i];
      if (Math.abs(b) > peak) peak = Math.abs(b);
      if (Math.abs(b) >= 0.999) clipped++;
      l2 += L[i] * L[i]; r2 += b * b; lr += L[i] * b;
    }
  }
  const corr = (R && l2 > 1e-12 && r2 > 1e-12) ? lr / Math.sqrt(l2 * r2) : 1;
  return {
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -99,
    clipped: clipped,
    corr: corr,
    dcOffset: dc / Math.max(L.length, 1),
    mono: !R,
  };
}

function silentGaps(frames, minDur, ctx) {
  const out = [];
  let s = null;
  frames.forEach(function (f, i) {
    if (f.rmsDb < ctx.silenceDb) { if (s === null) s = f.t; }
    else if (s !== null) {
      const dur = f.t - s;
      if (dur >= minDur) out.push({ start: s, end: f.t });
      s = null;
    }
  });
  return out;
}

/* ------------------------------------------------------------------ 6. state */

let S = {
  version: VERSION,
  film: { name: "", channel: "", size: 0, duration: 0, sr: 0, hash: "", lockedAt: "", scoreRegistered: null },
  cues: [],
  tech: null,
  segs: [],
  tempo: 0,
  analysis: null,
  triage: null,
  claim: { text: "", matchTime: "", claimant: "", asset: "", policy: "", basis: "licence", claimDate: "", cueId: null },
  settings: { palette: "ice", guideHidden: false },
};

function save() {
  try {
    const copy = JSON.parse(JSON.stringify(S));
    if (copy.cues.length > 80) {
      copy.cues = copy.cues.slice(0, 80);
      copy.cues.forEach(function (c) { delete c.thumb; });
    }
    localStorage.setItem(KEY, JSON.stringify(copy));
    return true;
  } catch (e) {
    try {
      const copy = JSON.parse(JSON.stringify(S));
      copy.cues.forEach(function (c) { delete c.thumb; });
      localStorage.setItem(KEY, JSON.stringify(copy));
      return true;
    } catch (e2) { return false; }
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const got = JSON.parse(raw);
    if (!got || got.version !== VERSION) return false;
    S = Object.assign(S, got);
    S.settings = Object.assign({ palette: "ice", guideHidden: false }, S.settings || {});
    S.claim = Object.assign({ text: "", matchTime: "", claimant: "", asset: "", policy: "", basis: "licence", claimDate: "", cueId: null }, S.claim || {});
    return true;
  } catch (e) { return false; }
}

function eraseAll() {
  try { localStorage.removeItem(KEY); } catch (e) {}
  S.cues = [];
  S.tech = null;
  S.segs = [];
  S.triage = null;
  S.film = { name: "", channel: "", size: 0, duration: 0, sr: 0, hash: "", lockedAt: "", scoreRegistered: null };
  S.claim = { text: "", matchTime: "", claimant: "", asset: "", policy: "", basis: "licence", claimDate: "", cueId: null };
  render();
}

/* ------------------------------------------------------------------ 7. rendering */

let VIEW = "scan";
let FILTER = null;
let objectUrl = null;

function $(id) { return document.getElementById(id); }

function setPalette(id) {
  const p = PALETTES.filter(function (x) { return x.id === id; })[0] || PALETTES[0];
  const r = document.documentElement.style;
  r.setProperty("--ground", p.ground);
  r.setProperty("--card", p.card);
  r.setProperty("--ink", p.ink);
  r.setProperty("--muted", p.muted);
  r.setProperty("--hair", p.hair);
  r.setProperty("--accent", p.accent);
  r.setProperty("--accentText", p.accentText);
  r.setProperty("--stop", p.stop);
  r.setProperty("--watch", p.watch);
  r.setProperty("--go", p.go);
  document.documentElement.setAttribute("data-palette", p.id);
  S.settings.palette = p.id;
}

function show(v, silent) {
  VIEW = v;
  ["scan", "cues", "shield", "dispute", "brief"].forEach(function (k) {
    const el = $("view-" + k);
    if (el) el.classList.toggle("on", k === v);
    const btn = $("tab-" + k);
    if (btn) btn.classList.toggle("on", k === v);
  });
  if (!silent) {
    try { history.replaceState(null, "", "#" + v); } catch (e) {
      try { if (typeof location !== "undefined") location.hash = v; } catch (e2) {}
    }
  }
  render();
}

function renderRouteNotes() {
  const el = $("routeNotes");
  if (!el) return;
  el.innerHTML = SOURCES.slice().sort(function (a, b) { return b.base - a.base; }).map(function (s) {
    return '<div class="trap"><span class="tn">' + s.base + '</span><h4>' + esc(s.label) + '</h4>' +
      '<p>' + esc(s.note) + '</p>' +
      '<p class="dim" style="font-size:12.5px;margin-top:7px">Proof to hold: ' + esc(s.proof) + '</p></div>';
  }).join("");
}

function render() {
  renderFilmLine();
  renderScan();
  renderCues();
  renderRouteNotes();
  renderShield();
  renderDispute();
  renderBrief();
  renderGuide();
  const tab = $("tab-dispute");
  if (tab) {
    const c = S.claim && S.claim.text;
    tab.classList.toggle("has", !!(c && c.length));
  }
}

function renderFilmLine() {
  const el = $("filmLine");
  if (!el) return;
  if (!S.film.name) {
    el.innerHTML = '<span class="dim">No film loaded.</span>';
    return;
  }
  const bits = [S.film.name];
  if (S.film.duration) bits.push(fmtLong(S.film.duration));
  if (S.film.size) bits.push(bytesLabel(S.film.size));
  if (S.film.hash) bits.push("sha256 " + S.film.hash.slice(0, 10));
  el.innerHTML = bits.map(function (b, i) {
    return i === 0 ? '<strong>' + esc(b) + '</strong>' : '<span class="dim">' + esc(b) + '</span>';
  }).join('<span class="sep">/</span>');
}

function renderGuide() {
  const el = $("guide");
  if (!el) return;
  const hide = S.settings.guideHidden || S.cues.length > 0;
  el.classList.toggle("off", !!hide);
}

function levelPill(level) {
  return '<span class="pill ' + level + '">' + LEVEL_LABEL[level] + '</span>';
}

function renderScan() {
  const sum = $("scanSummary"), bar = $("scanBar"), list = $("scanList"), tech = $("scanTech"), empty = $("scanEmpty");
  if (!sum) return;
  if (!S.cues.length && !S.segs.length) {
    sum.innerHTML = "";
    if (bar) bar.innerHTML = "";
    if (list) list.innerHTML = "";
    if (tech) tech.innerHTML = "";
    if (empty) empty.classList.remove("off");
    return;
  }
  if (empty) empty.classList.add("off");

  const f = filmSummary(S.cues, S.film);
  const tiles = [
    { k: "Music cues", v: String(f.total), sub: S.cues.length ? fmtLong(f.musicSec) + " of music" : "none found", f: null },
    { k: "Stop", v: String(f.counts.stop), sub: "will be claimed", f: "stop" },
    { k: "Check", v: String(f.counts.watch), sub: "keep paperwork", f: "watch" },
    { k: "Clear", v: String(f.counts.go), sub: "leave alone", f: "go" },
    { k: "Under dialogue", v: String(f.bedded), sub: "cannot be muted out", f: "bedded" },
  ];
  sum.innerHTML = tiles.map(function (t) {
    const active = (t.f && FILTER === t.f) ? " on" : "";
    return '<button class="tile' + active + ' lv-' + (t.f || "none") + '" data-filter="' + (t.f || "") + '">' +
      '<span class="tk">' + esc(t.k) + '</span><span class="tv">' + esc(t.v) + '</span>' +
      '<span class="ts">' + esc(t.sub) + '</span></button>';
  }).join("");

  if (bar) bar.innerHTML = '<canvas id="mapCanvas" height="96"></canvas>';
  drawMap();

  let rows = S.cues.slice().sort(function (a, b) { return a.start - b.start; });
  if (FILTER === "stop" || FILTER === "watch" || FILTER === "go") {
    rows = rows.filter(function (c) { return riskFor(c, S.film).level === FILTER; });
  } else if (FILTER === "bedded") {
    rows = rows.filter(function (c) { return c.underDialogue; });
  }
  const barHtml = FILTER
    ? '<div class="filterbar"><span>Showing ' + rows.length + ' of ' + S.cues.length + '</span>' +
      '<button class="mini" id="clearFilter">Show all</button></div>'
    : "";

  list.innerHTML = barHtml + (rows.length ? rows.map(cueCard).join("") :
    '<p class="dim">Nothing in this group. <button class="mini" id="clearFilter2">Show all cues</button></p>');

  if (list) {
    const lim = $("limitNote");
    if (list.parentElement && !lim && S.cues.length) {
      const n = document.createElement("p");
      n.id = "limitNote";
      n.className = "note";
      n.textContent = "What this scan finds, and what it does not. A cue is reported when the sound carries a " +
        "steady, prominent pulse, which covers the released recordings that get claimed. A sustained written score " +
        "with no percussion, or music mixed so low it sits under the dialogue, may not appear. Place those by hand " +
        "in the cue sheet, and treat this list as the shortlist to check, not as a verdict.";
      list.parentElement.insertBefore(n, list.nextSibling);
    } else if (lim && !S.cues.length) {
      if (lim.parentElement) lim.parentElement.removeChild(lim);
    }
  }

  const t = S.tech;
  if (sum.parentElement && !$("hijackNote") && f.hijack) {
    const n = document.createElement("p");
    n.id = "hijackNote";
    n.className = "note warn";
    n.textContent = "Your own score is not registered with a distributor yet. Until it is, a stranger can register it first and claim this film, which is the pattern behind most of the Nigerian takedowns of the last two years. Register the score before the film goes public.";
    sum.parentElement.insertBefore(n, sum.nextSibling);
  } else if ($("hijackNote") && !f.hijack) {
    const n = $("hijackNote");
    if (n && n.parentElement) n.parentElement.removeChild(n);
  }
  if (tech) {
    if (!t) tech.innerHTML = "";
    else {
      const lv = lufsVerdict(t.lufs, t.peakDb);
      tech.innerHTML =
        '<h3>Technical pre-flight</h3>' +
        '<div class="tiles small">' +
        tile("Loudness", (t.lufs != null ? t.lufs.toFixed(1) : "-") + " LUFS", "YouTube plays at " + AUDIT.lufsTarget, lv.level) +
        tile("Peak", t.peakDb.toFixed(1) + " dBFS", t.clipped ? t.clipped + " clipped samples" : "no clipping", t.peakDb > AUDIT.peakCeiling ? "stop" : "go") +
        tile("Stereo", t.corr.toFixed(2), t.mono ? "mono file" : (t.corr > 0.97 ? "near mono, check the mix" : "wide enough"), t.corr > 0.99 ? "watch" : "go") +
        tile("Silence", String(t.gaps.length), t.gaps.length ? "gaps over 3s" : "none over 3s", t.gaps.length > 2 ? "watch" : "go") +
        "</div>" +
        lv.notes.map(function (n) { return '<p class="note">' + esc(n) + '</p>'; }).join("") +
        (t.corr < 0 ? '<p class="note stop">The two channels are out of phase. On a phone speaker the mix will partly cancel and the music will thin out. Check the stereo master.</p>' : "") +
        (t.gaps.length ? '<p class="note">Longest silence runs ' + fmtTime(t.gaps[0].start) + " to " + fmtTime(t.gaps[0].end) + ". Check for a dead scene or a missing reel." : "");
    }
  }
}

function tile(k, v, sub, level) {
  return '<div class="tile static lv-' + (level || "none") + '"><span class="tk">' + esc(k) + '</span>' +
    '<span class="tv">' + esc(v) + '</span><span class="ts">' + esc(sub) + '</span></div>';
}

function cueCard(c) {
  const r = riskFor(c, S.film);
  const src = c.source ? SOURCE_BY_ID[c.source] : null;
  const th = c.thumb
    ? '<img class="thumb" src="' + c.thumb + '" alt="Frame at ' + esc(fmtTime(c.start)) + '">'
    : "";
  return '<article class="cue ' + r.level + '" id="cue-' + esc(c.id) + '">' +
    '<div class="cuehead">' + th +
    '<div class="cuemeta">' +
    '<div class="cuewhen"><span class="tc">' + esc(fmtTime(c.start)) + '</span>' +
    '<span class="dim">to ' + esc(fmtTime(c.end)) + ' / ' + esc(fmtLong(c.end - c.start)) + '</span></div>' +
    '<div class="cueflags">' + levelPill(r.level) +
    (c.underDialogue ? '<span class="pill bed">Under dialogue</span>' : '<span class="pill exp">Exposed</span>') +
    (c.release != null ? '<span class="pill soft">Release likeness ' + c.release + '</span>' : "") +
    (c.manual ? '<span class="pill soft">Placed by hand</span>' : "") +
    '</div>' +
    '<p class="verdict">' + esc(verdictLine(c, r)) + '</p>' +
    '<p class="route"><span class="lab">Route</span> ' + esc(src ? src.label : "Not declared yet") +
    (c.supplier ? '<span class="sep">/</span><span class="lab">Supplied by</span> ' + esc(c.supplier) : "") + '</p>' +
    (r.reasons.length ? '<ul class="reasons">' + r.reasons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>' : "") +
    '</div></div>' +
    '</article>';
}

function drawMap() {
  const cv = $("mapCanvas");
  if (!cv || !cv.getContext || !cv.parentElement || !cv.parentElement.getBoundingClientRect) return;
  const box = cv.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(320, box.width), H = 96;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + "px"; cv.style.height = H + "px";
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const dur = S.film.duration || (S.segs.length ? S.segs[S.segs.length - 1].end : 0) || 1;
  const x = function (t) { return (t / dur) * W; };
  const cs = getComputedStyle(document.documentElement);
  const col = {
    speech: cs.getPropertyValue("--muted").trim() || "#5C7387",
    music: cs.getPropertyValue("--accent").trim() || "#1B5FA8",
    silence: cs.getPropertyValue("--hair").trim() || "#BECEDD",
    mixed: cs.getPropertyValue("--hair").trim() || "#BECEDD",
  };
  S.segs.forEach(function (s) {
    g.fillStyle = col[s.type] || col.mixed;
    g.globalAlpha = s.type === "music" ? 1 : (s.type === "speech" ? 0.55 : 0.28);
    g.fillRect(x(s.start), 12, Math.max(1, x(s.end) - x(s.start)), 26);
  });
  g.globalAlpha = 1;
  S.cues.forEach(function (c) {
    const r = riskFor(c, S.film);
    g.fillStyle = cs.getPropertyValue("--" + r.level).trim() || "#1B5FA8";
    const cx = x(c.start);
    g.fillRect(cx - 1, 46, 2, 30);
    g.fillRect(cx - 3, 46, 7, 4);
  });
  g.fillStyle = col.speech;
  g.font = "11px 'Segoe UI', system-ui, sans-serif";
  g.globalAlpha = 0.85;
  const ticks = Math.min(10, Math.max(2, Math.round(W / 130)));
  for (let i = 0; i <= ticks; i++) {
    const t = dur * i / ticks;
    const tx = x(t);
    g.fillRect(tx, 84, 1, 5);
    g.textAlign = i === 0 ? "left" : (i === ticks ? "right" : "center");
    g.fillText(fmtTime(t), clamp(tx, 0, W), 96);
  }
  g.globalAlpha = 1;
}

function renderCues() {
  const wrap = $("cueSheet");
  if (!wrap) return;
  if (!S.cues.length) {
    wrap.innerHTML = '<p class="dim">No cues yet. Scan a film, and every music cue will appear here with a timecode and a still so you can see the scene it belongs to.</p>';
    return;
  }
  const rows = S.cues.slice().sort(function (a, b) { return a.start - b.start; });
  const head =
    '<div class="addcue">' +
    '<div><span class="lab">Place a cue by hand</span>' +
    '<p class="dim" style="margin:0">A score with no percussion produces no tempo, so the scan does not find it. ' +
    'Put the timecode in and it joins the sheet with everything else.</p></div>' +
    '<label class="addbox"><input id="addCueAt" placeholder="14:22 or 1:04:07">' +
    '<button class="mini" data-act="addCue">Add</button></label>' +
    '</div>';
  wrap.innerHTML = head + rows.map(function (c, i) {
    const r = riskFor(c, S.film);
    const cur = c.source || "";
    const opts = '<option value="">Not declared</option>' + SOURCES.map(function (s) {
      return '<option value="' + s.id + '"' + (cur === s.id ? " selected" : "") + ' title="' + esc(s.label) + '">' + esc(s.short) + '</option>';
    }).join("");
    return '<div class="sheetrow ' + r.level + '" data-cue="' + esc(c.id) + '">' +
      '<div class="srow-top">' +
      '<span class="snum">' + pad2(i + 1) + '</span>' +
      '<span class="stc">' + esc(fmtTime(c.start)) + '</span>' +
      '<span class="sdur">' + esc(fmtLong(c.end - c.start)) + '</span>' +
      levelPill(r.level) +
      '<span class="spos">' + (c.manual ? "placed by hand" : (c.underDialogue ? "under dialogue" : "exposed")) + '</span>' +
      '</div>' +
      '<div class="srow-grid">' +
      '<label><span class="lab">Route</span><select data-field="source">' + opts + '</select></label>' +
      '<label><span class="lab">Supplied by</span><input data-field="supplier" value="' + esc(c.supplier || "") + '" placeholder="editor, composer, library"></label>' +
      '<label><span class="lab">Proof on file</span><select data-field="proof">' +
      opt("", "Not recorded", c.proof) + opt("none", "None", c.proof) + opt("part", "Partial, receipt only", c.proof) + opt("full", "Full licence or assignment", c.proof) +
      '</select></label>' +
      '<label><span class="lab">Registered with Content ID</span><select data-field="cid">' +
      opt("", "Not known", c.cid) + opt("false", "No", c.cid) + opt("true", "Yes", c.cid) + opt("unsure", "Nobody knows", c.cid) +
      '</select></label>' +
      '<label><span class="lab">Licence covers this channel</span><select data-field="licenceScope">' +
      opt("", "Not checked", c.licenceScope) + opt("full", "Yes, YouTube and monetisation", c.licenceScope) + opt("narrow", "Not clearly", c.licenceScope) +
      '</select></label>' +
      '<label class="wide"><span class="lab">Proof reference</span><input data-field="proofRef" value="' + esc(c.proofRef || "") + '" placeholder="invoice number, licence id, email date"></label>' +
      '</div>' +
      '</div>';
  }).join("");
}

function opt(v, label, cur) {
  const c = cur === undefined || cur === null ? "" : String(cur);
  return '<option value="' + v + '"' + (c === v ? " selected" : "") + '>' + esc(label) + '</option>';
}

function renderShield() {
  const wrap = $("shieldBody");
  if (!wrap) return;
  const reg = S.film.scoreRegistered;
  const f = filmSummary(S.cues, S.film);
  const steps = [
    { n: "01", t: "Lock the picture", b: "Freeze the final file before you do anything else, then hash it. Every later edit is a different file with a different fingerprint, so it gets scanned from scratch and the film loses its view history.",
      act: S.film.hash ? '<span class="done">Hashed ' + esc(S.film.hash.slice(0, 16)) + '...</span>' : '<button class="mini" data-act="hash">Hash the file I loaded</button>' },
    { n: "02", t: "Register your own score first", b: "The fastest growing attack in Nollywood is not a producer using somebody else's song. It is a stranger extracting the film's soundtrack, pushing it to streaming through a distributor, and letting Content ID claim the film. Deliver and register your score before the film goes public, and allowlist your own channel so your own registration does not claim you.",
      act: '<div class="seg" id="regSeg">' +
        ['yes', 'no', 'unsure'].map(function (v) {
          const on = String(reg) === v || (v === "unsure" && reg === null);
          return '<button class="' + (on ? "on" : "") + '" data-reg="' + v + '">' + (v === "yes" ? "Done" : v === "no" ? "Not yet" : "Not sure") + '</button>';
        }).join("") + '</div>' },
    { n: "03", t: "Upload private, not public", b: "Upload the finished film as private or unlisted and wait for the Checks step to finish. YouTube warns you before publishing for ad suitability but not for copyright, and it will let you publish while the check is still running. That is how a film goes live and is demonetised the next morning.",
      act: '<button class="mini" data-act="goCues">See the ' + f.counts.stop + ' cue' + (f.counts.stop === 1 ? "" : "s") + ' to fix first</button>' },
    { n: "04", t: "Read the Copyright column, then decide", b: "Open Content, find the video, and look at Restrictions. For each claim decide between muting, replacing or trimming the segment, and disputing with the certificate. Do not publish while checks are still running if you are about to spend money on promotion.",
      act: '<button class="mini" data-act="goDispute">Open the dispute desk</button>' },
    { n: "05", t: "Publish, and keep the pack", b: "Only then go public. Keep the certificate, the hash and the licences for the life of the film. Claims can arrive years later, and a claim you can answer in an hour costs you a week of revenue, not the film.",
      act: '<button class="mini" data-act="printCert">Print the certificate</button>' },
  ];
  wrap.innerHTML =
    '<ol class="steps">' + steps.map(function (s) {
      return '<li><span class="sn">' + s.n + '</span><div><h4>' + esc(s.t) + '</h4><p>' + esc(s.b) + '</p><div class="stepact">' + s.act + '</div></div></li>';
    }).join("") + '</ol>' +
    '<div class="twocol">' +
    '<section><h3>The evidence pack</h3>' +
    '<p class="dim">Attach this to any dispute. Without it, a dispute is an opinion.</p>' +
    '<ul class="plain">' +
    '<li>Clearance certificate for the cut <button class="mini" data-act="printCert">Print</button></li>' +
    '<li>Cue sheet as CSV for the editor or the aggregator <button class="mini" data-act="csv">Download</button></li>' +
    '<li>File hash, recorded before upload: <span class="mono">' + esc(S.film.hash || "not hashed yet") + '</span></li>' +
    '<li>Date the picture was locked: ' + esc(S.film.lockedAt || "not recorded") + '</li>' +
    '<li>Proof references for ' + S.cues.filter(function (c) { return c.proofRef; }).length + ' of ' + S.cues.length + ' cues</li>' +
    '</ul></section>' +
    '<section><h3>Where the loss actually lands</h3>' +
    '<p>A claim on one cue can take the revenue on the whole film, because YouTube monetises the video, not the segment. If the cue sits under dialogue you cannot mute it, so the fix is a re-edit and a fresh upload, and the views start again from zero.</p>' +
    '<p class="dim">That is why the scan belongs before the first upload. Fixing a film after a claim is not a repair, it is a relaunch.</p></section>' +
    '</div>';
}

function renderDispute() {
  const wrap = $("disputeBody");
  if (!wrap) return;
  const cl = S.claim;
  const hit = cl.matchTime ? cueAt(parseTimecode(cl.matchTime), S.cues) : null;
  const stamp = parseTimecode(cl.matchTime);
  wrap.innerHTML =
    '<div class="twocol">' +
    '<section><h3>What did they flag?</h3>' +
    '<p class="dim">Paste the claim notice or the email from YouTube. The timestamps and the claimant name are read out of it.</p>' +
    '<textarea id="claimText" rows="6" placeholder="Paste the claim email or the text from the Restrictions panel">' + esc(cl.text) + '</textarea>' +
    '<div class="row">' +
    '<label><span class="lab">Matched time</span><input id="claimTime" value="' + esc(cl.matchTime) + '" placeholder="14:22 or 1:04:07"></label>' +
    '<label><span class="lab">Claim date</span><input id="claimDate" type="date" value="' + esc(cl.claimDate) + '"></label>' +
    '</div>' +
    '<div class="row">' +
    '<label><span class="lab">Claimant</span><input id="claimClaimant" value="' + esc(cl.claimant) + '"></label>' +
    '<label><span class="lab">Claimed asset</span><input id="claimAsset" value="' + esc(cl.asset) + '"></label>' +
    '</div>' +
    '<label class="block"><span class="lab">Basis you can actually stand behind</span><select id="claimBasis">' +
    opt("own", "I own this material", cl.basis) +
    opt("licence", "I hold a licence that covers this use", cl.basis) +
    opt("wrong", "The claim identifies the wrong material", cl.basis) +
    '</select></label>' +
    '<p class="note warn">YouTube lists what is not a valid basis: giving credit, owning a copy, using only a few seconds, changing the speed, and not monetising. Do not lead with any of them.</p>' +
    '</section>' +
    '<section><h3>The clock</h3>' + clockPanel(cl.claimDate) + '</section>' +
    '</div>' +
    (hit || stamp != null
      ? '<section class="hit"><h3>That timestamp is this cue</h3>' + cueCard(hit || { id: "none", start: stamp, end: stamp, source: "", underDialogue: false }) + '</section>'
      : "") +
    '<section><h3>Dispute statement</h3>' +
    '<p class="dim">Structured the way a claimant reads it: what matched, who you are, your basis, and what proves it.</p>' +
    '<pre id="disputeOut">' + esc(buildDispute(cl, hit, S.film)) + '</pre>' +
    '<div class="row tight">' +
    '<button class="mini" data-act="copyDispute">Copy the statement</button>' +
    '<button class="mini" data-act="printDispute">Print</button>' +
    '<button class="mini" data-act="useCue">Use the cue at the matched time</button>' +
    '</div></section>';
}

function clockPanel(dateStr) {
  if (!dateStr) return '<p class="dim">Enter the claim date and the deadlines appear here.</p>';
  const rows = [
    { t: "Day 5", d: addDays(dateStr, 5), b: "Dispute inside five days and revenue is held from the day the claim was placed. Dispute later and the hold only starts from the dispute date, so the earlier money is gone." },
    { t: "Day 30", d: addDays(dateStr, 30), b: "The claimant has 30 days to answer a dispute. If they do not answer, the claim is released." },
    { t: "Day 7 after appeal", d: addDays(dateStr, 37), b: "For a blocked claim, an appeal gives the claimant 7 days to respond. Appeal only when the position is strong." },
    { t: "Day 90", d: addDays(dateStr, 90), b: "A copyright strike can expire after 90 days if Copyright School is completed and the channel has fewer than three strikes." },
  ];
  return '<ul class="clock">' + rows.map(function (r) {
    return '<li><span class="ct">' + esc(r.t) + '</span><span class="cd">' + esc(r.d) + '</span><span class="cb">' + esc(r.b) + '</span></li>';
  }).join("") + '</ul>';
}

function renderBrief() {
  const wrap = $("briefBody");
  if (!wrap) return;
  wrap.innerHTML =
    '<section class="lede">' +
    '<p class="kick">What this tool is, and what it is not</p>' +
    '<p class="big">There is no public way to ask YouTube\'s Content ID database about a film before you upload it. Content ID is only open to rights holders, and the matching database is not queryable by anyone else. Every tool that claims otherwise is comparing your audio against a music recognition catalogue, which is a probability, not a verdict.</p>' +
    '<p>What is true, and what almost nobody in Nollywood uses, is that YouTube already runs a copyright check on your film, for free, before it goes public. The check sits in the upload flow, it takes minutes, and it will tell you which segment matched and who claimed it. The problem is not that the scan is missing. The problem is that producers publish before reading it, and that when a claim lands they have no idea which of the four hundred sounds in the film is the one being flagged.</p>' +
    '<p class="big">So this tool does the two things that are actually possible: it tells you where the music is, and it makes sure that when a claim arrives you already hold the document that answers it.</p>' +
    '</section>' +
    '<section><h3>What you should know that you probably do not</h3>' +
    '<div class="traps">' + TRAPS.map(function (t, i) {
      return '<div class="trap"><span class="tn">' + pad2(i + 1) + '</span><h4>' + esc(t.t) + '</h4><p>' + esc(t.b) + '</p></div>';
    }).join("") + '</div></section>' +
    '<section><h3>Plans</h3>' +
    '<p class="dim">The analysis runs on the producer\'s own machine, so the scan itself costs nothing to give away. What is sold is the record: the vault, the gate, and the certificate with the house mark on it.</p>' +
    '<div class="plans">' + PLANS.map(function (p) {
      return '<div class="plan' + (p.rec ? " rec" : "") + '">' +
        '<span class="pn">' + esc(p.name) + '</span>' +
        '<span class="pp">' + esc(p.price) + '</span>' +
        '<span class="pper">' + esc(p.per) + '</span>' +
        '<span class="pwho">' + esc(p.who) + '</span>' +
        '<p>' + esc(p.line) + '</p>' +
        '<ul class="plain">' + p.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join("") + '</ul>' +
        '</div>';
    }).join("") + '</div></section>' +
    '<section><h3>How the money actually leaves the room</h3>' +
    '<p>On a film with 18 million views, one claimed cue redirects the advertising on the whole video, not on the segment. The claimant keeps it, and the producer cannot mute the cue if it sits under dialogue. That is a five or six figure loss on a single film, from a sound the producer never chose and often never knew was there. The buyer who feels this most sharply is not the producer, it is whoever carries the channel: the aggregator or the channel manager, because the strike lands on their account. That is why the per title tier exists, and why it is charged at intake, before the file is accepted onto the network.</p>' +
    '<p class="dim">Everything in this page is analysis of the film itself. No audio, no cue sheet and no film ever leaves the browser. Nothing here is legal advice, and a clean result is not a clearance in law: it is a record of what you checked and what you hold.</p></section>';
}

/* ------------------------------------------------------------------ 8. wiring */

async function decodeFile(file) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const buf = await file.arrayBuffer();
  const audio = await ctx.decodeAudioData(buf.slice(0));
  try { ctx.close(); } catch (e) {}
  return audio;
}

function channels(audio) {
  const L0 = audio.getChannelData(0);
  const R0 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
  let L = L0, R = R0;
  const sr0 = audio.sampleRate;
  let sr = sr0, factor = 1;
  const dur = audio.duration;
  if (sr0 > 30000) { factor = dur > 1200 ? 4 : 2; }
  if (factor > 1) {
    L = decimate(L0, factor);
    R = R0 ? decimate(R0, factor) : null;
    sr = Math.round(sr0 / factor);
  }
  return { L: L, R: R, sr: sr, factor: factor };
}

async function analyse(file, opts) {
  opts = opts || {};
  const say = opts.onProgress || function () {};
  say("Decoding the audio track", 0.02);
  const audio = await decodeFile(file);
  const ch = channels(audio);
  const fps = ch.factor > 2 || audio.duration > 1200 ? 21.5 : 43;
  const winSize = 1024, hop = Math.max(128, Math.round(ch.sr / fps));
  say("Reading the sound", 0.12);
  const frames = frameFeatures(ch.L, ch.R, ch.sr, winSize, hop);
  if (!frames.length) throw new Error("No audio frames were produced. The file may have no audio track.");
  say("Measuring how the sound moves", 0.55);
  const env = envelopeFeatures(frames, ch.sr / hop);

  /* Silence threshold: 26 dB under the 90th percentile of level, floored. */
  const db = frames.map(function (f) { return f.rmsDb; }).sort(function (a, b) { return a - b; });
  const p90 = db[Math.floor(db.length * 0.9)] || -20;
  const ctx = { silenceDb: Math.min(THRESH.silenceFloor, p90 - THRESH.silenceDrop) };
  frames.forEach(function (f) { f.label = classifyFrame(f, ctx); });

  say("Grouping the cues", 0.72);
  const segs = mergeFrames(frames, { minDur: 2.5, smooth: 7 });

  /* Music mean level, used by the release likeness score. */
  const music = segs.filter(function (s) { return s.type === "music"; });
  const musicMeanDb = music.length ? music.reduce(function (a, s) { return a + s.rmsDb; }, 0) / music.length : -24;
  const relCtx = { musicMeanDb: musicMeanDb };

  const cues = music.map(function (s, i) {
    const ov = dialogueOverlap(s, segs);
    const rel = releaseScore(s, relCtx);
    return {
      id: "c" + (i + 1),
      start: Math.round(s.start * 100) / 100,
      end: Math.round(s.end * 100) / 100,
      rmsDb: s.rmsDb,
      underDialogue: ov.bedded,
      dialogueFrac: Math.round(ov.frac * 100) / 100,
      release: rel.score,
      releaseParts: rel,
      source: "",
      supplier: "",
      proof: "",
      cid: "",
      licenceScope: "",
      proofRef: "",
      thumb: null,
    };
  });

  say("Measuring loudness and peaks", 0.86);
  const tech = peakAndCorr(ch.L, ch.R);
  tech.lufs = loudness(ch.L, ch.R, ch.sr);
  tech.gaps = silentGaps(frames, 3, ctx);
  tech.analysisRate = ch.sr;
  tech.frameCount = frames.length;
  tech.windowMs = Math.round(winSize / ch.sr * 1000);
  tech.decimation = ch.factor;
  tech.duration = audio.duration;
  tech.tempoBpm = env.tempoBpm;
  tech.silenceDb = ctx.silenceDb;
  say("Done", 1);
  return { cues: cues, tech: tech, segs: segs, tempo: env.tempoBpm, duration: audio.duration, sr: audio.sampleRate };
}

/* Stills for each cue, so the producer can see the scene rather than guess. */
async function grabThumbs(file, cues, onProgress) {
  const url = URL.createObjectURL(file);
  objectUrl = url;
  const v = document.createElement("video");
  v.src = url; v.muted = true; v.playsInline = true; v.preload = "auto";
  const ok = await new Promise(function (res) {
    const to = setTimeout(function () { res(false); }, 12000);
    v.onloadeddata = function () { clearTimeout(to); res(true); };
    v.onerror = function () { clearTimeout(to); res(false); };
  });
  if (!ok) return false;
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 144;
  const g = cv.getContext("2d");
  for (let i = 0; i < cues.length; i++) {
    const t = Math.min(cues[i].start + 0.6, Math.max(0, v.duration - 0.2));
    const got = await new Promise(function (res) {
      const to = setTimeout(function () { res(false); }, 6000);
      v.onseeked = function () { clearTimeout(to); res(true); };
      try { v.currentTime = t; } catch (e) { clearTimeout(to); res(false); }
    });
    if (!got) continue;
    try {
      g.drawImage(v, 0, 0, cv.width, cv.height);
      cues[i].thumb = cv.toDataURL("image/jpeg", 0.55);
    } catch (e) {}
    if (onProgress) onProgress((i + 1) / cues.length);
  }
  return true;
}

/* A cue the detector could not find, placed by hand. A written score with no
   percussion does not produce a tempo, so it is not detected, and rather than
   pretend otherwise the cue sheet lets it be placed by timecode. */
function addCueAt(sec, dur, label) {
  if (sec == null || isNaN(sec) || sec < 0) return false;
  const d = dur && dur > 0 ? dur : 30;
  const id = "m" + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  S.cues.push({
    id: id, start: Math.round(sec * 100) / 100, end: Math.round((sec + d) * 100) / 100,
    rmsDb: null, underDialogue: false, dialogueFrac: 0, release: null, manual: true,
    note: label || "",
    source: "", supplier: "", proof: "", cid: "", licenceScope: "", proofRef: "", thumb: null,
  });
  S.cues.sort(function (a, b) { return a.start - b.start; });
  save();
  render();
  return true;
}

/* A drawn slate for the sample cut. The demo has no film behind it, so rather
   than leave an empty frame it gets a slate carrying the timecode and the scene
   tag, which is what the real still would show. */
function demeoSlate(tc, tag) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="144">' +
    '<rect width="256" height="144" fill="#16232E"/>' +
    '<rect x="7.5" y="7.5" width="241" height="129" fill="none" stroke="#2C3D4A"/>' +
    '<text x="18" y="40" font-family="Georgia,serif" font-size="24" fill="#9FB6C6">' + tc + '</text>' +
    '<text x="18" y="120" font-family="Segoe UI,sans-serif" font-size="12" fill="#6C8397">' + tag + '</text>' +
    '</svg>';
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function sampleFilm() {
  /* A plausible cut: dialogue with three songs in it, one of them bedded under
     dialogue, one of them from the editor's folder. Enough to click through. */
  S.film = {
    name: "Behind Closed Doors (final cut v4).mp4", channel: "Example TV",
    size: 4_300_000_000, duration: 5730, sr: 48000,
    hash: "9f2c41ab7d3e5088c1a6b4e2d90f7735aa41c6be8d0213f4e77b9c5d0a1e6f38",
    lockedAt: nowStamp(), scoreRegistered: false,
  };
  const defs = [
    [42, 3.2, "sting"], [188, 24, "editor"], [640, 41, "free"], [1495, 16, "score"],
    [2104, 52, "stock"], [2988, 12, "bleed"], [3610, 68, "beatlease"], [4410, 30, "live"],
    [5120, 22, "ai"], [5480, 46, "licensed"],
  ];
  const scenes = ["title card", "club, wide", "street, day", "bedroom, night", "church interior",
    "kitchen radio", "party, dancing", "worship, live", "rooftop, dusk", "closing walk"];
  S.cues = defs.map(function (d, i) {
    const bedded = (i % 3 === 0);
    return {
      id: "c" + (i + 1), start: d[0], end: d[0] + d[1], rmsDb: -22 - (i % 4),
      underDialogue: bedded, dialogueFrac: bedded ? 0.7 : 0.05,
      release: [18, 74, 62, 12, 55, 40, 81, 47, 58, 33][i],
      source: d[2], supplier: ["", "Emeka (editor)", "", "Tunde, composer", "Artlist", "", "BeatStars lease", "", "Suno Pro", "Label deal"][i],
      proof: ["", "none", "none", "full", "part", "none", "part", "none", "part", "full"][i],
      cid: ["", "unsure", "unsure", "false", "false", "true", "unsure", "true", "unsure", "false"][i],
      licenceScope: ["", "", "", "full", "full", "narrow", "", "narrow", "", "full"][i],
      proofRef: ["", "", "", "Composer agreement 12 Mar", "Artlist invoice 8841", "", "BS lease 2291", "", "Suno receipt 4471", "Sync licence 2201"][i],
      thumb: demeoSlate(fmtTime(d[0]), scenes[i]),
    };
  });
  S.tech = { lufs: -21.4, peakDb: -2.6, corr: 0.93, clipped: 0, mono: false,
    gaps: [{ start: 2870, end: 2874.2 }], analysisRate: 24000, frameCount: 246000,
    windowMs: 43, decimation: 2, duration: 5730, tempoBpm: 118, silenceDb: -50 };
  S.segs = [{ type: "speech", start: 0, end: 5730, rmsDb: -24, rhythm: 0.1, syll: 0.5, flat: 0.4, centroid: 1800, width: 0.1, corr: 0.98 }];
  S.cues.forEach(function (c) {
    S.segs.push({ type: "music", start: c.start, end: c.end, rmsDb: c.rmsDb, rhythm: 0.4, syll: 0.2, flat: 0.1, centroid: 900, width: 0.4, corr: 0.6 });
  });
  S.segs.sort(function (a, b) { return a.start - b.start; });
  S.settings.guideHidden = true;
  save();
  render();
}

function wire() {
  document.querySelectorAll("[data-tab]").forEach(function (b) {
    b.addEventListener("click", function () { show(b.getAttribute("data-tab")); });
  });
  document.querySelectorAll("[data-pal]").forEach(function (b) {
    b.addEventListener("click", function () {
      setPalette(b.getAttribute("data-pal"));
      save();
      document.querySelectorAll("[data-pal]").forEach(function (x) { x.classList.toggle("on", x === b); });
      drawMap();
    });
  });

  const drop = $("drop"), input = $("file");
  if (drop && input) {
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) run(e.dataTransfer.files[0]);
    });
    input.addEventListener("change", function () {
      if (input.files && input.files[0]) run(input.files[0]);
    });
  }

  document.addEventListener("click", function (e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const act = t.getAttribute && t.getAttribute("data-act");
    if (act) return doAct(act, t);
    if (t.id === "clearFilter" || t.id === "clearFilter2") { FILTER = null; renderScan(); return; }
    const f = t.getAttribute && t.getAttribute("data-filter");
    if (f !== null && f !== undefined && t.classList.contains("tile")) {
      FILTER = (!f || FILTER === f) ? null : f;
      renderScan();
      return;
    }
    const reg = t.getAttribute && t.getAttribute("data-reg");
    if (reg) {
      S.film.scoreRegistered = reg === "unsure" ? null : (reg === "yes");
      save(); renderShield();
      return;
    }
    const ct = t.closest && t.closest("[data-cue]");
    if (ct && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
  });

  document.addEventListener("change", function (e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const row = t.closest && t.closest("[data-cue]");
    if (row) {
      const cue = S.cues.filter(function (c) { return c.id === row.getAttribute("data-cue"); })[0];
      const field = t.getAttribute("data-field");
      if (cue && field) {
        let v = t.value;
        if (field === "cid") v = (v === "" ? "" : v === "true");
        cue[field] = v;
        save();
        renderScan(); renderCues(); renderShield();
      }
      return;
    }
    if (t.id === "claimBasis") { S.claim.basis = t.value; save(); renderDispute(); }
    if (t.id === "claimDate") { S.claim.claimDate = t.value; save(); renderDispute(); }
  });

  document.addEventListener("input", function (e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.id === "claimText") {
      S.claim.text = t.value;
      const p = parseClaimText(t.value);
      if (p.times.length) S.claim.matchTime = p.times[0].text;
      if (p.claimant) S.claim.claimant = p.claimant;
      if (p.asset) S.claim.asset = p.asset;
      if (p.policy) S.claim.policy = p.policy;
      save();
      const mt = $("claimTime");
      if (mt) mt.value = S.claim.matchTime;
      clearTimeout(t._t);
      t._t = setTimeout(function () { renderDispute(); }, 500);
      return;
    }
    if (t.id === "claimTime") { S.claim.matchTime = t.value; clearTimeout(t._t); t._t = setTimeout(function () { save(); renderDispute(); }, 500); return; }
    if (t.id === "claimClaimant") { S.claim.claimant = t.value; clearTimeout(t._t); t._t = setTimeout(function () { save(); }, 400); return; }
    if (t.id === "claimAsset") { S.claim.asset = t.value; clearTimeout(t._t); t._t = setTimeout(function () { save(); }, 400); return; }
    if (t.id === "triageIn") { S.triage = triageFilenames(t.value); renderTriage(); return; }
  });

  window.addEventListener("resize", function () { if (VIEW === "scan") drawMap(); });
  window.addEventListener("hashchange", function () {
    const h = (location.hash || "").replace("#", "");
    if (h && h !== VIEW) show(h, true);
  });
}

function doAct(act, el) {
  if (act === "hash") return hashFilm();
  if (act === "printCert") return printBlock(buildCertificate(S.cues, S.film, S.tech), "Clearance certificate");
  if (act === "csv") return download(csvFor(S.cues, S.film), (S.film.name || "film") + " cue sheet.csv", "text/csv");
  if (act === "goCues") return show("cues");
  if (act === "goDispute") return show("dispute");
  if (act === "copyDispute") return copyText($("disputeOut") ? $("disputeOut").textContent : "");
  if (act === "printDispute") return printBlock($("disputeOut") ? $("disputeOut").textContent : "", "Dispute statement");
  if (act === "useCue") {
    const hit = cueAt(parseTimecode(S.claim.matchTime), S.cues);
    if (hit) { S.claim.cueId = hit.id; save(); show("cues"); }
    return;
  }
  if (act === "addCue") {
    const box = $("addCueAt");
    const sec = box ? parseTimecode(box.value) : null;
    if (sec == null) { status("Give the timecode as 14:22 or 1:04:07.", true); return; }
    addCueAt(sec);
    status("Cue added at " + fmtTime(sec) + ". Declare where the sound came from.");
    return;
  }
  if (act === "sample") return sampleFilm();
  if (act === "erase") return eraseAll();
  if (act === "hideGuide") { S.settings.guideHidden = true; save(); renderGuide(); return; }
  if (act === "showGuide") { S.settings.guideHidden = false; save(); renderGuide(); return; }
}

async function hashFilm() {
  const f = $("file");
  const file = (f && f.files && f.files[0]) || S.analysis && S.analysis.file;
  if (!file) {
    status("Load a film first, then hash it.", true);
    return;
  }
  status("Hashing the file");
  const hex = await sha256Hex(await file.arrayBuffer());
  S.film.hash = hex;
  S.film.lockedAt = nowStamp();
  save(); render();
  status("Hashed. This is the hash that goes in the evidence pack.");
}

function download(text, name, type) {
  const b = new Blob([text], { type: type || "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function copyText(t) {
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { status("Copied."); }, function () { status("Copy failed, select the text instead.", true); });
}

function printBlock(text, title) {
  const w = window.open("", "_blank");
  if (!w) { status("Allow pop ups to print.", true); return; }
  w.document.write('<!doctype html><title>' + esc(title) + '</title><style>' +
    'body{font:13px/1.6 Georgia,serif;color:#111;margin:48px;white-space:pre-wrap;max-width:760px}' +
    'h1{font:600 15px "Segoe UI",sans-serif;letter-spacing:.14em;text-transform:uppercase;margin:0 0 24px}' +
    '@media print{body{margin:18mm}}</style><h1>' + esc(title) + '</h1>' + esc(text));
  w.document.close();
  setTimeout(function () { w.print(); }, 250);
}

function status(msg, bad) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("bad", !!bad);
}

async function run(file) {
  status("Starting");
  $("progressWrap").classList.remove("off");
  const bar = $("progressBar"), lab = $("progressLabel");
  try {
    const res = await analyse(file, {
      onProgress: function (label, pct) {
        if (bar) bar.style.width = Math.round(pct * 100) + "%";
        if (lab) lab.textContent = label;
      },
    });
    S.analysis = { name: file.name };
    S.cues = res.cues;
    S.tech = res.tech;
    S.segs = res.segs;
    S.tempo = res.tempo;
    S.film.name = file.name;
    S.film.size = file.size;
    S.film.duration = res.duration;
    S.film.sr = res.sr;
    if (!S.film.hash) { S.film.hash = await sha256Hex(await file.arrayBuffer()); S.film.lockedAt = nowStamp(); }
    render();
    if (bar) bar.style.width = "100%";
    if (lab) lab.textContent = "Grabbing stills for each cue";
    if (res.cues.length) await grabThumbs(file, S.cues, function (p) { if (bar) bar.style.width = Math.round(p * 100) + "%"; });
    save();
    status(res.cues.length
      ? res.cues.length + " music cue" + (res.cues.length === 1 ? "" : "s") + " found in " + fmtLong(res.duration) + ". Declare each one in the cue sheet."
      : "No music cues found in this cut. Either it is all dialogue, or the music is very quiet. Check the sound map before you believe it.");
  } catch (err) {
    status("Could not read the audio in that file. Export the audio from your editor as a WAV and drop that instead. (" + (err && err.message ? err.message : "unknown error") + ")", true);
  } finally {
    setTimeout(function () { $("progressWrap").classList.add("off"); }, 900);
  }
}

function renderTriage() {
  const el = $("triageOut");
  if (!el) return;
  const t = S.triage;
  if (!t || !t.total) { el.innerHTML = ""; return; }
  el.innerHTML = '<p class="dim">' + t.total + ' files, ' + t.audio + ' of them audio. ' + t.hits.length + ' carry a red flag in the filename.</p>' +
    (t.hits.length
      ? '<ul class="hits">' + t.hits.map(function (h) {
        return '<li><span class="mono">' + esc(h.name) + '</span><ul>' + h.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join("") + '</ul></li>';
      }).join("") + '</ul>'
      : '<p>Nothing in this listing looks like a download. That is not the same as cleared: a file with a plain name still needs a route and a document.</p>');
}

/* ------------------------------------------------------------------ boot */

function boot() {
  load();
  setPalette(S.settings.palette || "ice");
  document.querySelectorAll("[data-pal]").forEach(function (x) {
    x.classList.toggle("on", x.getAttribute("data-pal") === S.settings.palette);
  });
  wire();
  /* ?demo=1 fills the views with a worked example, so the tool can be shown to
     somebody without handing over a film. */
  const q = (typeof location !== "undefined" && location.search) || "";
  if (/demo=1/.test(q) && !S.cues.length) sampleFilm();
  const h = (typeof location !== "undefined" ? (location.hash || "") : "").replace("#", "");
  show(["scan", "cues", "shield", "dispute", "brief"].indexOf(h) >= 0 ? h : "scan", true);
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", boot);
}

/* Exported for the test harness. In the browser this block is inert, because
   `module` is not defined, and the app's functions are already global. */
const CLR = {
  fmtTime: fmtTime, fmtLong: fmtLong, parseTimecode: parseTimecode, bytesLabel: bytesLabel,
  esc: esc, clamp: clamp, addDays: addDays, nowStamp: nowStamp, pad2: pad2,
  SOURCES: SOURCES, SOURCE_BY_ID: SOURCE_BY_ID, RED_FLAGS: RED_FLAGS, TRAPS: TRAPS, PLANS: PLANS,
  riskFor: riskFor, verdictLine: verdictLine, filmSummary: filmSummary, cueAt: cueAt,
  parseClaimText: parseClaimText, buildDispute: buildDispute, buildCertificate: buildCertificate,
  csvFor: csvFor, triageFilenames: triageFilenames, lufsVerdict: lufsVerdict,
  classifyFrame: classifyFrame, mergeFrames: mergeFrames, medianFilter: medianFilter,
  releaseScore: releaseScore, dialogueOverlap: dialogueOverlap, makeFFT: makeFFT, decimate: decimate,
  envelopeFeatures: envelopeFeatures, frameFeatures: frameFeatures, silentGaps: silentGaps,
  LEVEL_LABEL: LEVEL_LABEL, AUDIT: AUDIT, THRESH: THRESH, VERSION: VERSION,
  render: render, renderScan: renderScan, renderCues: renderCues, renderShield: renderShield,
  renderDispute: renderDispute, renderBrief: renderBrief, renderRouteNotes: renderRouteNotes,
  sampleFilm: sampleFilm, addCueAt: addCueAt, drawMap: drawMap, show: show, demeoSlate: demeoSlate,
  getState: function () { return S; },
};
if (typeof module !== "undefined" && module.exports) module.exports = CLR;
if (typeof globalThis !== "undefined") globalThis.CLR = CLR;
