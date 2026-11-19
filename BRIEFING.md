# CLEARANCE

A pre-upload clearance desk for films going to YouTube.

The idea came from a video a Nollywood producer posted on 19 November 2026. Ego
Nwosu had released *Behind His Eyes*, and over two days it was demonetised
twice and then pulled. Her words:

> My editor made a very huge mistake and made use of some sound that YouTube
> has copyrighted those sounds, and we've had to be taking the sounds down one
> after another and it's been a great challenge so far.

Two things stand out in that. The sounds came from the **editor's** library, not
from a decision she made. And the fix was attempted **after** the film was
public, one sound at a time, which is the most expensive possible order to do it
in. That is the whole product thesis: the failure is in the post-production
supply chain, and it is discovered at the worst possible moment.

---

## 1. What this actually is, and what it is not

There is **no public way to query Content ID** before uploading. Content ID is
open only to rights holders who can evidence exclusive rights, the reference
database is not queryable by anyone else, and no third party can offer a real
verdict. Every tool claiming otherwise is matching your audio against a music
recognition catalogue, which is a probability, not a verdict, and none of them
cover the case that is actually hurting Nollywood (see section 4).

What is true, and almost nobody in the industry uses, is that **YouTube already
runs a Content ID scan on your film for free, before it goes public**. It sits in
the upload flow under Checks, it takes minutes, and it reports which segment
matched and who claimed it. The problem is not that the scan is missing. The
problem is that the warning screen before publishing appears for ad suitability
but **not** for copyright, so YouTube will let a producer publish with a claim
pending, and that when the claim lands nobody knows which of four hundred sounds
in the film is the one being flagged.

So CLEARANCE does the two things that are genuinely possible:

1. **It finds the music.** Every cue gets a timecode, a still from the scene,
   and a measurement of whether it sits under dialogue.
2. **It makes the paperwork exist before the claim does.** A certificate, a cue
   sheet, a file hash, and a dispute statement that stands on a rights basis
   rather than on the five things YouTube explicitly does not accept.

The film never leaves the machine. That is a product decision, not a technical
one: no producer is handing a finished film to a stranger's server, and the
analysis is cheap enough to run locally.

---

## 2. How the cue finder works

Everything runs in the browser on the decoded audio, at 22 kHz, in 1024 sample
frames with a Hann window.

Per frame: RMS, spectral centroid, spectral flatness, spectral crest, zero
crossing rate, spectral flux, and stereo correlation. Two features are built
from those over time:

- **Syllabic modulation.** A windowed DFT of the level envelope, and the share
  of the 1.2 to 8 Hz band that sits **above 3 Hz**. Speech puts its modulation
  at syllable rate, 3 to 6 Hz. A song puts it at the tempo, which for anything
  from 70 to 180 BPM is 1.2 to 3 Hz. So the ratio separates them.
- **Tempo stability.** The onset envelope is normalised against its own local
  mean, autocorrelated at **every integer lag** between 60 and 190 BPM, and
  scored by how far the best lag stands out from the mean of all lags. That
  score is then weighted by how many neighbouring frames agree on the same
  tempo.

The second feature is the one that matters, and it took three attempts to get
right. A raw autocorrelation is useless here: it decays for any signal, so
dialogue scores as high as a drum pattern. What dialogue cannot do is **hold a
tempo for seconds at a time**, and that is what the stability weighting
measures.

### The calibration, measured not guessed

`tests/truth.wav` is a synthetic 64 second film with known contents (8s speech,
20s music at 120 BPM, 8s speech, 20s music at 90 BPM, 8s silence).
`tests/realspeech.wav` is the **real** audio from the video that started this,
183 seconds of a woman talking to camera.

Tempo stability score, from `node tests/calibrate.js`:

| Set | p10 | p50 | p90 | p99 | max |
|---|---|---|---|---|---|
| Music (synthetic) | 0.340 | 0.520 | 0.655 | 0.663 | 0.666 |
| Dialogue (synthetic) | 0.044 | 0.086 | 0.143 | 0.221 | 0.270 |
| **Dialogue (real video)** | 0.046 | 0.077 | 0.173 | 0.258 | **0.293** |

The highest score real dialogue ever reaches is **0.293**. The lowest score
inside a song is **0.340**. The gate is **0.30**, inside that gap, and there is a
regression test that fails if either side crosses it.

