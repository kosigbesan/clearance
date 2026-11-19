# CLEARANCE

**No film goes up uncleared.**

A pre-upload clearance desk for films going to YouTube. Drop the finished cut,
get every music cue with a timecode and a still from the scene, declare where
each sound came from, and walk out with the certificate and the file hash that
answer a claim when it arrives.

Built after a Nollywood producer had to pull her film down because her editor's
sound folder contained copyrighted audio.

## Use it

Open `index.html`. Everything runs in the browser. No film, no audio and no cue
sheet ever leaves the machine.

Add `?demo=1` to the URL for a worked example.

## What it does

- Finds music cues by their rhythmic pulse, and timecodes each one
- Shows a still from the scene so you can tell which sound is which
- Reports whether a cue sits under dialogue, which decides whether a claim can
  be muted out or forces a re-edit
- Measures loudness against YouTube's playback level, sample peak, clipping,
  stereo phase and silent gaps
- Scores each cue by the route it came from and the paperwork behind it
- Generates the clearance certificate, the cue sheet as CSV, and a dispute
  statement built on a rights basis
- Triages the editor's sound folder from a pasted listing

Optional, with one free token:

- Names the track. Twelve seconds of each cue go to a recognition catalogue and
  come back with a title, an artist and a label. An identified released
  recording stops the cue on the spot.
- Marks your score with an inaudible forensic pattern, so that when somebody
  lifts your soundtrack off the film, the extracted audio carries proof of where
  it came from. Survives AAC, MP3, a level change, a trim, and an eight second
  excerpt.

## Naming tracks

`server/` is a small sidecar, no dependencies, that holds the API token the
browser must never have. It sends twelve second snippets, never the film.

```bash
AUDD_API_TOKEN=your_token node server/index.js
```

300 requests are free at https://audd.io and a film is about ten. ACRCloud works
too: set `ACRCLOUD_HOST`, `ACRCLOUD_ACCESS_KEY` and `ACRCLOUD_ACCESS_SECRET`.
Or keep them in `~/.clearance/identify.json`. Then put the address,
`http://localhost:8787`, in the app and press Check the server.

## What it does not do

It cannot query YouTube's Content ID. Nothing outside YouTube can. A catalogue
match means a released recording and a likely claim. No match is weak evidence,
not a clearance: a track can sit in Content ID without being in a recognition
catalogue, and an unreleased score is in neither. The tool
finds the music and holds the paperwork; the real Content ID scan happens in the
upload flow, for free, and the Shield view explains how to use it.

A sustained score with no percussion is not detected. Place it by hand in the
cue sheet.

Read `BRIEFING.md` for the measured calibration, the documented failure modes in
Nigerian film distribution, and the pricing model.
