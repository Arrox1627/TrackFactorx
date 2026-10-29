// Procedural soundtrack for the reel: a 133⅓ BPM music bed plus sound effects, synthesised from the cue sheet
// that src/reel.js exports (window.REEL.audio). Everything is generated here: no samples, nothing to license.
//
//   renderSoundtrack(audio) -> { left, right, sampleRate, loudness }   (mastered to -14 LUFS, peaks <= -1.2 dBFS)
//   writeWav(path, track)                                               (16-bit PCM)
import { writeFileSync } from 'node:fs';

export const SAMPLE_RATE = 48000;
const SR = SAMPLE_RATE;
const TAU = Math.PI * 2;
const TARGET_LUFS = -14;
const CEILING = 10 ** (-1.5 / 20); // true peak; leaves headroom for AAC encoding

// ------------------------------------------------------------------ helpers
let seed = 7;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const noise = () => rand() * 2 - 1;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
const panGains = (pan) => {
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
};

// Band-limited saw / square (polyBLEP) — keeps the synths from sounding fizzy.
const blep = (p, dt) => {
  if (p < dt) {
    p /= dt;
    return p + p - p * p - 1;
  }
  if (p > 1 - dt) {
    p = (p - 1) / dt;
    return p * p + p + p + 1;
  }
  return 0;
};
class Osc {
  constructor(freq, phase = rand()) {
    this.f = freq;
    this.p = phase;
  }
  saw() {
    const dt = this.f / SR;
    const v = 2 * this.p - 1 - blep(this.p, dt);
    this.p = (this.p + dt) % 1;
    return v;
  }
  square() {
    const dt = this.f / SR;
    let v = this.p < 0.5 ? 1 : -1;
    v += blep(this.p, dt) - blep((this.p + 0.5) % 1, dt);
    this.p = (this.p + dt) % 1;
    return v;
  }
}

// RBJ cookbook biquad.
class Biquad {
  constructor(type, freq, q = 0.707) {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.type = type;
    this.set(freq, q);
  }
  set(freq, q = this.q) {
    this.q = q;
    const w = (TAU * clamp(freq, 10, SR * 0.45)) / SR;
    const cs = Math.cos(w);
    const a = Math.sin(w) / (2 * q);
    let b0;
    let b1;
    let b2;
    if (this.type === 'lp') [b0, b1, b2] = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2];
    else if (this.type === 'hp') [b0, b1, b2] = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2];
    else [b0, b1, b2] = [a, 0, -a]; // band-pass, 0 dB peak
    const a0 = 1 + a;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - a) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// Every voice renders into a buffer (mono Float32Array or [L, R]); a Bus mixes buffers in at a time + pan.
const buf = (seconds) => new Float32Array(Math.max(1, Math.round(seconds * SR)));
function fadeEdges(x, fadeIn = 0.0005, fadeOut = 0.01) {
  const a = Math.round(fadeIn * SR);
  const b = Math.round(fadeOut * SR);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a;
  for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i] *= i / b;
  return x;
}
class Bus {
  constructor(n) {
    this.L = new Float32Array(n);
    this.R = new Float32Array(n);
  }
  add(sig, t, gain = 1, pan = 0) {
    const start = Math.round(t * SR);
    const [l, r] = Array.isArray(sig) ? sig : [sig, sig];
    const [gl, gr] = Array.isArray(sig) ? [1, 1] : panGains(pan).map((g) => g * Math.SQRT2);
    for (let i = 0; i < l.length; i++) {
      const j = start + i;
      if (j < 0 || j >= this.L.length) continue;
      this.L[j] += l[i] * gain * gl;
      this.R[j] += r[i] * gain * gr;
    }
  }
}