Result on the ground truth: both music cues found, boundaries within 1.3
seconds, **zero** spurious cues inside the speech. Result on the real video:
**zero** cues reported, which is correct, because it is a talking head.

### What it does not find

A sustained written score with no percussion produces no tempo, so the detector
misses it. Rather than pretend otherwise, the interface says so, and the cue
sheet carries a **Place a cue by hand** control so a score can be entered by
timecode and then declared like any other cue. This is the honest version of the
capability: a shortlist to check, not a verdict.

---

## 3. The rest of the analysis

- **Loudness** by BS.1770 style K weighting with gating, reported against
  YouTube's playback level of about -14 LUFS. A film mixed at -22 plays 8 LU
  quieter than the competition and reads as thin on a phone.
- **Sample peak**, flagged above -1 dBFS, with a clip count.
- **Stereo correlation**, and a warning when the channels are out of phase,
  which on a phone speaker partly cancels the music.
- **Silent stretches** over three seconds.
- **Dialogue overlap** per cue, which decides whether a claim can be muted out
  or whether it forces a re-edit.

---

## 3a. Naming the track, and what that costs

The scanner says where the music is. It cannot say what the music is, because
there is no free way to do that. So identification is an optional sidecar: one
small Node service, no dependencies, that takes a **twelve second WAV snippet of
a single cue** and asks a recognition catalogue what it is. Only snippets are
sent, never the film. A ten cue film uploads about two minutes of audio in total.

Two providers, both implemented:

| | AudD | ACRCloud |
|---|---|---|
| Sign up | self serve, https://audd.io | self serve, https://acrcloud.com |
| Auth | one API token | host, access key, secret, HMAC-SHA1 signed |
| Free | 300 requests on signup, no card | 14 day trial |
| Then | about $5 per month for 1,000 requests | quoted, representative around $49 for 20,000 |
| Per film | about ten requests, so roughly $0.05 | less per request, larger commitment |
| Catalogue | music recognition catalogue | 150 million tracks |

AudD is the default because it needs one token and no sales call, and the free
tier covers about thirty films. ACRCloud is there for a house that already has an
account, or wants the larger catalogue and humming recognition.

**Verified live, not just against a mock.** `tests/live_check.sh` posts a twelve
second snippet of AudD's own published sample through the sidecar using AudD's
public `test` token and gets back:

```
Everybody Wants To Rule The World / Tears For Fears
UMC (Universal Music Catalogue) / release 2014-11-10 / offset 00:57   287 ms
```

and posts twelve seconds of the real phone video that started all this, which
correctly comes back `ok: true, match: null` in 82 ms. A no match is an answer,
not a failure, and the code treats it that way.

The request building and response parsing are unit tested for both providers
(70 assertions), including the ACRCloud signature checked against a vector
computed independently in Python rather than against this code. The server
contract is tested end to end with the provider mocked (35 assertions): health,
a match, a no match, a provider error, a network failure, a per request provider
override, an oversized body, and path traversal.

The honest limit, which the interface states: **a catalogue match is not a
Content ID result.** A match means the cue is a released recording and will very
likely be claimed. No match is weak evidence, because a track can sit in Content
ID without being in a recognition catalogue, and an unreleased score is in
neither. Nothing outside YouTube can query Content ID.

---

## 3b. Provenance: making the extracted audio carry proof

This is the answer to the question the producers actually ask, which is not
"which sound is it" but "how do I stop them taking my song".

You cannot. Any audio that plays can be captured, and a distributor will accept
a ripped file. What you *can* do is make the captured audio carry proof of where
it came from, which is what wins the dispute rather than what prevents the theft.

So a mark is embedded in the score before it is mixed into the film. It is a
spread spectrum pattern: eight narrowband carriers between 900 Hz and 5 kHz,
each phase shift keyed by a chip sequence at 20 chips per second, both derived
from a seed that belongs to the production. Detection is a matched filter, and
the statistic is normalised so that audio with no mark reads a small number.

Three decisions were made from measurement rather than taste:

- **The carriers sit in the middle of the spectrum, not at 16 kHz**, because a
  lossy encode throws the top octave away and the mark has to survive one.
- **The chip sequence repeats every four seconds.** The attacker hands over an
  excerpt, not the whole film, so the start offset is unknown. A one off sequence
  cannot be lined up against it. With a periodic pattern the receiver only
  searches one period. This was found by testing a four second trim, which
  defeated the first version.
