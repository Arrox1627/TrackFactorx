// Renders src/index.html frame by frame in headless Chromium, synthesises the soundtrack from the reel's cue sheet,
// and encodes an Instagram/TikTok-ready MP4 (plus the soundtrack as a WAV next to it).
// Usage: node scripts/render.mjs [out/name.mp4]      (default: out/<preset output name>.mp4)
//   AUDIO_ONLY=1 node scripts/render.mjs              -> rebuild the soundtrack and swap it into the existing MP4
//   FRAMES=0,45,120 node scripts/render.mjs           -> write just those frames as PNGs to out/frames/
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from './server.mjs';
import { renderSoundtrack, writeWav } from './soundtrack.mjs';

// require() (unlike ESM import) also honours NODE_PATH, so a globally installed Playwright works too.
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const onlyFrames = process.env.FRAMES?.split(',').map(Number);
const audioOnly = Boolean(process.env.AUDIO_ONLY);

const run = (args, input) =>
  new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
    if (input) Promise.resolve(input(p.stdin)).catch(reject);
  });

const server = await startServer();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto(`${server.url}/src/index.html?render`);
  await page.waitForFunction(() => window.reelReady === true);
  const { DURATION, FPS, audio } = await page.evaluate(() => window.REEL);
  const output = await page.evaluate(() => window.REEL_DATA.output);
  const outFile = process.argv[2] ?? join(root, 'out', `${output}.mp4`);
  const wavFile = outFile.replace(/\.mp4$/, '.wav');
  const grab = async (frame) => {
    const url = await page.evaluate((t) => window.renderFrame(t), frame / FPS);
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  };

  if (onlyFrames) {
    const dir = join(root, 'out', 'frames');
    mkdirSync(dir, { recursive: true });
    for (const f of onlyFrames) writeFileSync(join(dir, `frame-${String(f).padStart(3, '0')}.png`), await grab(f));
    console.log(`wrote ${onlyFrames.length} frame(s) to ${dir}`);
  } else {
    mkdirSync(dirname(outFile), { recursive: true });
    const track = renderSoundtrack(audio);
    writeWav(wavFile, track);
    console.log(`wrote ${wavFile} (${audio.cues.length} cues, ${track.loudness.toFixed(1)} LUFS)`);
    const audioArgs = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart'];

    if (audioOnly) {
      const tmp = outFile.replace(/\.mp4$/, '.tmp.mp4');
      await run(['-i', outFile, '-i', wavFile, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...audioArgs, tmp]);
      renameSync(tmp, outFile);
      console.log(`swapped the soundtrack into ${outFile}`);
    } else {
      const total = Math.round(DURATION * FPS);
      await run(
        [
          '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
          '-i', wavFile,
          '-map', '0:v', '-map', '1:a', '-shortest',
          '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-tune', 'animation',
          '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS),
          ...audioArgs,
          outFile,
        ],
        async (stdin) => {
          for (let f = 0; f < total; f++) {
            if (!stdin.write(await grab(f))) await new Promise((r) => stdin.once('drain', r));
            if (f % FPS === 0) process.stdout.write(`\rrendering ${f}/${total}`);
          }
          stdin.end();
        },
      );
      console.log(`\rwrote ${outFile} (${total} frames @ ${FPS} fps)`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
