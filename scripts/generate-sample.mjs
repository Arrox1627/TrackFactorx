// Generates a made-up but realistic trading day (1-minute OHLCV) that tells the VWAP story cleanly:
// morning sell-off below VWAP -> reclaim -> trend above -> two pullbacks that tag VWAP and bounce -> rally.
// Deterministic (seeded), so re-running produces the same CSV.
// Usage: node scripts/generate-sample.mjs  ->  writes data/sample_1min.csv
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'data', 'sample_1min.csv');
const SEED = 20260422;
const MINUTES = 390; // 09:30-15:59

// mulberry32 PRNG + Box-Muller normal
let s = SEED >>> 0;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

const lerp = (a, b, p) => a + (b - a) * p;
const smooth = (p) => p * p * (3 - 2 * p);
const seg = (m, a, b) => smooth(Math.min(1, Math.max(0, (m - a) / (b - a))));

// Where price "wants" to be at minute m. Pullback legs aim at the live VWAP so they actually tag it.
function target(m, vwap) {
  if (m < 5) return lerp(150.4, 150.95, seg(m, 0, 5)); // opening pop
  if (m < 55) return lerp(150.95, 147.75, seg(m, 5, 55)); // morning sell-off
  if (m < 85) return 147.9 + 0.18 * Math.sin(m / 5); // basing near the lows
  if (m < 150) return lerp(147.95, 151.35, seg(m, 85, 150)); // recovery, reclaim, trend up
  if (m < 190) return lerp(151.35, vwap + 0.04, seg(m, 150, 190)); // pullback #1 to VWAP
  if (m < 212) return lerp(vwap + 0.04, 150.95, seg(m, 190, 212)); // bounce #1
  if (m < 240) return lerp(150.95, vwap + 0.03, seg(m, 212, 240)); // pullback #2 to VWAP
  if (m < 290) return lerp(vwap + 0.03, 152.15, seg(m, 240, 290)); // the bounce that sticks
  if (m < 355) return lerp(152.15, 152.6, seg(m, 290, 355)); // afternoon grind higher
  return lerp(152.6, 152.2, seg(m, 355, MINUTES)); // small fade into the close
}

const TOUCH_MINUTES = [189, 239];
const HOLD_WINDOWS = [[182, 195], [232, 245]]; // closes stay above VWAP here: the floor holds

const rows = [];
let price = 150.4;
let pv = 0;
let vol = 0;
for (let m = 0; m < MINUTES; m++) {
  const vwap = vol ? pv / vol : price;
  const o = m === 0 ? 150.4 : rows[m - 1].c + normal() * 0.008;
  price += 0.22 * (target(m, vwap) - price) + normal() * 0.045;
  let c = price;
  if (HOLD_WINDOWS.some(([a, b]) => m >= a && m <= b)) c = Math.max(c, vwap + 0.015);
  const h = Math.max(o, c) + Math.abs(normal()) * 0.05;
  let l = Math.min(o, c) - Math.abs(normal()) * 0.05;
  if (TOUCH_MINUTES.includes(m)) l = Math.min(l, vwap - 0.025); // wick pokes the line, buyers step in
  price = c;

  // U-shaped intraday volume, more on big candles, extra on the reclaim and the bounces.
  const shape = 0.55 + 2.8 * Math.exp(-m / 22) + 1.4 * Math.exp(-(MINUTES - 1 - m) / 18);
  const surge = (m >= 105 && m < 125 ? 1.6 : 1) * (TOUCH_MINUTES.some((t) => m >= t && m < t + 10) ? 1.5 : 1);
  const v = 52000 * shape * surge * (1 + 10 * Math.abs(c - o)) * Math.exp(0.3 * normal());

  pv += ((h + l + c) / 3) * v;
  vol += v;
  rows.push({ m, o, h, l, c, v });
}

const hhmm = (m) => {
  const total = 9 * 60 + 30 + m;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const csv = ['time_et,open,high,low,close,volume']
  .concat(rows.map((r) => [hhmm(r.m), r.o, r.h, r.l, r.c].map((x, i) => (i ? x.toFixed(2) : x)).join(',') + `,${Math.round(r.v / 100) * 100}`))
  .join('\n');
writeFileSync(OUT, `${csv}\n`);
console.log(`wrote ${OUT}: ${rows.length} minutes, close ${rows.at(-1).c.toFixed(2)}`);
