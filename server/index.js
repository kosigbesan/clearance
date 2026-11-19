/* ---------------------------------------------------------------------------
   CLEARANCE identification sidecar.

   The app itself runs entirely in the browser, so it can never hold an API
   token. This is the one small service that can, and it does one job: take a
   twelve second WAV snippet of a single cue, ask AudD or ACRCloud what it is,
   and hand the answer back.

   Only the snippets are sent, never the film. A ten cue film uploads about two
   minutes of audio in total, which is what keeps the cost at a few cents.

   Run it:
     node server/index.js
     PORT=8787 AUDD_API_TOKEN=xxxx node server/index.js

   Or drop the credentials in ~/.clearance/identify.json:
     { "IDENTIFY_PROVIDER": "audd", "AUDD_API_TOKEN": "xxxx" }

   No dependencies. Node 18 or newer, for global fetch.
   ------------------------------------------------------------------------- */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const P = require("./providers");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 8787);
const MAX_BODY = 4 * 1024 * 1024;   /* a 12 second WAV is about half a megabyte */

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".wav": "audio/wav", ".mp4": "video/mp4",
};

function configFile() {
  const p = path.join(os.homedir(), ".clearance", "identify.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) {
    return null;
  }
}

function cfg() {
  return P.resolveConfig(process.env, configFile());
}

function send(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(code, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Content-Length": buf.length,
    /* The app is often served from a different origin (a file, or GitHub
       Pages). Browsers treat http://localhost as a secure context, so a page
       on https can reach this server, but it still needs the header. */
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Clearance-Provider",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  });
  res.end(buf);
}

function json(res, code, obj) {
  send(res, code, JSON.stringify(obj, null, 1), "application/json; charset=utf-8");
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on("data", function (c) {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body over " + MAX_BODY + " bytes"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", function () { resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/" || rel === "") rel = "/index.html";
  const full = path.join(ROOT, rel);
  /* Never serve outside the project directory. */
  if (!full.startsWith(ROOT)) return send(res, 403, "forbidden", "text/plain");
  fs.readFile(full, function (err, buf) {
    if (err) return send(res, 404, "not found: " + rel, "text/plain");
    send(res, 200, buf, MIME[path.extname(full).toLowerCase()] || "application/octet-stream");
  });
}

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") return send(res, 204, "");

  if (url.pathname === "/health") {
    const c = cfg();
    const state = P.describe(c);
    return json(res, 200, {
      ok: true, service: "clearance-identify", version: 1,
      provider: state.provider, providerLabel: state.providerLabel,
      ready: state.ready, missing: state.missing, keys: state.keys,
      maxSnippetBytes: MAX_BODY,
      note: "A catalogue match is not a Content ID result. A match means a released recording; no match is not a clearance.",
    });
  }

  if (url.pathname === "/identify") {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST a WAV snippet to /identify" });
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return json(res, 413, { ok: false, error: e.message });
    }
    if (!body.length) return json(res, 400, { ok: false, error: "empty body" });
    const c = cfg();
    const override = url.searchParams.get("provider") || req.headers["x-clearance-provider"];
    if (override) c.provider = String(override).toLowerCase();
    const t0 = Date.now();
    let out;
    try {
      out = await P.identify(c, { buffer: body, filename: "cue.wav" });
    } catch (e) {
      out = { ok: false, error: "identification failed: " + ((e && e.message) || e) };
    }
    out.ms = Date.now() - t0;
    out.bytes = body.length;
    return json(res, out.ok ? 200 : 502, out);
  }

  if (req.method !== "GET") return json(res, 405, { ok: false, error: "method not allowed" });
  return serveStatic(req, res, url.pathname);
});

if (require.main === module) {
  server.listen(PORT, function () {
    const state = P.describe(cfg());
    console.log("CLEARANCE identify sidecar on http://localhost:" + PORT);
    console.log("  serving the app from " + ROOT);
    console.log("  provider: " + state.providerLabel + (state.ready ? " (ready)" : " (not configured)"));
    if (!state.ready) console.log("  missing: " + state.missing.join(", ") + "  set " + state.keys);
    console.log("  only 12 second snippets of each cue are ever sent");
  });
}

module.exports = { server: server, MAX_BODY: MAX_BODY, cfg: cfg, configFile: configFile };