// ------------------------------------------------------------------ effects
class Comb {
  constructor(n) {
    this.b = new Float32Array(n);
    this.i = 0;
    this.s = 0;
  }
  run(x, fb, damp) {
    const y = this.b[this.i];
    this.s = y * (1 - damp) + this.s * damp;
    this.b[this.i] = x + this.s * fb;
    this.i = (this.i + 1) % this.b.length;
    return y;
  }
}
class Allpass {
  constructor(n) {
    this.b = new Float32Array(n);
    this.i = 0;
  }
  run(x) {
    const b = this.b[this.i];
    this.b[this.i] = x + b * 0.5;
    this.i = (this.i + 1) % this.b.length;
    return b - x;
  }
}
// Freeverb (Jezar's tunings, scaled to 48 kHz).
function reverb(bus, { room = 0.84, damp = 0.3 } = {}) {
  const k = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const make = (spread) => ({
    c: combs.map((n) => new Comb(Math.round((n + spread) * k))),
    a: aps.map((n) => new Allpass(Math.round((n + spread) * k))),
  });
  const chans = [make(0), make(23)];
  const out = new Bus(bus.L.length);
  for (let i = 0; i < bus.L.length; i++) {
    const x = (bus.L[i] + bus.R[i]) * 0.015;
    chans.forEach((ch, c) => {
      let y = 0;
      for (const comb of ch.c) y += comb.run(x, room, damp);
      for (const ap of ch.a) y = ap.run(y);
      (c ? out.R : out.L)[i] = y;
    });
  }
  return out;
}
// Ping-pong echo with a darkening feedback path.
function pingPong(bus, time, feedback = 0.38) {
  const d = Math.round(time * SR);
  const bl = new Float32Array(d);
  const br = new Float32Array(d);
  const lpL = new Biquad('lp', 3500);
  const lpR = new Biquad('lp', 3500);
  const out = new Bus(bus.L.length);
  for (let i = 0; i < bus.L.length; i++) {
    const j = i % d;
    const l = bl[j];
    const r = br[j];
    out.L[i] = l;
    out.R[i] = r;
    bl[j] = (bus.L[i] + bus.R[i]) * 0.5 + lpR.run(r) * feedback;
    br[j] = lpL.run(l) * feedback;
  }
  return out;
}

// ------------------------------------------------------------------ drums
function kick() {
  const x = buf(0.42);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    ph += (TAU * (50 + 130 * Math.exp(-t / 0.03))) / SR;
    const body = Math.sin(ph) * Math.min(1, t / 0.0015) * Math.exp(-t / 0.13);
    const knock = Math.sin(TAU * 180 * t) * Math.exp(-t / 0.02) * 0.25;
    x[i] = Math.tanh(1.8 * body + knock) * 0.95 + noise() * Math.exp(-t / 0.0012) * 0.3;
  }
  return fadeEdges(x);
}
function hat(open = false) {
  const x = buf(open ? 0.35 : 0.07);
  const hp = new Biquad('hp', 7500);
  for (let i = 0; i < x.length; i++) x[i] = hp.run(noise()) * Math.exp(-i / SR / (open ? 0.1 : 0.02));
  return fadeEdges(x);
}
function clap() {
  const x = buf(0.32);
  const bp = new Biquad('bp', 1300, 0.9);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    let env = 0.7 * (t > 0.02 ? Math.exp(-(t - 0.02) / 0.09) : 0);
    for (let k = 0; k < 3; k++) if (t >= k * 0.01) env += Math.exp(-(t - k * 0.01) / 0.005);
    x[i] = bp.run(noise()) * env * 1.6;
  }
  return fadeEdges(x);
}
function snare(pitch = 1) {
  const x = buf(0.2);
  const bp = new Biquad('bp', 2000 * pitch, 0.7);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    x[i] = 0.45 * Math.sin(TAU * 190 * pitch * t) * Math.exp(-t / 0.045) + bp.run(noise()) * Math.exp(-t / 0.07) * 1.4;
  }
  return fadeEdges(x);
}
function crash() {
  const L = buf(2.2);
  const R = buf(2.2);
  const hp = [new Biquad('hp', 3500), new Biquad('hp', 3500)];
  for (let i = 0; i < L.length; i++) {
    const env = Math.min(1, i / SR / 0.002) * Math.exp(-i / SR / 0.65);
    L[i] = hp[0].run(noise()) * env;
    R[i] = hp[1].run(noise()) * env;
  }
  return [fadeEdges(L), fadeEdges(R)];
}

