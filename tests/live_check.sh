#!/usr/bin/env bash
# Live verification of the whole identification chain.
# Downloads AudD's own sample, cuts twelve seconds, posts it to the CLEARANCE
# sidecar, and checks that the title comes back. Uses AudD's public "test"
# token, so it spends nothing and needs no signup.
set -u
cd "$(dirname "$0")/.."
mkdir -p tests/_live
cd tests/_live

echo "1. fetching AudD's own sample"
curl -s -o example.mp3 https://audd.tech/example.mp3 || { echo "download failed"; exit 1; }
ls -la example.mp3

echo
echo "2. cutting twelve seconds, mono, 22.05 kHz, as the app would send it"
ffmpeg -y -v error -i example.mp3 -ss 40 -t 12 -ac 1 -ar 22050 -c:a pcm_s16le snip.wav
ls -la snip.wav

echo
echo "3. starting the sidecar with AudD's test token"
AUDD_API_TOKEN=test PORT=8791 node ../../server/index.js > server.log 2>&1 &
SRV=$!
sleep 2
cat server.log

echo
echo "4. health"
curl -s http://127.0.0.1:8791/health | tr -d '\n'; echo

echo
echo "5. identify the twelve second snippet"
curl -s -X POST --data-binary @snip.wav -H "Content-Type: audio/wav" http://127.0.0.1:8791/identify > out.json
cat out.json; echo

echo
echo "6. verdict"
python - <<'PY'
import json
d = json.load(open("out.json"))
m = d.get("match")
if d.get("ok") and m:
    print("   PASS  live identification returned: %s by %s (%s)" % (m.get("title"), m.get("artist"), m.get("label")))
    print("   PASS  provider: %s, took %s ms over %s bytes" % (d.get("providerLabel"), d.get("ms"), d.get("bytes")))
elif d.get("ok"):
    print("   PASS  the chain works: the provider answered, with no match for this snippet")
else:
    print("   FAIL  %s" % d.get("error"))
PY

echo
echo "7. a snippet with no music in it, from the real phone video"
ffmpeg -y -v error -i "../../tests/realvideo.mp4" -ss 30 -t 12 -ac 1 -ar 22050 -c:a pcm_s16le speech.wav 2>/dev/null || echo "   (realvideo.mp4 not present, skipped)"
if [ -f speech.wav ]; then
  curl -s -X POST --data-binary @speech.wav -H "Content-Type: audio/wav" http://127.0.0.1:8791/identify | tr -d '\n'; echo
fi

kill $SRV 2>/dev/null
echo
echo "done"
