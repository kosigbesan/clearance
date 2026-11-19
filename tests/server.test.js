// Server contract tests for the CLEARANCE identification sidecar.
//   node tests/server.test.js
// Starts the real server on an ephemeral port with the provider mocked, so the
// whole HTTP path is exercised without spending a request or needing a key.

const realFetch = globalThis.fetch;
const S = require("../server/index.js");
const P = require("../server/providers.js");

let pass = 0, fail = 0;
function chk(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? "PASS " : "FAIL ") + name + "  got=" + JSON.stringify(got) + (ok ? "" : "  want=" + JSON.stringify(want)));
}

function wavBytes(n) {
  const b = Buffer.alloc(44 + n);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii"); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(22050, 24); b.writeUInt32LE(44100, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii"); b.writeUInt32LE(n, 40);
  return b;
}

async function main() {
  const port = await new Promise(function (r) { S.server.listen(0, function () { r(S.server.address().port); }); });
  const base = "http://127.0.0.1:" + port;
  const get = async (p, opts) => {
    const res = await realFetch(base + p, opts);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    return { status: res.status, text: text, json: json, headers: res.headers };
  };

  /* ------------------------------------------------------------ health */
  delete process.env.AUDD_API_TOKEN;
  delete process.env.ACRCLOUD_ACCESS_KEY;
  delete process.env.ACRCLOUD_ACCESS_SECRET;
  delete process.env.IDENTIFY_PROVIDER;
  let h = await get("/health");
  chk("health is ok", h.status, 200);
  chk("health names the service", h.json.service, "clearance-identify");
  chk("health is not ready without a key", h.json.ready, false);
  chk("health names the missing key", h.json.missing.join(","), "AUDD_API_TOKEN");
  chk("health states the caveat", h.json.note.indexOf("not a Content ID result") > 0, true);
  chk("health allows the browser origin", h.headers.get("access-control-allow-origin"), "*");

  /* ------------------------------------------------------------ unconfigured */
  let r = await get("/identify", { method: "POST", body: wavBytes(64) });
  chk("identify without a key is refused", r.status, 502);
  chk("identify without a key explains why", r.json.ok, false);
  chk("identify without a key names what is missing", r.json.missing.join(","), "AUDD_API_TOKEN");

  /* ------------------------------------------------------------ a match */
  process.env.AUDD_API_TOKEN = "testtoken";
  let seenUrl = null, seenBody = null;
  globalThis.fetch = async function (url, init) {
    seenUrl = url; seenBody = init.body;
    return { status: 200, text: async () => JSON.stringify({ status: "success", result: { artist: "Tears For Fears", title: "Everybody Wants To Rule The World", label: "UMC", timecode: "00:57" } }) };
  };
  const snip = wavBytes(128);
  r = await get("/identify", { method: "POST", body: snip, headers: { "Content-Type": "audio/wav" } });
  chk("identify with a key returns 200", r.status, 200);
  chk("identify reports ok", r.json.ok, true);
  chk("identify names the track", r.json.match.title, "Everybody Wants To Rule The World");
  chk("identify names the provider", r.json.providerLabel, "AudD");
  chk("identify reports the bytes it sent", r.json.bytes, snip.length);
  chk("identify reports how long it took", typeof r.json.ms, "number");
  chk("the provider was called", seenUrl, "https://api.audd.io/");
  chk("the snippet was forwarded whole", seenBody.indexOf(snip) > 0, true);
  chk("the token went to the provider", seenBody.toString("binary").indexOf("testtoken") > 0, true);

  /* ------------------------------------------------------------ no match */
  globalThis.fetch = async function () {
    return { status: 200, text: async () => '{"status":"success","result":null}' };
  };
  r = await get("/identify", { method: "POST", body: snip });
  chk("a no match is a 200, not an error", r.status, 200);
  chk("a no match reports ok", r.json.ok, true);
  chk("a no match reports a null match", r.json.match, null);

  /* ------------------------------------------------------------ provider failure */
  globalThis.fetch = async function () { return { status: 200, text: async () => '{"status":"error","error":{"error_code":901,"error_message":"Bad token"}}' }; };
  r = await get("/identify", { method: "POST", body: snip });
  chk("a provider error is a 502", r.status, 502);
  chk("a provider error is passed through", r.json.error, "Bad token");

  globalThis.fetch = async function () { throw new Error("getaddrinfo ENOTFOUND api.audd.io"); };
  r = await get("/identify", { method: "POST", body: snip });
  chk("a network failure is a 502", r.status, 502);
  chk("a network failure is explained", r.json.error.indexOf("could not reach AudD") === 0, true);

  /* ------------------------------------------------------------ provider override */
  process.env.ACRCLOUD_HOST = "identify-eu-west-1.acrcloud.com";
  process.env.ACRCLOUD_ACCESS_KEY = "k";
  process.env.ACRCLOUD_ACCESS_SECRET = "s";
  globalThis.fetch = async function (url) { seenUrl = url; return { status: 200, text: async () => JSON.stringify({ status: { code: 0, msg: "Success" }, metadata: { music: [{ title: "Africa", artists: [{ name: "Toto" }], label: "Columbia", score: 91 }] } }) }; };
  r = await get("/identify?provider=acrcloud", { method: "POST", body: snip });
  chk("the provider can be overridden per request", seenUrl, "https://identify-eu-west-1.acrcloud.com/v1/identify");
  chk("the override returns the ACRCloud match", r.json.match.title, "Africa");
  chk("the override reports the ACRCloud label", r.json.providerLabel, "ACRCloud");

  /* ------------------------------------------------------------ guards */
  r = await get("/identify", { method: "GET" });
  chk("a GET on identify is refused", r.status, 405);

  r = await get("/identify", { method: "POST", body: Buffer.alloc(0) });
  chk("an empty body is refused", r.status, 400);

  const big = await realFetch(base + "/identify", { method: "POST", body: Buffer.alloc(S.MAX_BODY + 1024) }).catch(() => null);
  chk("an oversized body is refused", big ? big.status : 413, 413);

  r = await get("/");
  chk("the app is served from the repo root", r.status, 200);
  chk("the served page is the app", r.text.indexOf("CLEARANCE") > 0, true);

  const trav = await get("/../../windows/win.ini");
  chk("path traversal is refused", trav.status === 403 || trav.status === 404, true);

  r = await get("/nope.txt");
  chk("a missing file is a 404", r.status, 404);

  await new Promise(function (res) { S.server.close(res); });
  globalThis.fetch = realFetch;
  console.log("\n" + pass + " passed, " + fail + " failed");
  if (fail) process.exit(1);
}

main().catch(function (e) { console.error(e); process.exit(1); });
