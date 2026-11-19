"""Generate ground truth audio for the CLEARANCE end to end test.

Builds a 64 second stereo WAV whose contents are known to the second:

    0 to  8   speech-like   (band limited noise, syllabic envelope at 4.5 Hz)
    8 to 28   music         (120 BPM kick, bass, chords, decorrelated stereo)
   28 to 36   speech-like
   36 to 56   music         (90 BPM, narrower image)
   56 to 64   near silence

Then muxes it into an MP4 so the browser path exercises decodeAudioData on an
AAC track inside an MP4 container, which is the real input a producer has.

Ground truth is written to truth.json for the harness to compare against.
"""
import json
import os
import subprocess
import wave

import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))

SEGMENTS = [
    ("speech", 0.0, 8.0),
    ("music", 8.0, 28.0),
    ("speech", 28.0, 36.0),
    ("music", 36.0, 56.0),
    ("silence", 56.0, 64.0),
]
DUR = 64.0


def band_noise(n, lo, hi, seed):
    rng = np.random.default_rng(seed)
    x = rng.standard_normal(n)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    X[(f < lo) | (f > hi)] = 0
    y = np.fft.irfft(X, n)
    return y / (np.max(np.abs(y)) + 1e-9)


def speech(n, seed):
    """A syllable train rather than a tremolo.
    Real dialogue is a sequence of irregular bursts at roughly 3 to 6 syllables
    a second, with breaths between phrases and formants that drift. A fixed
    amplitude modulation is not speech, and a classifier tuned on one would be
    tuned on nothing, so the bursts are placed at random intervals and the
    formants move.
    """
    rng = np.random.default_rng(seed)
    env = np.zeros(n)
    i = int(0.15 * SR)
    while i < n - SR // 8:
        # a syllable: fast attack, slower decay
        dur = int(rng.uniform(0.09, 0.26) * SR)
        a = int(dur * 0.12)
        burst = np.concatenate([
            np.linspace(0, 1, max(a, 1)),
            np.exp(-np.linspace(0, 3.4, max(dur - a, 1))),
        ]) * rng.uniform(0.55, 1.0)
        burst = burst[:min(len(burst), n - i)]
        env[i:i + len(burst)] += burst
        i += dur + int(rng.uniform(0.02, 0.16) * SR)
        if rng.random() < 0.10:              # a breath between phrases
            i += int(rng.uniform(0.25, 0.6) * SR)

    # a formant-ish tilt: more energy low, rolled off high, plus a little
    # harmonic buzz so the spectrum is not pure noise
    t = np.arange(n) / SR
    body = band_noise(n, 120, 900, seed + 31) * 0.55
    mids = band_noise(n, 900, 2400, seed + 32) * 0.30
    top = band_noise(n, 2400, 3600, seed + 33) * 0.12
    buzz = sum(np.sin(2 * np.pi * 118 * (k + 1) * t) / (k + 1) for k in range(9)) * 0.05
    out = body + mids + top + buzz
    # a recording never has digital silence between syllables: there is always
    # room tone, and that floor is what stops a gate from eating the dialogue
    room = band_noise(n, 60, 6000, seed + 40) * 0.012
    sig = out * env * 0.85 + room
    # level the dialogue to the same loudness as the music, which is what a
    # film mix does
    rms = np.sqrt(np.mean(sig ** 2))
    return sig / (rms + 1e-9) * 0.10


