# VWAP in 10 seconds — explainer reel

A 10-second vertical (1080×1920, 30 fps) reel that teaches a complete beginner what **VWAP** is and how traders use it,
animated over a realistic candlestick chart with its VWAP line, with a soundtrack synced to the animation.

| File | Chart |
| --- | --- |
| [`out/vwap-explainer-reel.mp4`](out/vwap-explainer-reel.mp4) | **Main version.** Made-up but realistic intraday day for a fictional ticker, `DEMO`. |
| [`out/vwap-explainer-reel-msft.mp4`](out/vwap-explainer-reel-msft.mp4) | Alternate. Real Microsoft (MSFT) session from Apr 22, 2016. |

Both are H.264 + AAC (48 kHz stereo), mastered to -14 LUFS with true peak ≤ -1.3 dBTP, ready for Instagram Reels,
TikTok and YouTube Shorts. Each soundtrack is also saved on its own (`out/*.wav`) for editing in CapCut or Premiere.

## What the viewer sees and hears

| Time | Beat | On screen | Sound |
| --- | --- | --- | --- |
| 0–1.35 s | Hook | Big **VWAP** unfolds into **V**olume **W**eighted **A**verage **P**rice | Impact, whoosh, four sparkles as the words type in, then a riser and a short silence |
| 1.35–4.05 s | 1 · What it is | "The average price of every share traded today." Candles and the VWAP line draw in together; the heavy opening volume bars flash. | The beat drops. One tick per candle, panned left to right with the chart and pitched by that candle's price, so you hear the sell-off and the recovery. |
| 4.05–5.4 s | 2 · How to read it | "Price **below** the line → **sellers** in control." Red zone, morning sell-off highlighted. | Music turns muffled and dark, falling motif, red-zone sweep |
| 5.4–6.75 s | 2 · How to read it | Words roll to "Price **above** the line → **buyers** in control." Green zone, ring where price crosses back above. | Word-flip clicks, music opens up bright, rising motif, ping on the cross |
| 6.75–8.55 s | 3 · How to use it | "Dips to the line often **bounce**." Zoom into two VWAP touches and the bounce (with its % move). | Zoom whoosh, drums drop out, a sonar ping on each touch, swoosh up, then a chime on "bounce", and a snare build |
| 8.55–10 s | Recap | Above → buyers, Below → sellers, Dips to it → watch for a bounce. "A guide, not a guarantee." | Crash, full beat, one pop per recap row |

## Soundtrack

[`scripts/soundtrack.mjs`](scripts/soundtrack.mjs) synthesises everything in code, so there are no samples and nothing
to license. The reel exports a cue sheet (`window.REEL.audio`) built from the same timing constants that drive the
animation, so each sound lands on its visual. If you retime the animation, the audio follows.

- **Music:** a 133⅓ BPM bed (1 beat = 0.45 s) with kick, clap, hats, bass, pad and a plucked arpeggio, plus sidechain
  "pumping". Scene changes were nudged onto that beat grid (by 0.05 s at most) so cuts land on the beat. The chords
  and a filter follow the story:
  - neutral for "what it is";
  - minor and muffled for sellers;
  - a bright lift for buyers;
  - tension in the zoom;
  - a resolution on the recap.
- **Mix:** the music ducks a little under each sound effect. Sub-bass is trimmed because phone speakers can't play it.
  The master is normalised to -14 LUFS (BS.1770) with a true-peak look-ahead limiter.

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
[`scripts/render.mjs`](scripts/render.mjs) opens the page in headless Chromium (Playwright), synthesises the
soundtrack from the cue sheet, captures all 300 frames, and pipes them into ffmpeg.

```
scripts/generate-sample.mjs     -> data/sample_1min.csv     (made-up day)
data/MSFT_2016-04-22_1min.csv   real day
scripts/build-data.mjs          -> src/data.js  (5-min candles, VWAP, key moments, chart ranges)
src/index.html + src/reel.js    the animation, its audio cue sheet, and a live preview player
scripts/soundtrack.mjs          music + sound effects, synthesised from the cue sheet
scripts/render.mjs              -> out/*.mp4 + out/*.wav
assets/fonts/                   Inter (SIL OFL 1.1), Latin subset
```

### Re-render or tweak it

Requirements: Node 18+, ffmpeg on your PATH.

```bash
npm install
npx playwright install chromium

npm run sample               # regenerate data/sample_1min.csv (edit the price path in generate-sample.mjs)
npm run data                 # build src/data.js from the sample day   (or: npm run data -- msft)
npm run preview              # live player at http://localhost:5173/src/ (click or space = play/pause with sound, ←/→ = step a frame)
npm run render               # writes out/vwap-explainer-reel.mp4 + .wav (~1 min)
npm run audio                # rebuild only the soundtrack and swap it into the existing MP4 (a few seconds)
npm run frames -- 0,120,240  # just those frame numbers, as PNGs in out/frames/
```

`render` and `audio` write the files for whichever dataset `src/data.js` was last built from. To rebuild the MSFT cut,
run `npm run data -- msft` first.

- **Wording:** edit `SCENES` near the top of `src/reel.js`. Keyword colouring uses `[amber]…[/]`, `[red]…[/]` and
  `[green]…[/]` markup.
- **Timing and colours:** timings live in the `T` object, colours in `C`.
- **Sound:** levels, chords and instruments are in `scripts/soundtrack.mjs`. `renderSfx` handles each cue type, and
  `renderMusic` builds the beat.

## Posting notes

- Text and the chart sit between y≈270 and y≈1610, so the platform header and caption overlays don't cover them.
  The price-axis labels on the far right may sit under the like/comment buttons. They aren't needed to follow the story.
- The video has its own soundtrack. To use a trending sound instead, turn the original audio down in the app when you post.
- The first frame is the big "VWAP" title, so it works as the default cover.
- Educational content only, not financial advice. The video says so on screen.