// ------------------------------------------------------------------ tonal voices
function bassNote(midi, dur) {
  const x = buf(dur + 0.05);
  const f = midiHz(midi);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const ph = TAU * f * t;
    const env = Math.min(1, t / 0.006) * (t > dur ? Math.exp(-(t - dur) / 0.015) : 1);
    const s = Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph) + 0.08 * Math.sin(4 * ph);
    x[i] = (Math.tanh(1.4 * s) * 0.6 + 0.16 * Math.sin(ph / 2)) * env;
  }
  return fadeEdges(x);
}
function padChord(notes, dur) {
  const L = buf(dur + 0.4);
  const R = buf(dur + 0.4);
  const voices = notes.flatMap((m) => [-1, 1].map((side) => ({ side, osc: new Osc(midiHz(m) * 2 ** ((side * 7) / 1200)) })));
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.08) * (t > dur ? Math.exp(-(t - dur) / 0.12) : 1);
    let l = 0;
    let r = 0;
    for (const v of voices) {
      const s = v.osc.saw();
      l += s * (v.side < 0 ? 0.8 : 0.2);
      r += s * (v.side < 0 ? 0.2 : 0.8);
    }
    L[i] = l * env;
    R[i] = r * env;
  }
  return [fadeEdges(L), fadeEdges(R)];
}
function pluck(midi, { bright = 1, decay = 0.2 } = {}) {
  const x = buf(decay * 5);
  const o1 = new Osc(midiHz(midi));
  const o2 = new Osc(midiHz(midi) * 1.003);
  const lp = new Biquad('lp', 4000, 0.9);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    if (i % 32 === 0) lp.set(300 + 4200 * bright * Math.exp(-t / 0.07));
    const s = 0.6 * o1.saw() + 0.4 * o2.square();
    x[i] = lp.run(s) * Math.min(1, t / 0.002) * Math.exp(-t / decay);
  }
  return fadeEdges(x);
}
// FM bell: bright attack that mellows out.
function bell(midi, { decay = 0.9, ratio = 3.5, index = 2.4 } = {}) {
  const x = buf(decay * 4);
  const f = midiHz(midi);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const idx = index * Math.exp(-t / 0.12) + 0.25;
    const s = Math.sin(TAU * f * t + idx * Math.sin(TAU * f * ratio * t));
    x[i] = (s + 0.15 * Math.sin(TAU * f * 2 * t) * Math.exp(-t / (decay * 0.4))) * Math.min(1, t / 0.002) * Math.exp(-t / decay);
  }
  return fadeEdges(x);
}

