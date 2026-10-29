# VWAP in 10 seconds — explainer reel

A 10-second vertical (1080×1920, 30 fps) reel that teaches a complete beginner what **VWAP** is and how traders use it,
animated over a realistic candlestick chart with its VWAP line.

| File | Chart |
| --- | --- |
| [`out/vwap-explainer-reel.mp4`](out/vwap-explainer-reel.mp4) | **Main version.** Made-up but realistic intraday day for a fictional ticker, `DEMO`. |
| [`out/vwap-explainer-reel-msft.mp4`](out/vwap-explainer-reel-msft.mp4) | Alternate. Real Microsoft (MSFT) session from Apr 22, 2016. |

Both are H.264 with a silent AAC track, ready for Instagram Reels, TikTok and YouTube Shorts.

## What the viewer sees

| Time | Beat | On screen |
| --- | --- | --- |
| 0.0–1.3 s | Hook | Big **VWAP** unfolds into **V**olume **W**eighted **A**verage **P**rice |
| 1.4–4.0 s | 1 · What it is | "The average price of every share traded today." Candles and the VWAP line draw in together; the heavy opening volume bars flash to show that big trades pull the line harder. |
| 4.0–5.35 s | 2 · How to read it | "Price **below** the line → **sellers** in control." The red zone appears and the morning sell-off candles stay highlighted. |
| 5.35–6.7 s | 2 · How to read it | The words roll to "Price **above** the line → **buyers** in control." The green zone appears, with a ring where price crosses back above VWAP. |
| 6.7–8.55 s | 3 · How to use it | "Dips to the line often **bounce**." The chart zooms in on two pullbacks that touch VWAP and the bounce that follows (with its % move). |
| 8.55–10 s | Recap | Above → buyers, Below → sellers, Dips to it → watch for a bounce. "A guide, not a guarantee." |

## Chart data

- **Sample day (default):** [`scripts/generate-sample.mjs`](scripts/generate-sample.mjs) makes the data. It's a seeded
  simulation of 1-minute bars: price follows a scripted path with random noise, wicks come from the noise inside each
  minute, and volume is heavy at the open and close and rises on big candles. The day sells off below VWAP, crosses
  back above at 11:30, pulls back to VWAP at 12:40 and 13:30, then rallies. It's labelled "Illustrative data" on screen.
- **Real MSFT day:** see [`data/README.md`](data/README.md).

[`scripts/build-data.mjs`](scripts/build-data.mjs) turns either dataset into 5-minute candles plus VWAP. VWAP is the
running sum of typical price × volume divided by the running sum of volume, reset at the open. The script also finds
the moments the reel points at: the cross back above VWAP, the two touches and the bounce high. It also sets the
full-day and zoomed chart ranges. Nothing in the animation is tied to one dataset.

## How it's built

Every frame is a pure function of time `t`, drawn on a `<canvas>` by [`src/reel.js`](src/reel.js).
[`scripts/render.mjs`](scripts/render.mjs) opens the page in headless Chromium (Playwright), captures all 300 frames,
and pipes them into ffmpeg.

```
scripts/generate-sample.mjs     -> data/sample_1min.csv     (made-up day)
data/MSFT_2016-04-22_1min.csv   real day
scripts/build-data.mjs          -> src/data.js  (5-min candles, VWAP, key moments, chart ranges)
src/index.html + src/reel.js    the animation (also a live preview player)
scripts/render.mjs              -> out/*.mp4
assets/fonts/                   Inter (SIL OFL 1.1), Latin subset
```

### Re-render or tweak it

Requirements: Node 18+, ffmpeg on your PATH.

```bash
npm install
npx playwright install chromium

npm run sample               # regenerate data/sample_1min.csv (edit the price path in generate-sample.mjs)
npm run data                 # build src/data.js from the sample day   (or: npm run data -- msft)
npm run preview              # live player at http://localhost:5173/src/ (space = play/pause, ←/→ = step a frame)
npm run render               # writes out/vwap-explainer-reel.mp4 (~1 min)
npm run frames -- 0,120,240  # just those frame numbers, as PNGs in out/frames/
```

To change the wording, edit `SCENES` near the top of `src/reel.js`. Timings live in the `T` object, and colours in `C`.
Keyword colouring uses `[amber]…[/]`, `[red]…[/]` and `[green]…[/]` markup.

## Posting notes

- Text and the chart sit between y≈270 and y≈1610, so the platform header and caption overlays don't cover them.
  The price-axis labels on the far right may sit under the like/comment buttons. They aren't needed to follow the story.
- The audio track is silent on purpose. Add a trending sound in the app when you post.
- The first frame is the big "VWAP" title, so it works as the default cover.
- Educational content only, not financial advice. The video says so on screen.
