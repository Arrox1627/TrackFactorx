// VWAP explainer reel: ~14 s, 1080x1920, every frame is a pure function of time `t`.
// scripts/render.mjs calls window.renderFrame(t) for each frame; opening the page plays a live preview.
(() => {
  'use strict';

  const W = 1080;
  const H = 1920;
  const FPS = 30;
  // Timings below are written in "story seconds" for a 10 s cut. PACE stretches the whole reel evenly
  // (1.35 = every animation plays 35% slower); DURATION is the final length in real seconds.
  const PACE = 1.35;
  const DURATION = 13.9;
  const D = window.REEL_DATA;
  const BARS = D.bars;
  const V_MAX = Math.max(...BARS.map((b) => b.v));

  const canvas = document.getElementById('reel');
  const ctx = canvas.getContext('2d');

  // ---------------------------------------------------------------- style
  const C = {
    bg: '#06090f',
    text: '#f4f6fa',
    muted: '#8d97a7',
    faint: '#566071',
    grid: 'rgba(255,255,255,0.055)',
    up: '#26d07c',
    down: '#ff4d61',
    amber: '#ffb547',
    amberHot: '#ffe0a6',
    ink: '#1a1206',
  };
  const RICH = { amber: C.amber, red: C.down, green: C.up };
  // Bricolage Grotesque (display + text cuts) for words, JetBrains Mono for labels and numbers.
  const FONT = {
    display: (px) => `800 ${px}px 'Reel Display', sans-serif`,
    text: (px) => `500 ${px}px 'Reel Text', sans-serif`,
    textBold: (px) => `600 ${px}px 'Reel Text', sans-serif`,
    mono: (px) => `500 ${px}px 'Reel Mono', monospace`,
    monoBold: (px) => `600 ${px}px 'Reel Mono', monospace`,
  };

  // ---------------------------------------------------------------- layout (Reels-safe: key content between y≈270 and y≈1480)
  const PANEL = { x0: 36, x1: 1044, y0: 636, y1: 1562 };
  const PLOT = { x0: 70, x1: 920, y0: 724, y1: 1350 };
  const VOL = { y0: 1372, y1: 1490 };
  const TITLE_Y = 690;
  const TIME_Y = 1530;
  const FOOTER_Y = 1606;
  const TEXT_X = 70;
  const TEXT_MAX_W = 940;
  const CHIP_Y = 296;
  const HEAD_Y = [422, 506];
  const SUB_Y = 580;

  // ---------------------------------------------------------------- timeline (story seconds; real time = story * PACE)
  const T = {
    hookUnfold: [0.22, 0.56],
    hookType: 0.5, // first word starts typing; the others follow HOOK_TYPE_STAGGER apart
    hookOut: [1.08, 1.34],
    what: 1.35, // chart arrives
    chartIn: [1.3, 1.6],
    draw: [1.6, 3.75],
    tagIn: 1.7, // VWAP pill + price tag pop in
    volFlash: [2.45, 3.6],
    below: 4.05,
    above: 5.4,
    reclaimRing: 5.625,
    dip: 6.75,
    zoomIn: [6.77, 7.2],
    touches: [7.2, 7.65],
    arrow: [7.75, 8.1],
    bounce: 8.1,
    zoomOut: [8.4, 8.85],
    recap: 8.55,
    recapRows: [8.775, 9.0, 9.225],
  };
  const HOOK_TYPE_STAGGER = 0.055;

  const SCENES = [
    {
      start: T.what, end: T.below, chip: '1 · WHAT IT IS',
      head: ['The [amber]average price[/] of', 'every share traded today'],
      sub: 'Big-volume trades pull the line harder', subAt: 2.25,
    },
    {
      start: T.below, end: T.dip, chip: '2 · HOW TO READ IT',
      head: ['Price [red]below[/] the line', '→ [red]sellers[/] in control'],
      sub: "Today's average buyer is [red]losing money[/]", subAt: 4.275,
      morphAt: T.above,
      head2: ['Price [green]above[/] the line', '→ [green]buyers[/] in control'],
      sub2: "Today's average buyer is [green]in profit[/]",
    },
    {
      start: T.dip, end: T.recap, chip: '3 · HOW TO USE IT',
      head: ['Dips to the line', 'often [green]bounce[/] ↑'],
      sub: 'Traders treat VWAP like a floor to buy from', subAt: 6.975,
    },
    {
      start: T.recap, end: 99, chip: 'RECAP', // stays up until the reel ends
      head: ["VWAP = the day's", '[amber]fair price[/]'],
      sub: 'A guide, not a guarantee', subAt: 9.225,
    },
  ];

  // Key moments, detected from the data by scripts/build-data.mjs (bar indexes, 5-min bars from 09:30):
  // the first close back above VWAP, two pullbacks that tagged VWAP and held, and the high after the bounce.
  const { reclaim: RECLAIM_BAR, touches: TOUCHES, bounceHigh: BOUNCE_HIGH_BAR } = D.moments;

  // ---------------------------------------------------------------- math helpers
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const ease = {
    out: (p) => 1 - (1 - p) ** 3,
    inOut: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
    outBack: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
    inOutSine: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
  };

  // ---------------------------------------------------------------- chart view (supports animated zoom)
  const FULL = D.view.full; // [first bar, last bar, low price, high price]
  const ZOOM = D.view.zoom;
  const SPAN = FULL[3] - FULL[2];
  const VWAP_MID = (Math.min(...D.vwap1m) + Math.max(...D.vwap1m)) / 2;

  // Price grid: a "nice" step for the full day, halved (when still nice) while zoomed in.
  const NICE = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50];
  const TICK = NICE.find((s) => s >= SPAN / 8) ?? 100;
  const TICK_FINE = NICE.includes(TICK / 2) ? TICK / 2 : TICK;

  function viewAt(t) {
    const z = ease.inOut(prog(t, ...T.zoomIn)) * (1 - ease.inOut(prog(t, ...T.zoomOut)));
    const [ua, ub, pa, pb] = FULL.map((v, i) => lerp(v, ZOOM[i], z));
    const sx = (PLOT.x1 - PLOT.x0) / (ub - ua);
    const sy = (PLOT.y1 - PLOT.y0) / (pb - pa);
    return {
      z,
      barW: sx,
      x: (u) => PLOT.x0 + (u - ua) * sx,
      y: (p) => PLOT.y1 - (p - pa) * sy,
      pa,
      pb,
      ub,
    };
  }

  // VWAP after minute m is drawn at the centre of its 5-min bar's close, like TradingView.
  const vwapU = (m) => (m + 1) / D.barMinutes - 0.5;

  function vwapPoints(view, uMax = Infinity) {
    const pts = [];
    for (let m = 0; m < D.vwap1m.length; m++) {
      const u = vwapU(m);
      if (u > uMax) {
        if (m > 0) {
          const u0 = vwapU(m - 1);
          const f = (uMax - u0) / (u - u0);
          if (f > 0) pts.push([view.x(uMax), view.y(lerp(D.vwap1m[m - 1], D.vwap1m[m], f))]);
        }
        break;
      }
      pts.push([view.x(u), view.y(D.vwap1m[m])]);
    }
    return pts;
  }

  // ---------------------------------------------------------------- drawing primitives
  function tracePath(pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  }

  function pill(x, y, text, { font = FONT.monoBold(22), bg, fg, border, padX = 16, h = 44, align = 'left', alpha = 1 }) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = font;
    const w = ctx.measureText(text).width + padX * 2;
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.beginPath();
    ctx.roundRect(left, y - h / 2, w, h, h / 2);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fill();
    }
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + padX, y + 1);
    ctx.restore();
    return w;
  }

  function ripple(x, y, p, color) {
    if (p <= 0) return;
    ctx.save();
    const r = 26 * ease.outBack(clamp(p * 2.5));
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    for (const offset of [0, 0.5]) {
      const q = (p * 1.4 + offset) % 1;
      ctx.globalAlpha = (1 - q) * 0.55 * clamp(p * 4);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 26 + q * 46, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Quadratic arrow drawn progressively (p: 0..1).
  function arrow(x0, y0, cx, cy, x1, y1, p, color) {
    if (p <= 0) return;
    const at = (s) => [
      (1 - s) ** 2 * x0 + 2 * (1 - s) * s * cx + s * s * x1,
      (1 - s) ** 2 * y0 + 2 * (1 - s) * s * cy + s * s * y1,
    ];
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push(at((i / 40) * p));
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    tracePath(pts);
    ctx.stroke();
    const [hx, hy] = pts.at(-1);
    const [px, py] = pts.at(-3);
    const ang = Math.atan2(hy - py, hx - px);
    ctx.beginPath();
    ctx.moveTo(hx + Math.cos(ang) * 10, hy + Math.sin(ang) * 10);
    ctx.lineTo(hx + Math.cos(ang + 2.5) * 26, hy + Math.sin(ang + 2.5) * 26);
    ctx.lineTo(hx + Math.cos(ang - 2.5) * 26, hy + Math.sin(ang - 2.5) * 26);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- rich text: "[red]word[/]" markup, per-word animation
  function parseRich(line) {
    const words = [];
    const re = /\[(\w+)\](.*?)\[\/\]|([^[]+)/g;
    let m;
    while ((m = re.exec(line))) {
      const color = m[1] ? RICH[m[1]] : null;
      for (const w of (m[2] ?? m[3]).split(' ')) if (w) words.push({ text: w, color });
    }
    return words;
  }

  // Lays out lines left-aligned; returns words with x/y and a font that fits TEXT_MAX_W.
  function layoutRich(lines, fontFn, size, ys, maxW = TEXT_MAX_W) {
    const parsed = lines.map(parseRich);
    ctx.font = fontFn(size);
    const space = () => ctx.measureText(' ').width;
    const lineW = (ws) => ws.reduce((s, w) => s + ctx.measureText(w.text).width, 0) + space() * (ws.length - 1);
    const widest = Math.max(...parsed.map(lineW));
    if (widest > maxW) {
      size = Math.floor((size * maxW) / widest);
      ctx.font = fontFn(size);
    }
    const out = [];
    parsed.forEach((ws, li) => {
      let x = TEXT_X;
      for (const w of ws) {
        const width = ctx.measureText(w.text).width;
        out.push({ ...w, x, y: ys[li], width });
        x += width + space();
      }
    });
    return { words: out, font: fontFn(size) };
  }

  function drawWord(w, font, alpha, dy, defaultColor) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = w.color ?? defaultColor;
    if (w.color) {
      ctx.shadowColor = w.color;
      ctx.shadowBlur = 24;
    }
    ctx.fillText(w.text, w.x, w.y + dy);
    ctx.restore();
  }

  // Animates words in with a stagger; if `next` is given, morphs into it at `morphAt`
  // (shared words glide to their new spot, changed words roll like a slot machine).
  function drawRichBlock(t, { lines, next, start, end, morphAt, fontFn, size, ys, color, stagger = 0.045 }) {
    const a = layoutRich(lines, fontFn, size, ys);
    const b = next ? layoutRich(next, fontFn, size, ys) : null;
    const outP = ease.inOut(prog(t, end - 0.2, end));
    const mp = b ? ease.inOut(prog(t, morphAt, morphAt + 0.38)) : 0;
    a.words.forEach((w, k) => {
      const inP = ease.out(prog(t, start + 0.05 + k * stagger, start + 0.4 + k * stagger));
      const base = inP * (1 - outP);
      const dyIn = (1 - inP) * 36 - outP * 24;
      const nw = b?.words[k];
      if (!nw || mp === 0) return drawWord(w, a.font, base, dyIn, color);
      if (nw.text === w.text && nw.color === w.color) {
        return drawWord({ ...w, x: lerp(w.x, nw.x, mp) }, a.font, base, dyIn, color);
      }
      drawWord(w, a.font, base * (1 - mp), dyIn - mp * 44, color);
      drawWord(nw, b.font, base * mp, dyIn + (1 - mp) * 44, color);
    });
  }

  // ---------------------------------------------------------------- scene layers
  function drawBackground() {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(540, 420, 0, 540, 420, 980);
    g.addColorStop(0, 'rgba(48,72,130,0.22)');
    g.addColorStop(1, 'rgba(48,72,130,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(540, 1500, 0, 540, 1500, 900);
    g.addColorStop(0, 'rgba(255,170,60,0.06)');
    g.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawPanelFrame(alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.roundRect(PANEL.x0, PANEL.y0, PANEL.x1 - PANEL.x0, PANEL.y1 - PANEL.y0, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.028)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textBaseline = 'alphabetic';
    ctx.font = FONT.monoBold(28);
    ctx.fillStyle = C.text;
    ctx.fillText(D.ticker, PLOT.x0, TITLE_Y);
    const tw = ctx.measureText(D.ticker).width;
    ctx.font = FONT.mono(21);
    ctx.fillStyle = C.muted;
    ctx.fillText(`${D.name} · 5-min candles · ${D.session}`, PLOT.x0 + tw + 14, TITLE_Y);

    // legend
    ctx.font = FONT.monoBold(22);
    ctx.fillStyle = C.amber;
    ctx.textAlign = 'right';
    ctx.fillText('VWAP', PANEL.x1 - 30, TITLE_Y);
    const lw = ctx.measureText('VWAP').width;
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(PANEL.x1 - 30 - lw - 52, TITLE_Y - 8);
    ctx.lineTo(PANEL.x1 - 30 - lw - 14, TITLE_Y - 8);
    ctx.stroke();
    ctx.restore();
  }

  function drawGrid(view, alpha, avoidY = -1e9) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = C.grid;
    ctx.font = FONT.mono(20);
    ctx.fillStyle = C.faint;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let k = Math.ceil(view.pa / TICK_FINE); k * TICK_FINE <= view.pb; k++) {
      const p = k * TICK_FINE;
      const y = view.y(p);
      if (y < PLOT.y0 + 8 || y > PLOT.y1 - 4) continue;
      const coarse = Math.abs(p / TICK - Math.round(p / TICK)) < 1e-6;
      ctx.globalAlpha = alpha * (coarse ? 1 : view.z);
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(PLOT.x0, y);
      ctx.lineTo(PLOT.x1, y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Skip labels the VWAP tag would cover.
      if (Math.abs(y - avoidY) > 40) ctx.fillText(p.toFixed(2), PANEL.x1 - 18, y);
    }
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const hours = [['10am', 30], ['11am', 90], ['12pm', 150], ['1pm', 210], ['2pm', 270], ['3pm', 330]];
    for (const [label, minute] of hours) {
      const x = view.x(minute / D.barMinutes);
      if (x < PLOT.x0 + 10 || x > PLOT.x1 - 10) continue;
      ctx.beginPath();
      ctx.moveTo(x, PLOT.y0);
      ctx.lineTo(x, VOL.y1);
      ctx.stroke();
      ctx.fillText(label, x, TIME_Y);
    }
    ctx.textAlign = 'left';
    ctx.font = FONT.monoBold(16);
    ctx.fillStyle = C.faint;
    ctx.fillText('VOLUME', PLOT.x0 + 4, VOL.y0 + 16);
    ctx.restore();
  }

  function clipPlot(extraBottom = 0) {
    ctx.beginPath();
    ctx.rect(PLOT.x0 - 4, PLOT.y0 - 20, PLOT.x1 - PLOT.x0 + 8, PLOT.y1 - PLOT.y0 + 20 + extraBottom);
    ctx.clip();
  }

  // Shaded "zones" above / below the VWAP line, swept in from the left.
  function drawZone(view, side, alpha, sweep) {
    if (alpha <= 0 || sweep <= 0) return;
    const pts = vwapPoints(view);
    const edgeY = side === 'below' ? PLOT.y1 : PLOT.y0 - 20;
    const color = side === 'below' ? '255,77,97' : '38,208,124';
    ctx.save();
    clipPlot();
    ctx.beginPath();
    ctx.rect(PLOT.x0 - 4, 0, (PLOT.x1 - PLOT.x0 + 8) * sweep, H);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(PLOT.x0 - 4, edgeY);
    ctx.lineTo(PLOT.x0 - 4, pts[0][1]);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(PLOT.x1 + 4, pts.at(-1)[1]);
    ctx.lineTo(PLOT.x1 + 4, edgeY);
    ctx.closePath();
    const mid = view.y(VWAP_MID);
    const g = ctx.createLinearGradient(0, mid, 0, edgeY);
    g.addColorStop(0, `rgba(${color},${0.3 * alpha})`);
    g.addColorStop(1, `rgba(${color},${0.03 * alpha})`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  function drawVolume(view, reveal, t, alphaFor) {
    const flash = Math.sin(Math.PI * prog(t, ...T.volFlash));
    const h = VOL.y1 - VOL.y0 - 32; // headroom for the panel's labels
    ctx.save();
    ctx.beginPath();
    ctx.rect(PLOT.x0 - 4, VOL.y0, PLOT.x1 - PLOT.x0 + 8, VOL.y1 - VOL.y0);
    ctx.clip();
    BARS.forEach((b, i) => {
      const g = clamp(reveal - i);
      if (g <= 0) return;
      const x = view.x(i + 0.5);
      const bw = Math.max(3, view.barW * 0.62);
      const bh = (b.v / V_MAX) * h * ease.out(g);
      const weight = b.v / V_MAX;
      ctx.globalAlpha = (0.42 + 0.5 * flash * weight) * alphaFor(i);
      ctx.fillStyle = flash * weight > 0.25 ? C.amber : b.c >= b.o ? C.up : C.down;
      ctx.fillRect(x - bw / 2, VOL.y1 - bh, bw, bh);
    });
    ctx.restore();
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash;
      ctx.font = FONT.monoBold(20);
      ctx.fillStyle = C.amber;
      ctx.textBaseline = 'middle';
      ctx.fillText('← heavy volume = more weight', view.x(9.5), VOL.y0 + 16);
      ctx.restore();
    }
  }

  function drawCandles(view, reveal, alphaFor) {
    ctx.save();
    clipPlot();
    BARS.forEach((b, i) => {
      const g = clamp(reveal - i);
      if (g <= 0) return;
      const e = ease.out(g);
      const x = view.x(i + 0.5);
      const bw = Math.max(4, view.barW * 0.62);
      const color = b.c >= b.o ? C.up : C.down;
      const c = lerp(b.o, b.c, e);
      ctx.globalAlpha = clamp(g * 2) * alphaFor(i);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(2, Math.min(4, view.barW * 0.12));
      ctx.beginPath();
      ctx.moveTo(x, view.y(lerp(b.o, b.h, e)));
      ctx.lineTo(x, view.y(lerp(b.o, b.l, e)));
      ctx.stroke();
      const top = view.y(Math.max(b.o, c));
      const bot = view.y(Math.min(b.o, c));
      ctx.fillRect(x - bw / 2, top, bw, Math.max(2, bot - top));
    });
    ctx.restore();
  }

  function drawVwapLine(view, uMax, glow, { head = false, alpha = 1 } = {}) {
    const pts = vwapPoints(view, uMax);
    if (pts.length < 2) return null;
    ctx.save();
    ctx.globalAlpha = alpha;
    clipPlot();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    tracePath(pts);
    ctx.strokeStyle = `rgba(255,181,71,${0.18 + 0.2 * glow})`;
    ctx.lineWidth = 16 + 10 * glow;
    ctx.shadowColor = C.amber;
    ctx.shadowBlur = 30;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = 6 + 2 * glow;
    ctx.stroke();
    ctx.strokeStyle = C.amberHot;
    ctx.lineWidth = 2;
    ctx.stroke();
    const [hx, hy] = pts.at(-1);
    if (head) {
      ctx.fillStyle = C.amberHot;
      ctx.shadowColor = C.amber;
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.arc(hx, hy, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return [hx, hy];
  }

  function drawVwapTag(view, value, alpha) {
    if (alpha <= 0) return;
    const y = clamp(view.y(value), PLOT.y0, PLOT.y1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.roundRect(PLOT.x1 + 12, y - 27, PANEL.x1 - PLOT.x1 - 22, 54, 10);
    ctx.fillStyle = C.amber;
    ctx.shadowColor = C.amber;
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = (PLOT.x1 + 12 + PANEL.x1 - 10) / 2;
    ctx.font = FONT.monoBold(14);
    ctx.fillText('VWAP', cx, y - 12);
    ctx.font = FONT.monoBold(21);
    ctx.fillText(value.toFixed(2), cx, y + 11);
    ctx.restore();
  }

  // ---------------------------------------------------------------- the chart, all scenes
  function drawChart(t) {
    const view = viewAt(t);
    const chartA = ease.out(prog(t, ...T.chartIn));
    if (chartA <= 0) return;
    const reveal = 78 * ease.inOutSine(prog(t, ...T.draw)) + (t > T.draw[1] ? 1 : 0);
    const uMax = Math.min(reveal, 78) - 0.5;

    // Which candles are in focus: below-VWAP closes in scene 2a, above-VWAP closes in 2b.
    const wBelow = prog(t, T.below, T.below + 0.3) * (1 - prog(t, T.above - 0.05, T.above + 0.2));
    const wAbove = prog(t, T.above, T.above + 0.25) * (1 - prog(t, T.dip - 0.05, T.dip + 0.2));
    const alphaFor = (i) => {
      const below = BARS[i].c < BARS[i].vwap;
      return 1 - 0.72 * (wBelow * (below ? 0 : 1) + wAbove * (below ? 1 : 0));
    };

    // Value tag rides the line's head while it draws, then sits where the line leaves the plot.
    const tagU = Math.min(uMax, view.ub - 0.5);
    const tagValue = D.vwap1m[clamp(Math.round((tagU + 0.5) * D.barMinutes) - 1, 0, D.vwap1m.length - 1)];
    const tagA = uMax > vwapU(0) ? prog(t, T.tagIn, T.tagIn + 0.2) : 0;

    ctx.save();
    ctx.globalAlpha = chartA;
    drawPanelFrame(1);
    drawGrid(view, 1, tagA > 0 ? view.y(tagValue) : -1e9);

    // Zones
    const fadeZones = 1 - prog(t, T.dip, T.dip + 0.35);
    drawZone(view, 'below', prog(t, T.below, T.below + 0.3) * lerp(1, 0.35, prog(t, T.above, T.above + 0.3)) * fadeZones,
      ease.out(prog(t, T.below, T.below + 0.5)));
    drawZone(view, 'above', prog(t, T.above, T.above + 0.3) * fadeZones, ease.out(prog(t, T.above, T.above + 0.5)));

    drawVolume(view, reveal, t, alphaFor);
    drawCandles(view, reveal, alphaFor);

    const glow = Math.sin(Math.PI * prog(t, T.dip + 0.2, T.recap)) ** 0.5;
    const drawing = t < T.draw[1] + 0.05;
    const head = drawVwapLine(view, uMax, glow, { head: drawing });

    if (head) {
      drawVwapTag(view, tagValue, tagA);
      if (drawing) {
        const flip = head[0] > PLOT.x1 - 130; // near the right edge: sit left of the line's head, clear of the axis
        pill(head[0] + (flip ? -18 : 18), head[1] - 34, 'VWAP', {
          font: FONT.monoBold(20), bg: C.amber, fg: C.ink, h: 38, padX: 12, align: flip ? 'right' : 'left',
          alpha: tagA * (1 - prog(t, T.draw[1] - 0.15, T.draw[1] + 0.05)),
        });
      }
    }

    drawZoneLabels(t, view);
    drawReclaim(t, view);
    drawDip(t, view);
    ctx.restore();

    // Recap: dim the chart behind the summary card.
    const dim = ease.out(prog(t, T.recap, T.recap + 0.3));
    if (dim > 0) {
      ctx.save();
      ctx.globalAlpha = 0.9 * dim;
      ctx.fillStyle = C.bg;
      ctx.beginPath();
      ctx.roundRect(PANEL.x0, PANEL.y0, PANEL.x1 - PANEL.x0, PANEL.y1 - PANEL.y0, 28);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawZoneLabels(t, view) {
    const fade = 1 - prog(t, T.dip, T.dip + 0.25);
    const sellers = ease.out(prog(t, T.below + 0.25, T.below + 0.55)) * lerp(1, 0.45, prog(t, T.above, T.above + 0.3)) * fade;
    const buyers = ease.out(prog(t, T.above + 0.25, T.above + 0.55)) * fade;
    if (sellers > 0) {
      // Empty space under the line after the morning / above it before the reclaim.
      pill(view.x(BARS.length * 0.52), view.y(FULL[2] + SPAN * 0.2) + (1 - sellers) * 16, "▼  SELLERS' ZONE", {
        font: FONT.monoBold(23), bg: 'rgba(255,77,97,0.16)', border: 'rgba(255,77,97,0.6)', fg: '#ff8a98', h: 52, align: 'center', alpha: sellers,
      });
    }
    if (buyers > 0) {
      pill(view.x(BARS.length * 0.18), view.y(FULL[3] - SPAN * 0.06) + (1 - buyers) * 16, "▲  BUYERS' ZONE", {
        font: FONT.monoBold(23), bg: 'rgba(38,208,124,0.16)', border: 'rgba(38,208,124,0.6)', fg: '#7af0b4', h: 52, align: 'center', alpha: buyers,
      });
    }
  }

  function drawReclaim(t, view) {
    const p = prog(t, T.reclaimRing, T.reclaimRing + 1);
    const a = 1 - prog(t, T.dip - 0.2, T.dip);
    if (p <= 0 || a <= 0) return;
    const x = view.x(RECLAIM_BAR + 0.5);
    const y = view.y(BARS[RECLAIM_BAR].vwap);
    ctx.save();
    ctx.globalAlpha *= a;
    ripple(x, y, p, C.up);
    pill(x + 40, y + 64, 'crosses above', {
      font: FONT.monoBold(20), bg: 'rgba(6,9,15,0.85)', border: 'rgba(38,208,124,0.6)', fg: '#7af0b4', h: 40, padX: 14,
      alpha: ease.out(prog(t, T.reclaimRing + 0.1, T.reclaimRing + 0.35)),
    });
    ctx.restore();
  }

  function drawDip(t, view) {
    const a = 1 - prog(t, T.recap - 0.1, T.recap + 0.15);
    if (t < T.dip || a <= 0) return;
    ctx.save();
    ctx.globalAlpha *= a;
    TOUCHES.forEach((bar, k) => {
      const start = T.touches[k];
      const x = view.x(bar + 0.5);
      const y = view.y(BARS[bar].vwap);
      ripple(x, y, prog(t, start, start + 1.2), C.amber);
      pill(x, y + 70, k === 0 ? 'touch' : 'touch again', {
        font: FONT.monoBold(20), bg: 'rgba(6,9,15,0.85)', border: 'rgba(255,181,71,0.6)', fg: C.amberHot, h: 40, padX: 14, align: 'center',
        alpha: ease.out(prog(t, start + 0.1, start + 0.35)),
      });
    });
    // Bounce from the second touch up to the 13:50 high.
    const last = TOUCHES.at(-1);
    const x0 = view.x(last + 0.5);
    const y0 = view.y(BARS[last].vwap) - 34;
    const x1 = view.x(BOUNCE_HIGH_BAR + 0.5);
    const y1 = view.y(BARS[BOUNCE_HIGH_BAR].h) - 26;
    const ap = ease.inOut(prog(t, ...T.arrow));
    arrow(x0, y0, x0 + 6, y1 + 20, x1, y1, ap, C.up);
    const gain = ((BARS[BOUNCE_HIGH_BAR].h / BARS[last].vwap - 1) * 100).toFixed(1);
    pill(x1 + 10, y1 - 34, `bounce +${gain}%`, {
      font: FONT.monoBold(24), bg: 'rgba(38,208,124,0.18)', border: 'rgba(38,208,124,0.7)', fg: '#7af0b4', h: 48, align: 'center',
      alpha: ease.out(prog(t, T.bounce, T.bounce + 0.25)),
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------- header copy, recap, footer
  function drawHeader(t) {
    for (const s of SCENES) {
      if (t < s.start || t > s.end) continue;
      const out = ease.inOut(prog(t, s.end - 0.2, s.end));
      const inP = ease.out(prog(t, s.start, s.start + 0.3));
      const a = inP * (1 - out);
      pill(TEXT_X + (1 - inP) * -30, CHIP_Y, s.chip, {
        font: FONT.monoBold(22), bg: 'rgba(255,181,71,0.12)', border: 'rgba(255,181,71,0.5)', fg: '#ffd08a', h: 48, padX: 20, alpha: a,
      });
      drawRichBlock(t, {
        lines: s.head, next: s.head2, start: s.start, end: s.end, morphAt: s.morphAt,
        fontFn: FONT.display, size: 84, ys: HEAD_Y, color: C.text,
      });
      if (s.sub) {
        drawRichBlock(t, {
          lines: [s.sub], next: s.sub2 && [s.sub2], start: s.subAt, end: s.end, morphAt: s.morphAt && s.morphAt + 0.1,
          fontFn: FONT.text, size: 39, ys: [SUB_Y], color: C.muted, stagger: 0.025,
        });
      }
    }
  }

  function drawRecap(t) {
    const rows = [
      { icon: 'up', color: C.up, text: '[green]Above[/] the line → buyers in control' },
      { icon: 'down', color: C.down, text: '[red]Below[/] the line → sellers in control' },
      { icon: 'bounce', color: C.amber, text: '[amber]Dips to it[/] → watch for a bounce' },
    ];
    const gap = 184;
    const baseY = (PANEL.y0 + PANEL.y1) / 2 - gap;
    ctx.save();
    // Fit all three rows to the same font size.
    ctx.font = FONT.textBold(44);
    const widest = Math.max(...rows.map((r) => ctx.measureText(r.text.replace(/\[\/?\w*\]/g, '')).width));
    const size = Math.min(44, Math.floor((44 * 790) / widest));
    rows.forEach((r, i) => {
      const p = ease.out(prog(t, T.recapRows[i], T.recapRows[i] + 0.35));
      if (p <= 0) return;
      const y = baseY + i * gap;
      const dx = (1 - p) * 50;
      ctx.globalAlpha = p;
      // card
      ctx.beginPath();
      ctx.roundRect(70 + dx, y - 70, 940, 140, 26);
      ctx.fillStyle = '#10151f';
      ctx.fill();
      ctx.strokeStyle = `${r.color}55`;
      ctx.lineWidth = 2;
      ctx.stroke();
      // icon
      const ix = 138 + dx;
      ctx.beginPath();
      ctx.arc(ix, y, 36, 0, Math.PI * 2);
      ctx.fillStyle = `${r.color}2e`;
      ctx.fill();
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = r.color;
      ctx.fillStyle = r.color;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (r.icon === 'up' || r.icon === 'down') {
        const s = r.icon === 'up' ? -1 : 1;
        ctx.moveTo(ix, y - s * 15);
        ctx.lineTo(ix, y + s * 15);
        ctx.moveTo(ix - 12, y + s * 3);
        ctx.lineTo(ix, y + s * 15);
        ctx.lineTo(ix + 12, y + s * 3);
        ctx.stroke();
      } else {
        // floor line with a "V" bounce off it
        ctx.moveTo(ix - 20, y + 14);
        ctx.lineTo(ix + 20, y + 14);
        ctx.moveTo(ix - 14, y - 14);
        ctx.lineTo(ix - 2, y + 6);
        ctx.lineTo(ix + 12, y - 14);
        ctx.moveTo(ix + 3, y - 15);
        ctx.lineTo(ix + 13, y - 15);
        ctx.lineTo(ix + 14, y - 5);
        ctx.stroke();
      }
      // text
      const { words, font } = layoutRich([r.text], FONT.textBold, size, [y + size * 0.36], 790);
      words.forEach((w) => drawWord({ ...w, x: w.x + 130 + dx }, font, 1, 0, C.text));
    });
    ctx.restore();
  }

  function drawFooter(t) {
    const a = prog(t, T.what, T.what + 0.4) * 0.9;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = FONT.mono(19);
    ctx.fillStyle = C.faint;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(D.credit, PANEL.x0 + 4, FOOTER_Y);
    ctx.textAlign = 'right';
    ctx.fillText('Education only · not financial advice', PANEL.x1 - 4, FOOTER_Y);
    ctx.restore();
  }

  // ---------------------------------------------------------------- hook: "VWAP" unfolds into its four words
  const HOOK_WORDS = ['Volume', 'Weighted', 'Average', 'Price'];

  function drawHookGhost(t) {
    const a = 1 - prog(t, ...T.hookOut);
    if (a <= 0) return;
    const view = viewAt(0);
    ctx.save();
    ctx.globalAlpha = 0.2 * a;
    ctx.filter = 'blur(3px)';
    drawCandles(view, 78, () => 1);
    ctx.filter = 'none';
    ctx.globalAlpha = 0.4 * a;
    drawVwapLine(view, lerp(-0.5, 77.5, ease.inOutSine(prog(t, 0, 1.05))), 0.3, { head: true });
    ctx.restore();
  }

  function drawHook(t) {
    const outP = ease.inOut(prog(t, ...T.hookOut));
    if (outP >= 1) return;
    const settle = ease.outBack(prog(t, 0, 0.35));
    const unfold = ease.inOut(prog(t, ...T.hookUnfold));

    ctx.save();
    ctx.globalAlpha = 1 - outP;
    // Exit: a quick push toward the viewer while fading, clearing the stage for the chart.
    const zoom = 1 + 0.07 * outP;
    ctx.translate(540, 1000);
    ctx.scale(zoom, zoom);
    ctx.translate(-540, -1000);

    // Dark scrim so the type reads over the ghost chart.
    const g = ctx.createRadialGradient(540, 960, 0, 540, 960, 700);
    g.addColorStop(0, 'rgba(6,9,15,0.85)');
    g.addColorStop(1, 'rgba(6,9,15,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    pill(W / 2, 640 - unfold * 40, 'TRADING BASICS', {
      font: FONT.monoBold(24), bg: 'rgba(255,181,71,0.12)', border: 'rgba(255,181,71,0.5)', fg: '#ffd08a', h: 52, padX: 22, align: 'center',
    });

    const bigSize = 250 * lerp(1.08, 1, settle);
    const smallSize = 136;
    ctx.font = FONT.display(bigSize);
    const letterW = HOOK_WORDS.map((w) => ctx.measureText(w[0]).width);
    const bigTotal = letterW.reduce((s, x) => s + x, 0);
    ctx.font = FONT.display(smallSize);
    const wordW = HOOK_WORDS.map((w) => ctx.measureText(w).width);
    const stackX = (W - Math.max(...wordW)) / 2;
    const bigBaseline = 1050;
    const stackTop = 830;
    const lineGap = 150;

    let bx = (W - bigTotal) / 2;
    HOOK_WORDS.forEach((word, i) => {
      const size = lerp(bigSize, smallSize, unfold);
      const x = lerp(bx, stackX, unfold);
      const y = lerp(bigBaseline, stackTop + i * lineGap, unfold);
      bx += letterW[i];

      ctx.font = FONT.display(size);
      ctx.textBaseline = 'alphabetic';
      const lg = ctx.createLinearGradient(0, y - size * 0.75, 0, y);
      lg.addColorStop(0, '#ffe2a6');
      lg.addColorStop(1, '#ff9f1c');
      ctx.fillStyle = lg;
      ctx.shadowColor = 'rgba(255,160,40,0.55)';
      ctx.shadowBlur = 50;
      ctx.fillText(word[0], x, y);
      ctx.shadowBlur = 0;

      // The rest of the word types on after its initial lands.
      const typeP = prog(t, T.hookType + i * HOOK_TYPE_STAGGER, T.hookType + 0.26 + i * HOOK_TYPE_STAGGER);
      if (typeP > 0) {
        const lead = ctx.measureText(word[0]).width;
        const rest = word.slice(1);
        const restW = ctx.measureText(rest).width;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + lead - 4, y - size, (restW + 12) * ease.out(typeP), size * 1.3);
        ctx.clip();
        ctx.fillStyle = C.text;
        ctx.globalAlpha *= clamp(typeP * 2);
        ctx.fillText(rest, x + lead, y);
        ctx.restore();
      }
    });

    ctx.font = FONT.text(40);
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'center';
    ctx.fillText(`explained in ${Math.round(DURATION)} seconds`, W / 2, lerp(1150, 1440, unfold));
    ctx.restore();
  }

  // ---------------------------------------------------------------- frame
  function draw(realT) {
    const t = realT / PACE;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawHookGhost(t);
    drawChart(t);
    drawHeader(t);
    drawRecap(t);
    drawFooter(t);
    drawHook(t);
    ctx.restore();
  }

  // ---------------------------------------------------------------- sound-effect cue sheet
  // scripts/soundtrack.mjs turns this into the animation sounds, so audio follows the same timeline as the picture.
  // Times and durations are converted to real seconds here.
  function audioCues() {
    const pan = (t, u) => clamp((viewAt(t).x(u) - W / 2) / (W / 2), -1, 1);
    const whoosh = (span, from, to, panFrom = 0, panTo = 0) => ({
      t: span[0], type: 'whoosh', dur: span[1] - span[0], from, to, pan: [panFrom, panTo],
    });
    const last = TOUCHES.at(-1);
    const flashPeak = (T.volFlash[0] + T.volFlash[1]) / 2;
    const cues = [
      { t: 0, type: 'impact' },
      whoosh([T.hookUnfold[0], T.hookUnfold[1] + 0.12], 500, 2600, -0.4, 0.4),
      ...HOOK_WORDS.map((_, i) => ({ t: T.hookType + i * HOOK_TYPE_STAGGER, type: 'sparkle', step: i })),
      whoosh(T.hookOut, 2400, 500), // title clears
      { t: T.what, type: 'land' }, // chart panel arrives
      { t: T.tagIn, type: 'blip' },
      // One tick per candle as it draws in: panned with its x position, pitched by its closing price.
      ...BARS.map((b, i) => ({
        t: T.draw[0] + ((T.draw[1] - T.draw[0]) * Math.acos(1 - (2 * i) / BARS.length)) / Math.PI,
        type: 'tick',
        pan: pan(T.draw[0], i + 0.5),
        level: (b.c - FULL[2]) / SPAN,
      })),
      { t: flashPeak - 0.12, type: 'weight', pan: pan(flashPeak, 4) }, // heavy-volume bars light up
      { t: T.below, type: 'zone', mood: 'down', dur: 0.5 },
      { t: T.above, type: 'flip' },
      { t: T.above, type: 'zone', mood: 'up', dur: 0.5 },
      { t: T.reclaimRing, type: 'ping', step: 2, pan: pan(T.reclaimRing, RECLAIM_BAR + 0.5) },
      whoosh(T.zoomIn, 300, 4200),
      ...TOUCHES.map((bar, k) => ({ t: T.touches[k], type: 'ping', step: k, pan: pan(T.touches[k], bar + 0.5) })),
      whoosh(T.arrow, 900, 6000, pan(T.arrow[0], last + 0.5), pan(T.arrow[1], BOUNCE_HIGH_BAR + 0.5)),
      { t: T.bounce, type: 'chime' },
      whoosh(T.zoomOut, 4000, 450),
      ...T.recapRows.map((t, i) => ({ t, type: 'pop', step: i })),
    ];
    return {
      duration: DURATION,
      cues: cues.map((c) => ({ ...c, t: c.t * PACE, ...(c.dur && { dur: c.dur * PACE }) })),
    };
  }

  window.REEL = { W, H, DURATION, FPS, audio: audioCues() };
  window.renderFrame = (t) => {
    draw(t);
    return canvas.toDataURL('image/png');
  };

  // ---------------------------------------------------------------- boot + preview player
  const renderMode = new URLSearchParams(location.search).has('render');
  if (renderMode) document.body.classList.add('render');

  const fontsReady = Promise.all(
    [FONT.display(100), FONT.text(100), FONT.textBold(100), FONT.mono(100), FONT.monoBold(100)].map((f) => document.fonts.load(f)),
  );

  fontsReady.then(() => {
    window.reelReady = true;
    draw(0);
    if (renderMode) return;
    const play = document.getElementById('play');
    const scrub = document.getElementById('scrub');
    scrub.max = DURATION;
    const clock = document.getElementById('clock');
    let playing = true;
    let t = 0;
    let last = performance.now();
    const show = () => {
      draw(t);
      scrub.value = t;
      clock.textContent = `${t.toFixed(2)}s`;
    };
    // Soundtrack written next to the video by `npm run render` / `npm run audio`.
    // Browsers only allow sound after a click or key press, so it joins in once you press Play.
    const sound = new Audio(`../out/${D.output}.wav`);
    let soundOk = true;
    sound.addEventListener('error', () => { soundOk = false; });
    const syncSound = () => {
      if (!soundOk) return;
      if (!playing) return sound.pause();
      sound.currentTime = t;
      sound.play().catch(() => {});
    };
    const toggle = () => {
      playing = !playing;
      play.textContent = playing ? 'Pause' : 'Play';
      last = performance.now();
      syncSound();
    };
    play.addEventListener('click', toggle);
    canvas.addEventListener('click', toggle);
    scrub.addEventListener('input', () => {
      if (playing) toggle();
      t = +scrub.value;
      show();
    });
    addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        if (playing) toggle();
        t = clamp(t + (e.code === 'ArrowRight' ? 1 : -1) / FPS, 0, DURATION - 1 / FPS);
        show();
      }
    });
    const tick = (now) => {
      if (playing) {
        // Follow the audio clock while sound runs, so picture and sound can't drift apart.
        const next = soundOk && !sound.paused ? sound.currentTime : t + (now - last) / 1000;
        if (next >= DURATION) {
          t = 0;
          syncSound();
        } else {
          t = next;
        }
        show();
      }
      last = now;
      requestAnimationFrame(tick);
    };
    syncSound();
    requestAnimationFrame(tick);
  });
})();
