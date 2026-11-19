// Provider tests for the CLEARANCE identification sidecar.
//   node tests/provider.test.js
// Pure functions only, no network. The ACRCloud signature is checked against a
// vector computed independently in Python, not against this code.

const P = require("../server/providers.js");

let pass = 0, fail = 0;
function chk(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? "PASS " : "FAIL ") + name + "  got=" + JSON.stringify(got) + (ok ? "" : "  want=" + JSON.stringify(want)));
}

/* ---------------------------------------------------------------- ACRCloud signature */
/* Independent vector: python3 -c "import hmac,hashlib,base64;
   s='POST\n/v1/identify\ntestkey\naudio\n1\n1700000000.5';
   print(base64.b64encode(hmac.new(b'testsecret', s.encode(), hashlib.sha1).digest()).decode())" */
const cfgA = { ACRCLOUD_HOST: "identify-eu-west-1.acrcloud.com", ACRCLOUD_ACCESS_KEY: "testkey", ACRCLOUD_ACCESS_SECRET: "testsecret" };
chk("ACRCloud signature matches the independent vector", P.acrcloud.sign(cfgA, 1700000000.5), "J2QVqtVhD/W4vPHcblB1CTfhBck=");
chk("ACRCloud signature is stable for the same inputs", P.acrcloud.sign(cfgA, 1700000000.5), P.acrcloud.sign(cfgA, 1700000000.5));
chk("ACRCloud signature changes with the timestamp", P.acrcloud.sign(cfgA, 1700000000.5) === P.acrcloud.sign(cfgA, 1700000001.5), false);
chk("ACRCloud signature changes with the secret",
  P.acrcloud.sign({ ACRCLOUD_ACCESS_KEY: "testkey", ACRCLOUD_ACCESS_SECRET: "other" }, 1700000000.5) === "J2QVqtVhD/W4vPHcblB1CTfhBck=", false);

const sample = { buffer: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), filename: "cue.wav" };
const builtA = P.acrcloud.build(cfgA, sample, 1700000000.5);
chk("ACRCloud url is https host plus the identify path", builtA.url, "https://identify-eu-west-1.acrcloud.com/v1/identify");
chk("ACRCloud method is POST", builtA.init.method, "POST");
chk("ACRCloud content type carries a boundary", /^multipart\/form-data; boundary=----clearance[0-9a-f]{24}$/.test(builtA.init.headers["Content-Type"]), true);
chk("ACRCloud content length matches the body", Number(builtA.init.headers["Content-Length"]), builtA.init.body.length);
chk("ACRCloud host tolerates a scheme and a trailing slash",
  P.acrcloud.build(Object.assign({}, cfgA, { ACRCLOUD_HOST: "https://foo.acrcloud.com/" }), sample, 1).url, "https://foo.acrcloud.com/v1/identify");
["sample_bytes", "access_key", "data_type", "signature_version", "signature", "timestamp", 'name="sample"'].forEach(function (k) {
  chk("ACRCloud body carries " + k, builtA.init.body.toString("binary").indexOf(k) >= 0, true);
});
chk("ACRCloud sample bytes is the buffer length", builtA.init.body.toString("binary").indexOf("sample_bytes") >= 0, true);
chk("ACRCloud sends the sample bytes themselves", builtA.init.body.indexOf(sample.buffer) > 0, true);

/* ---------------------------------------------------------------- AudD */
const cfgU = { AUDD_API_TOKEN: "abc123" };
const builtU = P.audd.build(cfgU, sample);
chk("AudD url", builtU.url, "https://api.audd.io/");
chk("AudD method is POST", builtU.init.method, "POST");
const ub = builtU.init.body.toString("binary");
["api_token", "abc123", "return", "apple_music,spotify", 'name="file"', "cue.wav"].forEach(function (k) {
  chk("AudD body carries " + k, ub.indexOf(k) >= 0, true);
});
chk("AudD content length matches the body", Number(builtU.init.headers["Content-Length"]), builtU.init.body.length);
chk("AudD sends the sample bytes themselves", builtU.init.body.indexOf(sample.buffer) > 0, true);

/* ---------------------------------------------------------------- parsing */
const auddHit = P.audd.parse({ status: "success", result: { artist: "Tears For Fears", title: "Everybody Wants To Rule The World", album: "Songs From The Big Chair", release_date: "2014-11-10", label: "UMC", timecode: "00:57", song_link: "https://lis.tn/NbkVb" } });
chk("AudD hit is ok", auddHit.ok, true);
chk("AudD hit names the track", auddHit.match.title, "Everybody Wants To Rule The World");
chk("AudD hit names the artist", auddHit.match.artist, "Tears For Fears");
chk("AudD hit names the label", auddHit.match.label, "UMC");
chk("AudD hit keeps the timecode", auddHit.match.timecode, "00:57");
chk("AudD no match is an answer, not a fault", P.audd.parse({ status: "success", result: null }).match, null);
chk("AudD no match is still ok", P.audd.parse({ status: "success", result: null }).ok, true);
chk("AudD error is reported", P.audd.parse({ status: "error", error: { error_code: 901, error_message: "bad token" } }).ok, false);
chk("AudD error message is passed through", P.audd.parse({ status: "error", error: { error_message: "bad token" } }).error, "bad token");
chk("AudD null json is an error", P.audd.parse(null).ok, false);