// ------------------------------------------------------------------ sound effects
function impact() {
  const L = buf(2.2);
  const R = buf(2.2);
  const lp = new Biquad('lp', 1200);
  const hp = new Biquad('hp', 2500);
  let ph = 0;
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    ph += (TAU * (42 + 60 * Math.exp(-t / 0.06))) / SR;
    const sub = Math.sin(ph) * Math.exp(-t / 0.4) * 0.8;
    const thump = Math.sin(TAU * 110 * t) * Math.exp(-t / 0.09) * 0.5;
    const body = lp.run(noise()) * Math.exp(-t / 0.16) * 1.1;
    const snap = hp.run(noise()) * Math.exp(-t / 0.012) * 0.7;
    const s = Math.tanh(1.4 * (sub + thump + body)) + snap;
    L[i] = s * Math.min(1, t / 0.0008);
    R[i] = L[i];
  }
  return [fadeEdges(L), fadeEdges(R)];
}
function whoosh(dur, f0, f1, pan0, pan1) {
  const L = buf(dur + 0.05);
  const R = buf(dur + 0.05);
  const bp = new Biquad('bp', f0, 1.1);
  const body = new Biquad('lp', 700);
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    const p = clamp(t / dur, 0, 1);
    if (i % 32 === 0) bp.set(f0 * (f1 / f0) ** p);
    const env = p < 0.65 ? (p / 0.65) ** 2 : ((1 - p) / 0.35) ** 1.5;
    const s = (bp.run(noise()) * 1.6 + body.run(noise()) * 0.35) * env;
    const [gl, gr] = panGains(lerp(pan0, pan1, p));
    L[i] = s * gl;
    R[i] = s * gr;
  }
  return [fadeEdges(L), fadeEdges(R)];
}
function riser(dur) {
  const L = buf(dur);
  const R = buf(dur);
  const bps = [new Biquad('bp', 300, 2.5), new Biquad('bp', 300, 2.5)];
  let ph = 0;
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    const p = t / dur;
    if (i % 32 === 0) bps.forEach((b) => b.set(300 * (7000 / 300) ** p));
    ph += (TAU * 180 * (1400 / 180) ** p) / SR;
    const env = p ** 2.2;
    const tone = (Math.sin(ph) + 0.5 * Math.sin(ph * 1.5)) * 0.18;
    L[i] = (bps[0].run(noise()) * 2 + tone) * env;
    R[i] = (bps[1].run(noise()) * 2 + tone) * env;
  }
  return [fadeEdges(L, 0.001, 0.006), fadeEdges(R, 0.001, 0.006)];
}
function tick(freq) {
  const x = buf(0.09);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    x[i] = (Math.sin(TAU * freq * t) + 0.25 * Math.sin(TAU * 2 * freq * t) * Math.exp(-t / 0.01)) * Math.min(1, t / 0.0008) * Math.exp(-t / 0.022);
  }
  return fadeEdges(x);
}
function flick() {
  const x = buf(0.05);
  const bp = new Biquad('bp', 3200, 2);
  for (let i = 0; i < x.length; i++) x[i] = bp.run(noise()) * Math.exp(-i / SR / 0.007) * 2.5;
  return fadeEdges(x);
}
function bubblePop(midi) {
  const x = buf(0.3);
  const f = midiHz(midi);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    ph += (TAU * f * (1 + 0.6 * Math.exp(-t / 0.012))) / SR;
    x[i] = Math.sin(ph) * Math.min(1, t / 0.001) * Math.exp(-t / 0.09);
  }
  return fadeEdges(x);
}
function zoneSweep(dur, mood) {
  const L = buf(dur + 0.1);
  const R = buf(dur + 0.1);
  const [f0, f1] = mood === 'down' ? [900, 320] : [1400, 5200];
  const bp = new Biquad('bp', f0, 1.4);
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    const p = clamp(t / dur, 0, 1);
    if (i % 32 === 0) bp.set(f0 * (f1 / f0) ** p);
    const s = bp.run(noise()) * Math.sin(Math.PI * p) ** 1.2 * 1.8;
    const [gl, gr] = panGains(lerp(-0.8, 0.8, p)); // follows the zone sweeping in from the left
    L[i] = s * gl;
    R[i] = s * gr;
  }
  return [fadeEdges(L), fadeEdges(R)];
}

// A minor pentatonic for the candle ticks, so the "price melody" always sits in key.
const PENTA = [69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93];