def music(n, bpm, seed, wide):
    """A drum pattern with bass and chords, in stereo.

    A real song has percussive transients on every beat, which is what a
    rhythm detector looks for, so the kit carries the pattern rather than a
    single decaying sine.
    """
    t = np.arange(n) / SR
    beat = 60.0 / bpm
    rng = np.random.default_rng(seed)
    kick = np.exp(-18 * np.mod(t, beat)) * np.sin(2 * np.pi * (48 + 40 * np.exp(-30 * np.mod(t, beat))) * t)
    snare = rng.standard_normal(n) * np.exp(-26 * np.mod(t + beat / 2, beat))
    snare = snare * 0.5 + np.sin(2 * np.pi * 190 * t) * np.exp(-24 * np.mod(t + beat / 2, beat)) * 0.3
    hats = rng.standard_normal(n) * np.exp(-80 * np.mod(t, beat / 2))
    prog = [110.0, 146.83, 164.81, 130.81]
    bass = np.zeros(n)
    chords = np.zeros(n)
    for i, f0 in enumerate(prog):
        a, b = int(i * n / 4), int((i + 1) * n / 4)
        seg = np.arange(b - a) / SR
        nb = int((b - a) / beat / 2)
        benv = np.zeros(b - a)
        for k in range(nb):
            p = int(k * beat * 2 * SR)
            if p >= b - a:
                break
            q = min(p + int(beat * 1.6 * SR), b - a)
            benv[p:q] = np.maximum(benv[p:q], np.exp(-np.linspace(0, 3, q - p)))
        bass[a:b] = 0.42 * np.sin(2 * np.pi * f0 / 2 * seg) * benv
        chords[a:b] = 0.10 * np.sin(2 * np.pi * f0 * seg) + 0.07 * np.sin(2 * np.pi * f0 * 1.5 * seg)
    mono = 0.5 * kick + 0.22 * snare + 0.16 * hats + bass + chords
    if wide:
        det = 0.6 * band_noise(n, 900, 7000, seed + 7)
        L = mono + 0.30 * det
        R = mono - 0.30 * det
    else:
        L = mono + 0.05 * band_noise(n, 900, 7000, seed + 8)
        R = mono
    return L, R


def build():
    n = int(DUR * SR)
    L = np.zeros(n)
    R = np.zeros(n)
    for i, (kind, a, b) in enumerate(SEGMENTS):
        s, e = int(a * SR), int(b * SR)
        m = e - s
        if kind == "speech":
            v = speech(m, 1000 + i)
            L[s:e] = v
            R[s:e] = v
        elif kind == "music":
            bpm = 120 if i == 1 else 90
            l, r = music(m, bpm, 2000 + i, wide=(i == 1))
            L[s:e] = l
            R[s:e] = r
        else:
            L[s:e] = 0.0
            R[s:e] = 0.0
    # short crossfades so the joins are not clicks
    for _, a, _ in SEGMENTS[1:]:
        i = int(a * SR)
        w = int(0.02 * SR)
        L[i - w:i] *= np.linspace(1, 0, w)
        R[i - w:i] *= np.linspace(1, 0, w)
        L[i:i + w] *= np.linspace(0, 1, w)
        R[i:i + w] *= np.linspace(0, 1, w)
    peak = max(np.max(np.abs(L)), np.max(np.abs(R)))
    L, R = L / peak * 0.82, R / peak * 0.82

    wav = os.path.join(HERE, "truth.wav")
    with wave.open(wav, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        inter = np.empty(n * 2, dtype=np.int16)
        inter[0::2] = np.clip(L * 32767, -32768, 32767).astype(np.int16)
        inter[1::2] = np.clip(R * 32767, -32768, 32767).astype(np.int16)
        w.writeframes(inter.tobytes())

    mp4 = os.path.join(HERE, "truth.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", "color=c=#101820:s=320x180:d=64:r=25",
        "-i", wav, "-shortest",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", mp4,
    ], check=True)

    with open(os.path.join(HERE, "truth.json"), "w", encoding="utf-8") as f:
        json.dump({
            "duration": DUR,
            "segments": [{"type": k, "start": a, "end": b} for k, a, b in SEGMENTS],
            "music": [[a, b] for k, a, b in SEGMENTS if k == "music"],
            "wav": wav, "mp4": mp4,
        }, f, indent=1)
    print("truth.wav and truth.mp4 written")
    print("music cues expected at 8.0 to 28.0 and 36.0 to 56.0")


if __name__ == "__main__":
    build()
