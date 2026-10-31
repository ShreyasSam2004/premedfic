"""Soundtrack for the PremedFix demo: one piece in D major at 92 BPM.

Music and effects share a key and a room (one reverb), and effects sit under
the music. Cue times come from events.json, exported by the composition.
    python brag-output/work/audio.py brag-output/work/events.json brag-output/work/audio.wav
"""
import json
import sys
import wave

import numpy as np

SR = 44100
ev = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
DUR = float(ev["duration"])
N = int((DUR + 1.0) * SR)
rng = np.random.default_rng(20261031)

music = np.zeros((2, N))
sfx = np.zeros((2, N))


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def t_axis(sec):
    return np.arange(int(sec * SR)) / SR


def add(buf, start, sig, pan=0.0, gain=1.0):
    i = int(round(start * SR))
    if i >= N or len(sig) == 0:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    sig = sig[: N - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[0, i : i + len(sig)] += sig * l * gain
    buf[1, i : i + len(sig)] += sig * r * gain


def band(x, lo, hi):
    """Smooth band-pass in the frequency domain (fine for short segments)."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    w = 1 / (1 + (lo / np.maximum(f, 1)) ** 4) / (1 + (f / hi) ** 4)
    return np.fft.irfft(X * w, len(x))


def env(n, a, r, shape=None):
    e = np.ones(n) if shape is None else shape
    na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    e[:na] *= np.linspace(0, 1, na) ** 2
    e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return e


# ---------------------------------------------------------------------------
# Instruments
# ---------------------------------------------------------------------------


def pad(notes, sec, bright=1.0):
    t = t_axis(sec)
    out = np.zeros_like(t)
    for m in notes:
        f = hz(m)
        for det in (-0.0018, 0.0021):
            for h in range(1, 7):
                if f * h > 6000:
                    break
                out += np.sin(2 * np.pi * f * h * (1 + det) * t + h) * (1 / h**1.7) * (bright if h > 2 else 1)
    out *= 1 + 0.08 * np.sin(2 * np.pi * 0.23 * t)
    return out / (len(notes) * 4.5) * env(len(t), 0.9, 1.3)


def epiano(m, sec=1.4, vel=1.0):
    t = t_axis(sec)
    f = hz(m)
    index = 1.8 * np.exp(-t / 0.25) + 0.25
    s = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * t))
    s += 0.18 * np.sin(2 * np.pi * 4 * f * t) * np.exp(-t / 0.08)
    return s * np.exp(-t / 0.55) * env(len(t), 0.004, 0.25) * vel


def bass(m, sec):
    t = t_axis(sec)
    f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.32 * np.sin(4 * np.pi * f * t) + 0.08 * np.sin(6 * np.pi * f * t)
    return np.tanh(1.3 * s) * (0.75 + 0.25 * np.exp(-t / 0.15)) * env(len(t), 0.012, 0.09)


def kick():
    t = t_axis(0.42)
    f = 46 + 70 * np.exp(-t / 0.035)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    click = band(rng.standard_normal(len(t)), 1500, 5000) * np.exp(-t / 0.004) * 0.15
    return (s + click) * env(len(t), 0.001, 0.05)


def hat(open_=False):
    sec = 0.32 if open_ else 0.07
    t = t_axis(sec)
    return band(rng.standard_normal(len(t)), 6500, 15000) * np.exp(-t / (0.09 if open_ else 0.018)) * env(len(t), 0.001, 0.02)


def clap():
    t = t_axis(0.25)
    n = band(rng.standard_normal(len(t)), 900, 4500)
    e = np.exp(-t / 0.06) + 0.6 * np.exp(-np.maximum(t - 0.012, 0) / 0.05) * (t > 0.012)
    return n * e * env(len(t), 0.001, 0.05)


def bell(m, sec=2.2, vel=1.0):
    t = t_axis(sec)
    f = hz(m)
    s = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / d) for r, a, d in ((1, 1, 1.1), (2.0, 0.45, 0.7), (3.01, 0.22, 0.45), (4.2, 0.12, 0.3)))
    return s * env(len(t), 0.002, 0.4) * vel


def click():
    t = t_axis(0.05)
    n = band(rng.standard_normal(len(t)), 2200, 6500) * np.exp(-t / 0.004)
    tone = np.sin(2 * np.pi * hz(86) * t) * np.exp(-t / 0.012) * 0.5
    return (n + tone) * env(len(t), 0.0005, 0.01)


def tap():
    t = t_axis(0.08)
    tone = np.sin(2 * np.pi * hz(81) * t) * np.exp(-t / 0.02)
    n = band(rng.standard_normal(len(t)), 800, 3000) * np.exp(-t / 0.006) * 0.4
    return (tone + n) * env(len(t), 0.001, 0.02)


def whoosh(sec=0.6):
    t = t_axis(sec)
    n = rng.standard_normal(len(t))
    # Two overlapping bands give a rising sweep without a time-varying filter.
    s = band(n, 300, 1200) * np.sin(np.pi * t / sec) ** 2 * (1 - t / sec) + band(n, 1200, 5000) * np.sin(np.pi * t / sec) ** 3 * (t / sec)
    return s * env(len(t), 0.02, 0.05)


def riser(sec):
    t = t_axis(sec)
    s = band(rng.standard_normal(len(t)), 400, 7000) * (t / sec) ** 2.5
    s += 0.25 * np.sin(2 * np.pi * np.cumsum(hz(62) * (1 + t / sec)) / SR) * (t / sec) ** 2
    return s * env(len(t), 0.2, 0.03)


def boom():
    t = t_axis(1.8)
    s = np.sin(2 * np.pi * np.cumsum(38 + 30 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.55)
    return s * env(len(t), 0.004, 0.3)


# ---------------------------------------------------------------------------
# Arrangement
# ---------------------------------------------------------------------------

BPM = 92
BEAT = 60 / BPM
BAR = 4 * BEAT
T0 = 7.0  # the reveal lands on a downbeat
GROOVE = (17.0, 151.0)

CHORDS = {
    "D": dict(pad=[50, 57, 62, 64, 66, 69], arp=[62, 66, 69, 74, 76, 78], bass=38),
    "Bm": dict(pad=[47, 54, 59, 62, 66, 69], arp=[59, 62, 66, 69, 71, 74], bass=35),
    "G": dict(pad=[43, 50, 59, 62, 66, 69], arp=[59, 62, 66, 67, 71, 74], bass=43),
    "A": dict(pad=[45, 52, 57, 61, 64, 69], arp=[57, 61, 64, 69, 71, 73], bass=45),
}
MAIN = ["D", "Bm", "G", "A"]
SERIOUS = ["Bm", "G", "D", "A"]
ARP = [0, 2, 1, 3, 2, 4, 3, 5]


def section(t):
    if t < 17:
        return "intro"
    if 57 <= t < 70:
        return "phone"
    if 101 <= t < 116:
        return "safeguards"
    if 136 <= t < 151:
        return "austin"
    if t >= 151:
        return "outro"
    return "main"


# Hook: a low swell and a riser into the reveal.
add(music, 0.0, pad([38, 50, 57, 62, 64], 7.4, bright=0.6) * np.linspace(0.1, 1, int(7.4 * SR)) ** 1.5, gain=0.9)
add(sfx, 4.4, riser(2.6), gain=0.22)

bar = 0
while T0 + bar * BAR < DUR - 0.5:
    start = T0 + bar * BAR
    sec = section(start + 0.01)
    if sec == "outro":
        break
    prog = SERIOUS if sec == "safeguards" else MAIN
    ch = CHORDS[prog[bar % 4]]
    add(music, start, pad(ch["pad"], BAR + 1.3, bright=1.25 if sec == "austin" else 1.0), gain=0.85 if sec != "phone" else 0.7)
    # Arpeggio: eighth notes, quieter under the busiest screens, an extra octave for the Austin lift.
    for k in range(8):
        tt = start + k * BEAT / 2
        vel = {"intro": 0.32, "phone": 0.3, "safeguards": 0.32, "austin": 0.42, "main": 0.36}[sec] * (1.0 if k % 2 == 0 else 0.78)
        m = ch["arp"][ARP[k]]
        add(music, tt, epiano(m, vel=vel), pan=-0.25 + 0.5 * (k % 2), gain=0.55)
        if sec == "austin" and k % 2 == 1:
            add(music, tt, epiano(m + 12, sec=0.9, vel=vel * 0.5), pan=0.4, gain=0.45)
    in_groove = GROOVE[0] <= start < GROOVE[1]
    for b in range(4):
        tb = start + b * BEAT
        if in_groove:
            add(music, tb, bass(ch["bass"], BEAT * 0.92), gain=0.42)
            if b in (0, 2):
                add(music, tb, kick(), gain=0.62 if sec != "phone" else 0.45)
            if sec == "austin" and b in (1, 3):
                add(music, tb, clap(), pan=0.1, gain=0.12)
            if sec != "phone":
                add(music, tb + BEAT / 2, hat(open_=(sec == "austin" and b == 3)), pan=0.3, gain=0.07)
        elif start >= T0 and b == 0:
            add(music, tb, bass(ch["bass"], BAR * 0.95), gain=0.3)
    bar += 1

# Outro: drums out, resolve on D, ring out.
OUT_T = 151.0
add(music, OUT_T, pad([38, 50, 57, 62, 64, 66, 69], DUR - OUT_T + 0.8, bright=1.1), gain=0.95)
for k, m in enumerate([62, 66, 69, 74, 76, 78, 81]):
    add(music, OUT_T + 0.35 + k * 0.42, epiano(m, sec=1.8, vel=0.3), pan=-0.3 + 0.1 * k, gain=0.5)

# ---------------------------------------------------------------------------
# Effects, in the same key and room
# ---------------------------------------------------------------------------

add(sfx, 7.0, boom(), gain=0.55)
add(sfx, 7.0, bell(74, vel=0.5), gain=0.16)
add(sfx, 7.0, bell(81, vel=0.4), gain=0.12)

a, b = ev["countUp"]
for k in range(1, 23):
    y = k / 23
    p = 1 - (1 - y) ** (1 / 3)
    add(sfx, a + (b - a) * p, click(), pan=0.0, gain=0.10)
for k, t in enumerate(ev["steps"]):
    add(sfx, t, epiano([74, 76, 78, 81, 83, 86][k % 6], sec=1.2, vel=0.5), pan=-0.5 + 0.2 * k, gain=0.5)
for t in ev["clicks"]:
    add(sfx, t, click(), pan=0.05, gain=0.28)
for t in ev["taps"]:
    add(sfx, t, tap(), pan=0.1, gain=0.31)
for t in ev["whoosh"]:
    add(sfx, t - 0.28, whoosh(), pan=0.0, gain=0.085)
for k, t in enumerate(ev["chimes"]):
    m = [86, 81, 81, 81, 83, 86][k % 6]
    add(sfx, t, bell(m, vel=0.8), pan=0.15, gain=0.13)
for t in ev["end"]:
    add(sfx, t, bell(74, sec=3.5, vel=0.7), gain=0.16)
    add(sfx, t + 0.03, bell(81, sec=3.5, vel=0.5), gain=0.12)

# ---------------------------------------------------------------------------
# Room, mix, master
# ---------------------------------------------------------------------------


def reverb(x, sec=1.7, seed=0):
    r = np.random.default_rng(seed)
    t = t_axis(sec)
    ir = r.standard_normal(len(t)) * np.exp(-t / (sec / 5))
    ir = band(ir, 200, 7000)
    ir /= np.sqrt(np.sum(ir**2))
    n = 1 << int(np.ceil(np.log2(len(x) + len(ir))))
    return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)[: len(x)]


mix = np.zeros((2, N))
for ch in range(2):
    wet_in = music[ch] * 0.22 + sfx[ch] * 0.14
    mix[ch] = music[ch] + sfx[ch] + reverb(wet_in, seed=ch) * 2.2

fade = int(2.4 * SR)
end = int(DUR * SR)
mix[:, end - fade : end] *= np.linspace(1, 0, fade) ** 1.5
mix[:, end:] = 0
mix[:, : int(0.03 * SR)] *= np.linspace(0, 1, int(0.03 * SR))
mix = mix[:, :end]
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(1.4 * mix) / np.tanh(1.4) * 0.89

pcm = (np.clip(mix.T, -1, 1) * 32767).astype("<i2")
with wave.open(OUT, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"wrote {OUT}: {DUR:.1f}s")