function renderSfx(audio, n) {
  const dry = new Bus(n);
  const verb = new Bus(n);
  const echo = new Bus(n);
  const send = (sig, t, gain, pan, v = 0, e = 0) => {
    dry.add(sig, t, gain, pan);
    if (v) verb.add(sig, t, gain * v, pan);
    if (e) echo.add(sig, t, gain * e, pan);
  };
  for (const c of audio.cues) {
    switch (c.type) {
      case 'impact':
        send(impact(), c.t, 0.8, 0, 0.5);
        send(bell(81, { decay: 0.8, ratio: 2, index: 1.2 }), c.t + 0.01, 0.12, -0.2, 0.6); // shimmer
        send(bell(88, { decay: 0.8, ratio: 2, index: 1.2 }), c.t + 0.01, 0.09, 0.2, 0.6);
        break;
      case 'whoosh':
        send(whoosh(c.dur, c.from, c.to, ...c.pan), c.t, 0.32, 0, 0.35);
        break;
      case 'riser':
        send(riser(c.dur), c.t, 0.3, 0, 0.25);
        break;
      case 'sparkle':
        send(bell([81, 84, 88, 93][c.step], { decay: 0.5, index: 1.6 }), c.t, 0.16, -0.45 + c.step * 0.3, 0.5, 0.3);
        break;
      case 'tick':
        send(tick(midiHz(PENTA[Math.round(clamp(c.level, 0, 1) * (PENTA.length - 1))])), c.t, 0.12, c.pan * 0.75, 0.25);
        break;
      case 'zone': {
        send(zoneSweep(c.dur, c.mood), c.t, 0.22, 0, 0.3);
        const motif = c.mood === 'down' ? [76, 72, 69] : [72, 76, 79, 84]; // falling for sellers, rising for buyers
        motif.forEach((m, i) => send(pluck(m, { bright: c.mood === 'down' ? 0.5 : 1.2, decay: 0.18 }), c.t + i * 0.075, 0.2, (i - 1) * 0.3, 0.3, 0.2));
        break;
      }
      case 'flip':
        [0, 0.07, 0.14, 0.21].forEach((d, i) => send(flick(), c.t + d, 0.18 + i * 0.03, -0.3 + i * 0.2));
        break;
      case 'ping':
        send(bell([81, 84, 88][c.step], { decay: 0.45, ratio: 2, index: 1.1 }), c.t, 0.34, c.pan * 0.7, 0.4, 0.45);
        break;
      case 'chime':
        [84, 88, 91, 96].forEach((m, i) => send(bell(m, { decay: 0.8, index: 2 }), c.t + i * 0.04, 0.2, -0.3 + i * 0.2, 0.5, 0.3));
        [103, 108].forEach((m, i) => send(bell(m, { decay: 0.6, index: 1 }), c.t + 0.16 + i * 0.05, 0.06, i ? 0.5 : -0.5, 0.6));
        break;
      case 'pop':
        send(bubblePop([72, 76, 79][c.step]), c.t, 0.28, -0.25 + c.step * 0.25, 0.25);
        send(pluck([84, 88, 91][c.step], { bright: 1.1, decay: 0.12 }), c.t, 0.12, -0.25 + c.step * 0.25, 0.3);
        break;
      default:
        throw new Error(`unknown cue type: ${c.type}`);
    }
  }
  const v = reverb(verb, { room: 0.86, damp: 0.35 });
  const e = pingPong(echo, audio.beat * 0.75, 0.38);
  for (let i = 0; i < n; i++) {
    dry.L[i] += v.L[i] * 0.9 + e.L[i] * 0.6;
    dry.R[i] += v.R[i] * 0.9 + e.R[i] * 0.6;
  }
  return dry;
}

// ------------------------------------------------------------------ music bed
const CHORDS = {
  Am: { pad: [52, 57, 60, 64], bass: 45 },
  F: { pad: [53, 57, 60, 64], bass: 41 },
  C: { pad: [52, 55, 60, 62], bass: 48 },
  Dm: { pad: [53, 57, 60, 62], bass: 50 },
  E: { pad: [52, 56, 59, 62], bass: 40 },
  G: { pad: [50, 55, 59, 62], bass: 43 },
};

