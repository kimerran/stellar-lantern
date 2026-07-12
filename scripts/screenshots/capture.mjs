// Render the built harness with headless Chrome and write docs/ui/*.png.
// Run via `npm run screenshots` (which builds the harness first).
import { spawn, spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'dist');
const OUT = join(HERE, '../../docs/ui');
const BG = { r: 7, g: 11, b: 20 }; // #070b14 — the harness backdrop
const PORT = 4317;
const SCALE = 2;

const CHROME = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find(
  (b) => spawnSync('command', ['-v', b], { shell: true }).status === 0,
);
if (!CHROME) throw new Error('No Chrome/Chromium binary found on PATH');
if (!existsSync(join(DIST, 'index.html'))) throw new Error('Build the harness first (npm run screenshots)');

// Each view → the CSS window box (generous; content is trimmed tight afterwards)
// and the final output width in px.
const VIEWS = [
  { view: 'overview', file: 'overview.png', win: [1040, 1560], outWidth: 1920 },
  { view: 'settings-advanced', file: 'settings-advanced.png', win: [760, 1900], outWidth: 1040 },
];

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIST, stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

try {
  await new Promise((res) => setTimeout(res, 700)); // let the server bind
  for (const { view, file, win, outWidth } of VIEWS) {
    const tmp = join(mkdtempSync(join(tmpdir(), 'shot-')), 'raw.png');
    const args = [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
      `--force-device-scale-factor=${SCALE}`, `--window-size=${win[0]},${win[1]}`,
      '--virtual-time-budget=8000', '--run-all-compositor-stages-before-draw',
      '--default-background-color=070b14ff', `--screenshot=${tmp}`,
      `http://localhost:${PORT}/?view=${view}`,
    ];
    const res = spawnSync(CHROME, args, { stdio: 'ignore' });
    if (res.status !== 0 || !existsSync(tmp)) throw new Error(`Chrome failed to capture ${view}`);

    // Trim the uniform backdrop, then re-pad and normalize width.
    const pad = 40 * SCALE;
    await sharp(tmp)
      .trim({ background: BG, threshold: 24 })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: BG })
      .resize({ width: outWidth })
      .png({ compressionLevel: 9 })
      .toFile(join(OUT, file));
    // eslint-disable-next-line no-console
    console.log(`wrote docs/ui/${file}`);
  }
} finally {
  stop();
}
