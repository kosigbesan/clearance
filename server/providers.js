/* ---------------------------------------------------------------------------
   CLEARANCE identification providers.

   Two ways to put a name to the music in a cue:

     AudD       one token, self serve, 300 requests free on signup, then about
                $5 per month for 1,000 requests.
     ACRCloud   access key plus secret, HMAC-SHA1 signed requests, 14 day trial,
                150 million tracks, prices quoted.

   Both are catalogue lookups, not Content ID. A match means the cue is almost
   certainly a released recording and will very likely be claimed. No match is
   weak evidence, not a clearance: a track can sit in Content ID without being
   in a recognition catalogue, and the reverse.

   Pure functions only, so tests can drive them without a network.
   ------------------------------------------------------------------------- */

const crypto = require("crypto");

const AUDD_URL = "https://api.audd.io/";
const ACR_URI = "/v1/identify";

/* Hand rolled multipart, so the server has no dependencies at all. */
function multipart(fields, fileField, fileBuf, filename, contentType) {
  const boundary = "----clearance" + crypto.randomBytes(12).toString("hex");
  const parts = [];
  Object.keys(fields).forEach(function (k) {
    parts.push(Buffer.from(
      "--" + boundary + "\r\n" +
      'Content-Disposition: form-data; name="' + k + '"\r\n\r\n' +
      String(fields[k]) + "\r\n"));
  });
  parts.push(Buffer.from(
    "--" + boundary + "\r\n" +
    'Content-Disposition: form-data; name="' + fileField + '"; filename="' + filename + '"\r\n' +
    "Content-Type: " + contentType + "\r\n\r\n"));
  parts.push(fileBuf);
  parts.push(Buffer.from("\r\n--" + boundary + "--\r\n"));
  return { boundary: boundary, body: Buffer.concat(parts) };
}

function postInit(boundary, body) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "multipart/form-data; boundary=" + boundary,
      "Content-Length": String(body.length),
    },
    body: body,
  };
}

/* ---------------------------------------------------------------- AudD */

const audd = {
  id: "audd",
  label: "AudD",
  needs: ["AUDD_API_TOKEN"],
  keys: "AUDD_API_TOKEN",
  ready: function (cfg) { return !!cfg.AUDD_API_TOKEN; },
  build: function (cfg, sample) {
    const m = multipart({
      api_token: cfg.AUDD_API_TOKEN,
      return: "apple_music,spotify",
      market: cfg.AUDD_MARKET || "us",
    }, "file", sample.buffer, sample.filename || "cue.wav", "audio/wav");
    return { url: AUDD_URL, init: postInit(m.boundary, m.body) };
  },
  parse: function (json) {
    if (!json) return { ok: false, error: "empty response" };
    if (json.status !== "success") {
      const e = json.error || {};
      return { ok: false, error: e.error_message || e.error_code || "AudD reported an error" };
    }
    /* A successful request with a null result means "listened, did not match".
       That is a real answer and it is not the same as a failure. */
    if (!json.result) return { ok: true, match: null };
    const r = json.result;
    return {
      ok: true,
      match: {
        title: r.title || "",
        artist: r.artist || "",
        album: r.album || "",
        label: r.label || "",
        releaseDate: r.release_date || "",
        timecode: r.timecode || "",
        link: r.song_link || "",
        score: null,
      },
    };
  },
};

/* ---------------------------------------------------------------- ACRCloud */