function renderMusic(audio, n) {
  const B = audio.beat;
  const beatOf = (t) => Math.round(t / B);
  const s = Object.fromEntries(Object.entries(audio.sections).map(([k, t]) => [k, beatOf(t)]));
  const endBeat = audio.duration / B;
  const section = (b) =>
    b < s.what ? 'hook' : b < s.below ? 'what' : b < s.above ? 'below' : b < s.dip ? 'above'
      : b < s.touch2 ? 'dip' : b < s.bounce ? 'build' : b < s.recap ? 'bounce' : 'recap';

  // Chords follow the story: neutral -> dark for sellers -> lift for buyers -> tension -> resolve on the recap.
  const changes = [
    [0, 'Am'], [s.what, 'Am'], [s.what + 2, 'F'], [s.what + 4, 'C'],
    [s.below, 'Dm'], [s.above - 1, 'E'],
    [s.above, 'F'], [s.above + 2, 'G'],
    [s.dip, 'Am'], [s.touch2, 'F'], [s.bounce, 'G'],
    [s.recap, 'C'], [s.recap + 2, 'G'],
  ];
  const chordAt = (b) => changes.filter(([at]) => at <= b + 1e-6).at(-1)[1];

  const drums = new Bus(n);
  const tonal = new Bus(n); // ducked by the kick
  const verb = new Bus(n);
  const kickTimes = [];

  changes.forEach(([at, name], i) => {
    const until = i + 1 < changes.length ? changes[i + 1][0] : endBeat + 1;
    const dur = (until - at) * B;
    const ch = CHORDS[name];
    const pad = padChord(ch.pad, dur);
    tonal.add(pad, at * B, 0.14);
    verb.add(pad, at * B, 0.05);
    if (at >= s.what) tonal.add(bassNote(ch.bass, dur - 0.01), at * B, 0.28);
  });

  for (let b8 = s.what * 2; b8 < endBeat * 2; b8++) {
    const b = b8 / 2;
    const t = b * B;
    const sec = section(b);
    const onBeat = b8 % 2 === 0;
    const inBar = (b - s.what) % 4;
    // kick: four on the floor, held back to one hit while the chart zooms in
    if (onBeat && (sec !== 'dip' || b === s.dip)) {
      drums.add(kick(), t, 0.75);
      kickTimes.push(t);
    }
    // clap on 2 and 4, except in the quiet zoom and the snare build
    if (onBeat && (inBar === 1 || inBar === 3) && !['dip', 'bounce'].includes(sec)) {
      const c = clap();
      drums.add(c, t, 0.3);
      verb.add(c, t, 0.12);
    }
    // hats: off-beats, skipped for the sellers' section and the zoom
    if (!onBeat && !['below', 'dip'].includes(sec)) drums.add(hat(), t, 0.16, 0.25);
    if (sec === 'above' || sec === 'recap') {
      drums.add(hat(), t + B / 4, 0.07, -0.3); // 16ths: more energy when buyers take over
    }
    // arpeggio on 8ths, shaped by the section
    const pool = CHORDS[chordAt(b)].pad.map((m) => m + 12).sort((x, y) => x - y);
    let step;
    let bright = 1.1;
    if (sec === 'hook' || sec === 'bounce') continue;
    if (sec === 'below') {
      step = 3 - (b8 % 4); // falling
      bright = 0.45;
    } else if (sec === 'above' || sec === 'recap') {
      step = b8 % 4; // rising
      bright = 1.25;
    } else if (sec === 'dip') {
      if (!onBeat) continue;
      step = (b8 / 2) % 2 ? 2 : 0;
      bright = 0.6;
    } else {
      step = [0, 1, 2, 3, 2, 1][b8 % 6];
    }
    const note = pool[step] + (sec === 'below' || sec === 'dip' ? 0 : 12);
    const pl = pluck(note, { bright, decay: 0.16 });
    tonal.add(pl, t, 0.26, b8 % 2 ? 0.35 : -0.35);
    verb.add(pl, t, 0.12);
  }

  // build into the recap: snare roll in 16ths, crashes on the drop and the recap
  for (let k = 0; k < (s.recap - s.bounce) * 4; k++) {
    const p = k / ((s.recap - s.bounce) * 4);
    drums.add(snare(1 + p * 0.3), (s.bounce + k / 4) * B, 0.12 + 0.3 * p, 0);
  }
  drums.add(crash(), s.what * B, 0.22);
  drums.add(crash(), s.recap * B, 0.26);
  drums.add(hat(true), s.above * B, 0.12, 0.3);

  // sidechain: tonal parts dip under each kick (the "pumping" feel)
  const duck = new Float32Array(n).fill(1);
  for (const kt of kickTimes) {
    const start = Math.round(kt * SR);
    for (let i = 0; i < SR * 0.3 && start + i < n; i++) {
      const tt = i / SR;
      const d = 1 - 0.55 * Math.min(1, tt / 0.004) * Math.exp(-tt / 0.09);
      duck[start + i] = Math.min(duck[start + i], d);
    }
  }
  const v = reverb(verb, { room: 0.82, damp: 0.4 });
  const mix = new Bus(n);
  for (let i = 0; i < n; i++) {
    mix.L[i] = drums.L[i] + tonal.L[i] * duck[i] + v.L[i] * 0.8;
    mix.R[i] = drums.R[i] + tonal.R[i] * duck[i] + v.R[i] * 0.8;
  }

  // Filter automation tells the story too: muffled intro, dark for sellers, wide open for buyers, tension in the zoom.
  const at = (name) => audio.sections[name];
  const cutoffAt = (t) => {
    if (t < at('what')) return 350 * (3500 / 350) ** (t / at('what'));
    if (t < at('below')) return 16000;
    if (t < at('above')) return 1300;
    if (t < at('dip')) return 16000;
    if (t < at('touch2')) return 2000;
    if (t < at('recap')) return 2000 * 8 ** ((t - at('touch2')) / (at('recap') - at('touch2')));
    return 16000;
  };
  const lps = [new Biquad('lp', 16000, 0.8), new Biquad('lp', 16000, 0.8)];
  let fc = cutoffAt(0);
  const smooth = 1 - Math.exp(-1 / (0.04 * SR));
  for (let i = 0; i < n; i++) {
    fc += (cutoffAt(i / SR) - fc) * smooth;
    if (i % 32 === 0) lps.forEach((f) => f.set(fc));
    mix.L[i] = lps[0].run(mix.L[i]);
    mix.R[i] = lps[1].run(mix.R[i]);
  }
  return mix;
}

