#!/usr/bin/env python3
"""Builds the v2 demo soundtrack and timeline (macOS: afconvert).

  ELEVENLABS_API_KEY=... python3 build_audio.py <workdir>

Narration is the ElevenLabs "George" voice. Scene lengths come from the narration audio, so the
visuals (index.html + render.mjs) always match the voice. Writes <workdir>/mix.wav and timeline.json.
"""
import array, json, math, os, random, subprocess, sys, urllib.request, wave

here = os.path.dirname(os.path.abspath(__file__))
work = sys.argv[1]
os.makedirs(work, exist_ok=True)
SR = 44100
board = json.load(open(os.path.join(here, "storyboard.json")))
API_KEY = os.environ["ELEVENLABS_API_KEY"]
OVERLAP = 0.5  # the next scene starts this long before the previous one finishes fading

t = 0.0
voice_segments = []
for i, scene in enumerate(board["scenes"]):
    mp3, wav = os.path.join(work, f"v{i:02d}.mp3"), os.path.join(work, f"v{i:02d}.wav")
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{board['voice_id']}",
        data=json.dumps({"text": scene["narration"], "model_id": "eleven_flash_v2_5",
                         "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.25}}).encode(),
        headers={"xi-api-key": API_KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as resp, open(mp3, "wb") as f:
        f.write(resp.read())
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{SR}", "-c", "1", mp3, wav], check=True)
    with wave.open(wav) as w:
        samples = array.array("h", w.readframes(w.getnframes()))
        dur = w.getnframes() / SR
    scene["start"], scene["voiceAt"], scene["narDur"] = t, scene["lead"], dur
    scene["dur"] = max(scene["min"], scene["lead"] + dur + scene["tail"])
    voice_segments.append((t + scene["lead"], samples))
    t += scene["dur"]
total = t

N = int(total * SR) + SR
def add(buf, start, data, gain=1.0):
    s = int(start * SR)
    for k, v in enumerate(data):
        if 0 <= s + k < N: buf[s + k] += v * gain

# --- music: soft pad + plucked arpeggio, 84 bpm -------------------------------------------
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
dry = [0.0] * N
BEAT, CHORD_LEN = 60 / 84, (60 / 84) * 8
CHORDS = [(48, 52, 55, 59), (45, 48, 52, 55), (41, 45, 48, 52), (43, 47, 50, 52)]
def pad_note(m, dur):
    n, f = int(dur * SR), hz(m)
    return [min(1, k / SR / 1.6) * min(1, (dur - k / SR) / 1.6) * 0.05 *
            (math.sin(2 * math.pi * f * k / SR) + 0.35 * math.sin(2 * math.pi * f * 2.003 * k / SR) + 0.6 * math.sin(2 * math.pi * f * 0.998 * k / SR)) for k in range(n)]
def pluck(m, length=1.4):
    f = hz(m)
    return [math.exp(-k / SR * 3.4) * min(1, k / SR / 0.004) * 0.11 *
            (math.sin(2 * math.pi * f * k / SR) + 0.4 * math.sin(2 * math.pi * f * 2 * k / SR) + 0.15 * math.sin(2 * math.pi * f * 3 * k / SR)) for k in range(int(length * SR))]
pad_cache, pluck_cache = {}, {}
c, pos = 0, 0.0
while pos < total + CHORD_LEN:
    chord = CHORDS[c % 4]
    for m in chord:
        pad_cache.setdefault(m, pad_note(m, CHORD_LEN + 1.6)); add(dry, pos - 0.8, pad_cache[m])
    bf = hz(chord[0] - 12)
    add(dry, pos, [min(1, k / SR / 0.5) * min(1, (CHORD_LEN - k / SR) / 0.8) * 0.09 * math.sin(2 * math.pi * bf * k / SR) for k in range(int(CHORD_LEN * SR))])
    pattern = [0, 1, 2, 3, 2, 1, 2, 3]
    for step in range(16):
        m = chord[pattern[step % 8]] + 12 + (12 if step % 8 == 3 else 0)
        pluck_cache.setdefault(m, pluck(m)); add(dry, pos + step * BEAT / 2, pluck_cache[m])
    pos += CHORD_LEN; c += 1

left, right = dry[:], dry[:]
for delay, gain, target in ((0.29, 0.30, left), (0.37, 0.30, right), (0.55, 0.16, left), (0.61, 0.16, right)):
    d = int(delay * SR)
    for k in range(d, N): target[k] += dry[k - d] * gain

# --- sound effects: a whoosh at every scene change, a soft tick for every click ----------------
random.seed(7)
def whoosh(length=0.7):
    out, lp = [], 0.0
    for k in range(int(length * SR)):
        x = k / SR / length
        coeff = 0.02 + 0.5 * math.sin(math.pi * min(1, x)) ** 2
        lp += coeff * (random.uniform(-1, 1) - lp)
        out.append(lp * math.sin(math.pi * x) ** 1.5 * 0.5)
    return out
def tick():
    return [math.exp(-k / SR * 90) * 0.12 * (math.sin(2 * math.pi * 1900 * k / SR) + 0.5 * math.sin(2 * math.pi * 3100 * k / SR)) for k in range(int(0.09 * SR))]
sfx_l, sfx_r = [0.0] * N, [0.0] * N
W = whoosh()
for sc in board["scenes"][1:]:
    add(sfx_l, sc["start"] - 0.3, W, 0.55); add(sfx_r, sc["start"] - 0.28, W, 0.55)
T = tick()
for sc in board["scenes"]:
    for frac in sc.get("clicks", []):
        add(sfx_l, sc["start"] + sc["dur"] * frac, T); add(sfx_r, sc["start"] + sc["dur"] * frac, T)

# --- mix: duck the music under the voice, fade in/out ----------------------------------------
gain, DUCK, RAMP = [1.0] * N, 0.5, int(0.25 * SR)
for start, samples in voice_segments:
    a = int(start * SR); b = a + len(samples)
    for k in range(max(0, a - RAMP), min(N, b + RAMP)):
        g = 1 - (1 - DUCK) * (k - (a - RAMP)) / RAMP if k < a else (DUCK + (1 - DUCK) * (k - b) / RAMP if k >= b else DUCK)
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
    fade = min(1, k / (1.5 * SR), (total_samples - k) / (2.5 * SR))
    v, m = voice[k] * (0.85 / peak), 0.9 * gain[k] * fade
    out.append(int(max(-1, min(1, v + left[k] * m + sfx_l[k])) * 32000))
    out.append(int(max(-1, min(1, v + right[k] * m + sfx_r[k])) * 32000))
with wave.open(os.path.join(work, "mix.wav"), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes())
json.dump({"total": total, "overlap": OVERLAP, "scenes": board["scenes"]}, open(os.path.join(work, "timeline.json"), "w"), indent=1)
print(f"{len(board['scenes'])} scenes, {total:.1f}s")