const acrHit = P.acrcloud.parse({ status: { code: 0, msg: "Success" }, metadata: { music: [{ title: "Africa", artists: [{ name: "Toto" }, { name: "Guest" }], album: { name: "Toto IV" }, label: "Columbia", release_date: "1982-04-08", score: 97, play_offset_ms: 12000 }] } });
chk("ACRCloud hit is ok", acrHit.ok, true);
chk("ACRCloud hit names the track", acrHit.match.title, "Africa");
chk("ACRCloud joins multiple artists", acrHit.match.artist, "Toto, Guest");
chk("ACRCloud keeps the label", acrHit.match.label, "Columbia");
chk("ACRCloud keeps the score", acrHit.match.score, 97);
chk("ACRCloud reports the offset in seconds", acrHit.match.timecode, "12s into the track");
chk("ACRCloud code 1001 is a no match", P.acrcloud.parse({ status: { code: 1001, msg: "No result" } }).match, null);
chk("ACRCloud code 1001 is not a fault", P.acrcloud.parse({ status: { code: 1001 } }).ok, true);
chk("ACRCloud bad key is a fault", P.acrcloud.parse({ status: { code: 3001, msg: "Invalid Access Key" } }).ok, false);
chk("ACRCloud limit is a fault", P.acrcloud.parse({ status: { code: 3003, msg: "Limit exceeded" } }).ok, false);
chk("ACRCloud empty music list is a no match", P.acrcloud.parse({ status: { code: 0 }, metadata: {} }).match, null);

/* ---------------------------------------------------------------- config */
chk("a token picks AudD", P.resolveConfig({ AUDD_API_TOKEN: "x" }, null).provider, "audd");
chk("an access key picks ACRCloud", P.resolveConfig({ ACRCLOUD_ACCESS_KEY: "x" }, null).provider, "acrcloud");
chk("an explicit provider wins", P.resolveConfig({ IDENTIFY_PROVIDER: "acrcloud", AUDD_API_TOKEN: "x" }, null).provider, "acrcloud");
chk("the config file is used when the env is empty", P.resolveConfig({}, { AUDD_API_TOKEN: "x" }).provider, "audd");
chk("the env overrides the config file", P.resolveConfig({ AUDD_API_TOKEN: "y" }, { AUDD_API_TOKEN: "x" }).AUDD_API_TOKEN, "y");
chk("nothing configured is not ready", P.describe(P.resolveConfig({}, null)).ready, false);
chk("nothing configured names the missing key", P.describe(P.resolveConfig({}, null)).missing.join(","), "AUDD_API_TOKEN");
chk("AudD configured is ready", P.describe({ provider: "audd", AUDD_API_TOKEN: "x" }).ready, true);
chk("ACRCloud needs all three keys", P.describe({ provider: "acrcloud", ACRCLOUD_HOST: "h", ACRCLOUD_ACCESS_KEY: "k" }).ready, false);
chk("ACRCloud with all three is ready", P.describe({ provider: "acrcloud", ACRCLOUD_HOST: "h", ACRCLOUD_ACCESS_KEY: "k", ACRCLOUD_ACCESS_SECRET: "s" }).ready, true);

/* ---------------------------------------------------------------- identify, mocked */
(async function () {
  let seen = null;
  const fakeFetch = async function (url, init) { seen = { url: url, init: init }; return { status: 200, text: async () => JSON.stringify({ status: "success", result: { artist: "A", title: "T", label: "L" } }) }; };
  const hit = await P.identify({ provider: "audd", AUDD_API_TOKEN: "x" }, sample, { fetch: fakeFetch });
  chk("identify calls the provider url", seen.url, "https://api.audd.io/");
  chk("identify returns a normalised match", hit.match.title, "T");
  chk("identify labels the provider", hit.providerLabel, "AudD");
  chk("identify reports ok", hit.ok, true);

  const noMatch = await P.identify({ provider: "audd", AUDD_API_TOKEN: "x" }, sample, { fetch: async () => ({ status: 200, text: async () => '{"status":"success","result":null}' }) });
  chk("identify reports a no match as ok with a null match", noMatch.ok === true && noMatch.match === null, true);

  const broke = await P.identify({ provider: "audd", AUDD_API_TOKEN: "x" }, sample, { fetch: async () => { throw new Error("getaddrinfo ENOTFOUND"); } });
  chk("identify survives a network failure", broke.ok, false);
  chk("identify explains the network failure", broke.error.indexOf("could not reach AudD") === 0, true);

  const html = await P.identify({ provider: "audd", AUDD_API_TOKEN: "x" }, sample, { fetch: async () => ({ status: 502, text: async () => "<html>bad gateway</html>" }) });
  chk("identify survives a non JSON response", html.ok, false);
  chk("identify reports the http status", html.error.indexOf("HTTP 502") > 0, true);

  const unset = await P.identify({ provider: "acrcloud" }, sample, { fetch: fakeFetch });
  chk("identify refuses when unconfigured", unset.ok, false);
  chk("identify names the missing keys", unset.missing.join(","), "ACRCLOUD_HOST,ACRCLOUD_ACCESS_KEY,ACRCLOUD_ACCESS_SECRET");

  console.log("\n" + pass + " passed, " + fail + " failed");
  if (fail) process.exit(1);
})();