// ------------------------------------------------------------------ mastering
// ITU-R BS.1770 integrated loudness (K-weighted, gated), 48 kHz coefficients.
function loudness(L, R) {
  const kw = (x) => {
    const y = new Float32Array(x.length);
    let [x1, x2, y1, y2, z1, z2, w1, w2] = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < x.length; i++) {
      const a = 1.53512485958697 * x[i] - 2.69169618940638 * x1 + 1.19839281085285 * x2 + 1.69065929318241 * y1 - 0.73248077421585 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = a;
      const b = a - 2 * z1 + z2 + 1.99004745483398 * w1 - 0.99007225036621 * w2;
      z2 = z1; z1 = a; w2 = w1; w1 = b;
      y[i] = b;
    }
    return y;
  };
  const kl = kw(L);
  const kr = kw(R);
  const block = Math.round(0.4 * SR);
  const hop = Math.round(0.1 * SR);
  const ms = [];
  for (let s = 0; s + block <= L.length; s += hop) {
    let sum = 0;
    for (let i = s; i < s + block; i++) sum += kl[i] * kl[i] + kr[i] * kr[i];
    ms.push(sum / block);
  }
  const lufs = (m) => -0.691 + 10 * Math.log10(m);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const abs = ms.filter((m) => lufs(m) > -70);
  const rel = lufs(mean(abs)) - 10;
  return lufs(mean(abs.filter((m) => lufs(m) > rel)));
}

// Peak level including the peaks *between* samples (4x windowed-sinc interpolation), so the limiter
// controls true peak — what a decoder or a platform's re-encode actually reconstructs.
const TP_TAPS = 8;
const TP_KERNELS = [0.25, 0.5, 0.75].map((frac) => {
  const k = [];
  for (let j = -TP_TAPS + 1; j <= TP_TAPS; j++) {
    const x = j - frac;
    const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / TP_TAPS); // Hann window
    k.push(x === 0 ? 1 : (Math.sin(Math.PI * x) / (Math.PI * x)) * w);
  }
  return k;
});
function truePeaks(x) {
  const n = x.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = Math.abs(x[i]);
    for (const k of TP_KERNELS) {
      let v = 0;
      for (let j = 0; j < k.length; j++) {
        const idx = i + j - TP_TAPS + 1;
        if (idx >= 0 && idx < n) v += x[idx] * k[j];
      }
      p = Math.max(p, Math.abs(v));
    }
    out[i] = p;
  }
  return out;
}