- **The depth is 44 dB**, chosen from a sweep. The reading falls roughly linearly
  with mark power, and the no mark floor sits near 2.5, so 44 dB still leaves a
  margin of about twenty times.

Measured, on 24 seconds of synthetic score, `node tests/mark.test.js`:

| Condition | Reading |
|---|---|
| No mark at all | 2.16 |
| Mark, wrong seed | 1.9 |
| **Mark, correct seed** | **55.5** |
| After AAC 128 kbps | 52.4 |
| After AAC 96 kbps | 52.5 |
| After MP3 128 kbps | 53.9 |
| After Opus 64 kbps | 53.3 |
| From an eight second excerpt | 17.0 |
| After a 4 s / 7.3 s / 11.1 s trim | found |
| After the level is raised by 7 dB | found |
| A different film's mark, this seed | under the floor |

The floor was checked against a score, a noise bed and a speech like signal, and
against a second file carrying a different production's mark. 22 assertions.

What it is not: it is not a lock, and it does not prove ownership in law. It
proves that a suspect file carries the same pattern that was embedded in your
score, which is a strong piece of evidence and a very awkward fact for somebody
claiming they wrote it. The interface says exactly that, and so does the
certificate.

---

## 3c. What you have to supply

Nothing, for everything above the line. The scan, the cue sheet, the certificate,
the dispute statement, the folder triage and the provenance marking all run in the
browser with no account and no key.

One credential, optional, for naming tracks: an AudD token (one line, 300 free
requests) or the three ACRCloud values. Put it in the environment or in
`~/.clearance/identify.json` and start the sidecar.

---

## 4. The thing the industry is getting wrong

The documented pattern in the Nigerian cases of the last two years is **not** a
producer using somebody else's song. It is a stranger extracting the film's own
soundtrack, pushing it to streaming through a distributor, and letting Content ID
claim the film. The distributor registers the track, the track enters Content ID
as a reference, and every film containing it is claimed automatically.

That is what happened to Bimbo Ademoye three times (*To Be a Friend*, *Where
Love Lives*, *My 30th Wedding*), to Omoni Oboli (*Love In Every Word*), and to
the producer reported by filmmaker Benneth Nwankwo, whose three soundtracks were
AI generated with Suno and were claimed anyway. In one of those cases the
claimant's own public statement was that the *distribution platform* laid the
claim, which is exactly the mechanism.

A checker that only scans for known commercial music **cannot see this attack at
all**, because the track is not in any catalogue on the day the film is uploaded.
What answers it is priority and paperwork: register your own score before the
film goes public, upload private first, read the Copyright column, and hold a
hash and a certificate for the day the claim arrives. CLEARANCE is built around
that sequence, and the Shield view states it in order.

### The traps, in short

1. A claim is not a strike. Three strikes in 90 days ends the channel.
2. YouTube does not warn you about copyright before publishing.
3. A clean check is not final, and YouTube says so.
4. Dispute inside five days or the revenue hold starts late and the earlier money
   is simply gone.
5. Credit, possession of a copy, a short segment, a speed change and not
   monetising are all explicitly **not** valid bases for a dispute.
6. Every new edit is a new fingerprint and a fresh scan, and the views start again.
7. Muting only works when the music is not under dialogue.
8. Your own registration will claim your own channel unless you allowlist it.

---

## 5. Business

The analysis costs nothing to run, so the scan is free forever and the free tier
is the marketing. What is sold is **the record**: the vault, the gate, and the
certificate.

| Tier | Price | Who |
|---|---|---|
| Desk | Free | One producer, one film at a time |
| Studio | N15,000 / month, or $9 | A company releasing monthly; evidence vault with hashes |
| House | N60,000 / month, or $39 | A channel or slate; a publishing gate on the release calendar |
| Per title | $3 per film | Aggregators and channel managers, charged at intake |

The per title tier exists because the **aggregator** carries the strike risk on
the channel, not the producer. On a film with 18 million views, one claimed cue
redirects the advertising on the whole video. That is a five or six figure loss
from a sound nobody chose, and it lands on whoever owns the account.

---

## 6. Files and how to run it

