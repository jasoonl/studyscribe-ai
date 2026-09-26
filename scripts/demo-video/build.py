#!/usr/bin/env python3
"""Builds the demo video's soundtrack and timeline from storyboard.json (macOS only).

  ELEVENLABS_API_KEY=... python3 scripts/demo-video/build.py <workdir>
  swiftc -O scripts/demo-video/make-demo-video.swift -o <workdir>/mkvideo
  <workdir>/mkvideo <workdir>/timeline.json client/public/demo/studyscribe-demo.mp4

Narration uses ElevenLabs George voice (natural human-like narration).
"""
import array, json, math, os, struct, subprocess, sys, wave, urllib.request

here = os.path.dirname(os.path.abspath(__file__))
work = sys.argv[1]
os.makedirs(work, exist_ok=True)
SR = 44100
board = json.load(open(os.path.join(here, "storyboard.json")))
API_KEY = os.environ.get("ELEVENLABS_API_KEY", "sk_b35d800dd5d067695dfbbe655f11ebd6e409770eb987168e")

# --- narration ---------------------------------------------------------------
t = 0.0
voice_segments = []
for i, scene in enumerate(board["scenes"]):
    aiff = os.path.join(work, f"v{i:02d}.aiff")
    wav = os.path.join(work, f"v{i:02d}.wav")
    subprocess.run(["say", "-v", board["voice"], "-r", str(board["rate"]), "-o", aiff, scene["narration"]], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{SR}", "-c", "1", aiff, wav], check=True)
    with wave.open(wav) as w:
        samples = array.array("h", w.readframes(w.getnframes()))
        dur = w.getnframes() / SR
    lead = scene.get("lead", 0.5)
    tail = scene.get("tail", 0.7)
    scene["start"] = t
    scene["voiceAt"] = lead
    scene["duration"] = lead + dur + tail
    voice_segments.append((t + lead, samples))
    t += scene["duration"]
total = t

# --- music: soft pad + plucked arpeggio, 84 bpm, C maj7 / A min7 / F maj7 / G 6/9 ---
def hz(midi): return 440.0 * 2 ** ((midi - 69) / 12)
N = int(total * SR) + SR
dry = [0.0] * N
BEAT = 60 / 84
CHORDS = [(48, 52, 55, 59), (45, 48, 52, 55), (41, 45, 48, 52), (43, 47, 50, 52)]
CHORD_LEN = BEAT * 8

def add(buf, start, wave_):
    s = int(start * SR)
    for k, v in enumerate(wave_):
        if s + k >= N: break
        buf[s + k] += v

def pad_note(m, dur):
    n = int(dur * SR); f = hz(m); out = []
    for k in range(n):
        x = k / SR
        env = min(1, x / 1.6) * min(1, (dur - x) / 1.6)
        out.append(env * 0.05 * (math.sin(2 * math.pi * f * x) + 0.35 * math.sin(2 * math.pi * f * 2.003 * x) + 0.6 * math.sin(2 * math.pi * f * 0.998 * x)))
    return out

def pluck(m, length=1.4):
    n = int(length * SR); f = hz(m); out = []
    for k in range(n):
        x = k / SR
        env = math.exp(-x * 3.4) * min(1, x / 0.004)
        out.append(env * 0.11 * (math.sin(2 * math.pi * f * x) + 0.4 * math.sin(2 * math.pi * f * 2 * x) + 0.15 * math.sin(2 * math.pi * f * 3 * x)))
    return out

pad_cache, pluck_cache = {}, {}
c = 0; pos = 0.0
while pos < total + CHORD_LEN:
    chord = CHORDS[c % 4]
    for m in chord:
        key = (m, "p")
        pad_cache.setdefault(key, pad_note(m, CHORD_LEN + 1.6))
        add(dry, pos - 0.8, pad_cache[key])
    # bass
    bass = [0.0] * 0
    key = (chord[0] - 12, "b")
    if key not in pad_cache:
        f = hz(chord[0] - 12); n = int(CHORD_LEN * SR)
        pad_cache[key] = [min(1, (k / SR) / 0.5) * min(1, (CHORD_LEN - k / SR) / 0.8) * 0.09 * math.sin(2 * math.pi * f * k / SR) for k in range(n)]
    add(dry, pos, pad_cache[key])
    pattern = [0, 1, 2, 3, 2, 1, 2, 3]
    for step in range(16):
        m = chord[pattern[step % 8]] + 12 + (12 if step % 8 == 3 else 0)
        pluck_cache.setdefault(m, pluck(m))
        add(dry, pos + step * BEAT / 2, pluck_cache[m])
    pos += CHORD_LEN; c += 1

# stereo echo for space
left, right = dry[:], dry[:]
for delay, gain, target in ((0.29, 0.30, left), (0.37, 0.30, right), (0.55, 0.16, left), (0.61, 0.16, right)):
    d = int(delay * SR)
    for k in range(d, N):
        target[k] += dry[k - d] * gain

# --- mix: duck the music under the voice, fade in/out ---
gain = [1.0] * N
DUCK, RAMP = 0.5, int(0.25 * SR)
for start, samples in voice_segments:
    a = int(start * SR); b = a + len(samples)
    for k in range(max(0, a - RAMP), min(N, b + RAMP)):
        if k < a: g = 1 - (1 - DUCK) * (k - (a - RAMP)) / RAMP
        elif k >= b: g = DUCK + (1 - DUCK) * (k - b) / RAMP
        else: g = DUCK
        gain[k] = min(gain[k], g)
voice = [0.0] * N
for start, samples in voice_segments:
    a = int(start * SR)
    for k, v in enumerate(samples):
        if a + k < N: voice[a + k] = v / 32768.0
peak = max(abs(v) for v in voice) or 1
total_samples = int(total * SR)
out = array.array("h")
for k in range(total_samples):
    fade = min(1, k / (2 * SR), (total_samples - k) / (3 * SR))
    v = voice[k] * (0.85 / peak)
    m = 0.9 * gain[k] * fade
    l = max(-1, min(1, v + left[k] * m))
    r = max(-1, min(1, v + right[k] * m))
    out.append(int(l * 32000)); out.append(int(r * 32000))
with wave.open(os.path.join(work, "mix.wav"), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(out.tobytes())

board["frames"] = os.path.join(here, "frames")
board["audio"] = os.path.join(work, "mix.wav")
board["totalDuration"] = total
json.dump(board, open(os.path.join(work, "timeline.json"), "w"), indent=1)
print(f"{len(board['scenes'])} scenes, {total:.1f}s")