// Look-ahead true-peak limiter.
function limit(L, R, ceiling) {
  const n = L.length;
  const look = Math.round(0.004 * SR);
  const pl = truePeaks(L);
  const pr = truePeaks(R);
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) need[i] = Math.min(1, ceiling / Math.max(1e-9, pl[i], pr[i]));
  // ahead[i] = min(need[i .. i + look]); averaging it over the previous `look` samples gives a smooth ramp
  // that is guaranteed to be fully down by the time each peak arrives (no clipping, no overshoot).
  const ahead = new Float32Array(n);
  const q = [];
  for (let i = n - 1; i >= 0; i--) {
    while (q.length && need[q.at(-1)] >= need[i]) q.pop();
    q.push(i);
    while (q[0] > i + look) q.shift();
    ahead[i] = need[q[0]];
  }
  const rel = 1 - Math.exp(-1 / (0.08 * SR));
  let sum = look; // running sum of ahead[i - look + 1 .. i], primed with unity gain
  let g = 1;
  for (let i = 0; i < n; i++) {
    sum += ahead[i] - (i >= look ? ahead[i - look] : 1);
    const target = sum / look;
    g = target < g ? target : g + (target - g) * rel;
    L[i] *= g;
    R[i] *= g;
  }
}

export function renderSoundtrack(audio) {
  const n = Math.round(audio.duration * SR);
  seed = 7;
  const music = renderMusic(audio, n);
  const sfx = renderSfx(audio, n);

  // Music steps back a little whenever an effect plays, so the effects read clearly.
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let env = 0;
  const up = 1 - Math.exp(-1 / (0.005 * SR));
  const down = 1 - Math.exp(-1 / (0.18 * SR));
  for (let i = 0; i < n; i++) {
    const level = Math.max(Math.abs(sfx.L[i]), Math.abs(sfx.R[i]));
    env += (level - env) * (level > env ? up : down);
    const duck = 1 - 0.35 * clamp(env * 2.5, 0, 1);
    L[i] = music.L[i] * 0.62 * duck + sfx.L[i];
    R[i] = music.R[i] * 0.62 * duck + sfx.R[i];
  }

  // Phone speakers can't play below ~40 Hz; clear that rumble so loudness goes where people can hear it.
  const hps = [new Biquad('hp', 32), new Biquad('hp', 32)];
  for (let i = 0; i < n; i++) {
    L[i] = hps[0].run(L[i]);
    R[i] = hps[1].run(R[i]);
  }

  // Master to the loudness social apps normalise to, then catch peaks. Repeated, since limiting lowers loudness.
  for (let pass = 0; pass < 3; pass++) {
    const gain = 10 ** ((TARGET_LUFS - loudness(L, R)) / 20);
    for (let i = 0; i < n; i++) {
      L[i] *= gain;
      R[i] *= gain;
    }
    limit(L, R, CEILING);
  }
  fadeEdges(L, 0, 0.05); // clean loop point
  fadeEdges(R, 0, 0.05);
  return { left: L, right: R, sampleRate: SR, loudness: loudness(L, R) };
}

export function writeWav(path, { left, right, sampleRate }) {
  const n = left.length;
  const data = Buffer.alloc(44 + n * 4);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + n * 4, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); // PCM
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 4, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const dither = () => (rand() - rand()) / 32768; // TPDF
    data.writeInt16LE(Math.round(clamp(left[i] + dither(), -1, 1) * 32767), 44 + i * 4);
    data.writeInt16LE(Math.round(clamp(right[i] + dither(), -1, 1) * 32767), 46 + i * 4);
  }
  writeFileSync(path, data);
}
