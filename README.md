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

## What it does not do

It cannot query YouTube's Content ID. Nothing outside YouTube can. The tool
finds the music and holds the paperwork; the real Content ID scan happens in the
upload flow, for free, and the Shield view explains how to use it.

A sustained score with no percussion is not detected. Place it by hand in the
cue sheet.

Read `BRIEFING.md` for the measured calibration, the documented failure modes in
Nigerian film distribution, and the pricing model.