const acrcloud = {
  id: "acrcloud",
  label: "ACRCloud",
  needs: ["ACRCLOUD_HOST", "ACRCLOUD_ACCESS_KEY", "ACRCLOUD_ACCESS_SECRET"],
  keys: "ACRCLOUD_HOST, ACRCLOUD_ACCESS_KEY, ACRCLOUD_ACCESS_SECRET",
  ready: function (cfg) {
    return !!(cfg.ACRCLOUD_HOST && cfg.ACRCLOUD_ACCESS_KEY && cfg.ACRCLOUD_ACCESS_SECRET);
  },
  /* string_to_sign is exactly the six lines below, joined by newlines. The
     timestamp must appear here as the same string that goes into the form. */
  sign: function (cfg, timestamp) {
    const stringToSign = ["POST", ACR_URI, cfg.ACRCLOUD_ACCESS_KEY, "audio", "1", String(timestamp)].join("\n");
    return crypto.createHmac("sha1", cfg.ACRCLOUD_ACCESS_SECRET)
      .update(Buffer.from(stringToSign, "utf-8")).digest("base64");
  },
  build: function (cfg, sample, now) {
    const timestamp = now == null ? Date.now() / 1000 : now;
    const m = multipart({
      sample_bytes: sample.buffer.length,
      access_key: cfg.ACRCLOUD_ACCESS_KEY,
      data_type: "audio",
      signature_version: "1",
      signature: this.sign(cfg, timestamp),
      timestamp: String(timestamp),
    }, "sample", sample.buffer, sample.filename || "cue.wav", "audio/wav");
    const host = String(cfg.ACRCLOUD_HOST).replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return { url: "https://" + host + ACR_URI, init: postInit(m.boundary, m.body) };
  },
  parse: function (json) {
    const st = (json && json.status) || {};
    const code = st.code == null ? -1 : Number(st.code);
    /* 1001 is ACRCloud's "no result", which is an answer, not a fault. */
    if (code === 1001) return { ok: true, match: null, code: code };
    if (code !== 0) return { ok: false, error: st.msg || ("ACRCloud error " + code), code: code };
    const music = (json.metadata && json.metadata.music) || [];
    if (!music.length) return { ok: true, match: null, code: 0 };
    const m = music[0];
    const artists = (m.artists || []).map(function (a) { return a && a.name; }).filter(Boolean).join(", ");
    return {
      ok: true,
      code: 0,
      match: {
        title: m.title || "",
        artist: artists,
        album: (m.album && m.album.name) || "",
        label: m.label || "",
        releaseDate: m.release_date || "",
        timecode: m.play_offset_ms != null ? Math.round(m.play_offset_ms / 1000) + "s into the track" : "",
        link: "",
        score: typeof m.score === "number" ? m.score : null,
      },
    };
  },
};

const PROVIDERS = { audd: audd, acrcloud: acrcloud };

/* Which provider to use. Env wins over the config file, and if nothing is
   stated we pick whichever one actually has credentials. */
function resolveConfig(env, fileCfg) {
  const cfg = Object.assign({}, fileCfg || {}, env || {});
  if (!cfg.provider && cfg.IDENTIFY_PROVIDER) cfg.provider = cfg.IDENTIFY_PROVIDER;
  if (!cfg.provider) {
    if (cfg.AUDD_API_TOKEN) cfg.provider = "audd";
    else if (cfg.ACRCLOUD_ACCESS_KEY) cfg.provider = "acrcloud";
    else cfg.provider = "audd";
  }
  return cfg;
}

function describe(cfg) {
  const p = PROVIDERS[cfg.provider] || audd;
  const missing = p.needs.filter(function (k) { return !cfg[k]; });
  return {
    provider: p.id,
    providerLabel: p.label,
    ready: missing.length === 0,
    missing: missing,
    keys: p.keys,
  };
}

async function identify(cfg, sample, opts) {
  opts = opts || {};
  const p = PROVIDERS[cfg.provider];
  if (!p) return { ok: false, error: "unknown provider: " + cfg.provider };
  const state = describe(cfg);
  if (!state.ready) {
    return { ok: false, error: p.label + " is not configured. Missing: " + state.missing.join(", "), missing: state.missing };
  }
  const built = p.build(cfg, sample, opts.now);
  const call = opts.fetch || fetch;
  let res;
  try {
    res = await call(built.url, built.init);
  } catch (e) {
    return { ok: false, provider: p.id, error: "could not reach " + p.label + ": " + ((e && e.message) || e) };
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {
    return { ok: false, provider: p.id, providerLabel: p.label, httpStatus: res.status,
      error: p.label + " returned a non JSON response (HTTP " + res.status + ")" };
  }
  const out = p.parse(json);
  out.provider = p.id;
  out.providerLabel = p.label;
  out.httpStatus = res.status;
  return out;
}

module.exports = {
  audd: audd, acrcloud: acrcloud, PROVIDERS: PROVIDERS,
  multipart: multipart, resolveConfig: resolveConfig, describe: describe, identify: identify,
  AUDD_URL: AUDD_URL, ACR_URI: ACR_URI,
};
