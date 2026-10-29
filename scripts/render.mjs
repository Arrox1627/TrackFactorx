// Renders src/index.html frame by frame in headless Chromium and encodes an Instagram/TikTok-ready MP4.
// Usage: node scripts/render.mjs [out/vwap-explainer-reel.mp4]
// Optional: FRAMES=0,45,120 node scripts/render.mjs  -> writes just those frames as PNGs to out/frames/
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from './server.mjs';

// require() (unlike ESM import) also honours NODE_PATH, so a globally installed Playwright works too.
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = process.argv[2] ?? join(root, 'out', 'vwap-explainer-reel.mp4');
const onlyFrames = process.env.FRAMES?.split(',').map(Number);

const server = await startServer();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto(`${server.url}/src/index.html?render`);
  await page.waitForFunction(() => window.reelReady === true);
  const { DURATION, FPS } = await page.evaluate(() => window.REEL);
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
    const ffmpeg = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      // Silent stereo track: some upload pipelines and editors expect an audio stream.
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-map', '0:v', '-map', '1:a', '-shortest',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-tune', 'animation',
      '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outFile,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((resolve, reject) => {
      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
    });

    const total = Math.round(DURATION * FPS);
    for (let f = 0; f < total; f++) {
      const png = await grab(f);
      if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
      if (f % FPS === 0) process.stdout.write(`\rrendering ${f}/${total}`);
    }
    ffmpeg.stdin.end();
    await done;
    console.log(`\rwrote ${outFile} (${total} frames @ ${FPS} fps)`);
  }
} finally {
  await browser.close();
  server.close();
}