```
index.html               the whole app, one file, no build step, no CDN
src/app.js               the app: state, rendering, rights engine, audio engine
src/mark.js              the provenance mark, embed and detect
src/index.template.html  markup and styles, with an inline marker
build.py                 inlines both scripts and guards the no dash rule
server/index.js          the identification sidecar, no dependencies
server/providers.js      AudD and ACRCloud, request building and parsing
server/package.json      npm start, npm test
tests/logic.test.js      164 tests over the pure functions, including the calibration
tests/render.test.js     73 tests that every view renders real content
tests/mark.test.js       22 tests over the provenance mark, with codec round trips
tests/provider.test.js   70 tests over both providers, no network
tests/server.test.js     35 tests over the sidecar contract, provider mocked
tests/live_check.sh      a real call to AudD with their public test token
tests/gen_truth.py       builds the ground truth film
tests/calibrate.js       prints the per second features and the confusion matrix
tests/e2e_check.py       drives the real app in real Chrome over the ground truth
tests/e2e_one.py         drives the real app over any one file
BRIEFING.md              this document
```

```bash
python build.py
node tests/mark.test.js
node tests/provider.test.js && node tests/server.test.js
bash tests/live_check.sh          # spends nothing, uses AudD's test token
AUDD_API_TOKEN=xxxx node server/index.js   # then open the app and press Check the server
python tests/build_and_run_logic_tests.py C:/Users/elled/clearance/index.html \
       C:/Users/elled/clearance/tests/logic.test.js
python tests/build_and_run_render_tests.py C:/Users/elled/clearance/index.html \
       C:/Users/elled/clearance/tests/render.test.js
python tests/gen_truth.py && node tests/calibrate.js tests/truth.wav \
       music:8-28,music:36-56,speech:0-8,speech:28-36,silence:56-64
python tests/e2e_check.py
```

Add `?demo=1` to the URL to open it with a worked example already loaded.

---

## 7. Sources

Retrieved 19 November 2026.

1. Upload flow and the Checks step, including that the warning screen appears
   for ad suitability but not for copyright: https://support.google.com/youtube/answer/57407
2. Content ID eligibility and the exclusive rights requirement:
   https://support.google.com/youtube/answer/1311402
3. What a claim can do (block, monetise, track), and how to find it in Studio:
   https://support.google.com/youtube/answer/6013276
4. Dispute windows, the five day revenue hold, appeal timing and strike expiry:
   https://geeventech.com/post/youtube-copyright-claims-in-2026-when-to-edit-when-to-dispute-and-when-to-stop-escalating
5. What is not a valid basis for a dispute:
   https://www.churchsocial.ai/blog/youtube-copyright-claim-dispute
6. The hijack pattern, the Suno case, and the advice to register the score and
   upload unlisted first:
   https://www.premiumtimesng.com/entertainment/nollywood/858020-how-nollywood-producers-can-avoid-losing-revenue-to-copyright-claims-on-youtube-filmmaker-benneth-nwankwo.html
7. Bimbo Ademoye, *My 30th Wedding*, and the claimant's own account that the
   distribution platform triggered the claim: https://punchng.com/actress-ademoye-rejects-apology-over-movie-demonetisation/
8. Bimbo Ademoye, *Where Love Lives*: https://guardian.ng/life/film/bimbo-ademoye-battles-demonetisation-on-her-movie-where-love-lives/
9. Omoni Oboli, *Love In Every Word*, taken down on a claim and restored:
   https://guardian.ng/life/film/omoni-obolis-movie-love-in-every-word-returns-to-youtube-after-copyright-claim-takedown/
10. Non-exclusive beat leases and Content ID, and why a licence does not stop a
    claim: https://blog.beatpass.ca/youtube-content-id-and-beats-how-to-avoid-copyright-claims/
11. AI generated audio and distributor Content ID policies, read October 2026:
    https://creativeainews.com/articles/ai-music-youtube-content-id-claims-2026
12. Identification APIs compared, and the fact that none of them is Content ID:
    https://audd.io/resources/articles/best-apis-to-detect-copyrighted-music-in-uploads
13. Scale of the system, over 2.2 billion claims in 2024, over 99 per cent
    automated: https://replayedstudio.com/blog/ai-music-content-id
14. AudD recognition API, the endpoint, the parameters and the response shape:
    https://docs.audd.io/
15. AudD pricing, 300 free requests then about $5 per month for 1,000:
    https://audd.io/pricing/
16. ACRCloud Identification API, the signature string and the request fields,
    including the official Python example this implementation follows:
    https://docs.acrcloud.com/reference/identification-api
    https://github.com/acrcloud/webapi_example
17. ACRCloud pricing structure and the 14 day trial:
    https://acrcloud.com/docs/faq/basic/understand-pricing-chart
