// Generates the Android launcher icon set (legacy + adaptive) for the Lantern
// app from the same source art as the extension icons (`logo.jpg` at repo root).
//
// Why this exists: `npx cap add android` scaffolds Capacitor's placeholder
// icon, and `scripts/gen-icons.mjs` only produces the *extension* PNGs. This
// script propagates the real Lantern mark (glowing amber lantern on navy) into
// `android/app/src/main/res/mipmap-*` so the two icon sets can't silently
// diverge (issue #20).
//
// Cross-platform: uses `sharp` (no macOS `sips` dependency). Run `npm run
// icons:android`. The committed PNGs remain the source of truth for the build;
// re-run this only when `logo.jpg` changes.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'logo.jpg');
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');

// Android density buckets. Legacy square icon is 48dp @ mdpi; the adaptive
// foreground drawable is 108dp @ mdpi. Multipliers: mdpi 1, hdpi 1.5, xhdpi 2,
// xxhdpi 3, xxxhdpi 4.
const DENSITIES = [
  { dir: 'mdpi', legacy: 48, fg: 108 },
  { dir: 'hdpi', legacy: 72, fg: 162 },
  { dir: 'xhdpi', legacy: 96, fg: 216 },
  { dir: 'xxhdpi', legacy: 144, fg: 324 },
  { dir: 'xxxhdpi', legacy: 192, fg: 432 },
];

// How much of the canvas the cropped mark occupies. The adaptive foreground
// keeps the mark inside the 66dp safe-zone circle (~0.58 of the 108dp canvas);
// the legacy icon is fuller since it isn't masked/parallaxed the same way.
const FG_FILL = 0.667; // → mark ≈ 0.58 of canvas, within the adaptive safe zone
const LEGACY_FILL = 0.83;

async function measureMark(logo) {
  const { data, info } = await logo.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  // Warm-and-bright pixels are the amber lantern; this excludes both the navy
  // tile (R≈B) and the white corners (R≈B) via the R−B "warmth" test.
  let minx = W, miny = H, maxx = 0, maxy = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 120 && r - b > 40 && g > 80) {
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  }
  return { W, H, minx, miny, maxx, maxy, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2 };
}

// Average color of a frame just inside the crop border → the flat navy the mark
// sits on. Using the mark's own surrounding navy (not the #0b1326 UI token)
// keeps the composite seam-free and matches the existing extension icons, which
// are derived from this same logo.
async function sampleNavy(logo, crop) {
  const ring = 10;
  const { data, info } = await logo
    .clone()
    .extract(crop)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= ring && x < W - ring && y >= ring && y < H - ring) continue; // border only
      const i = (y * W + x) * C;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

const toHex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

async function composeIcon({ cropPng, size, fill, navy, round }) {
  const inner = Math.round(size * fill);
  const mark = await sharp(cropPng).resize(inner, inner, { fit: 'fill' }).toBuffer();
  let img = sharp({
    create: { width: size, height: size, channels: 4, background: { ...navy, alpha: 1 } },
  }).composite([{ input: mark, gravity: 'center' }]);
  let buf = await img.png().toBuffer();
  if (round) {
    const r = size / 2;
    const circle = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`
    );
    buf = await sharp(buf).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer();
  }
  return buf;
}

async function main() {
  const logo = sharp(SRC);
  const m = await measureMark(logo);

  // Square crop centred on the mark, clamped so it never reaches the white
  // rounded corners of the source tile.
  const halfMark = Math.max(m.maxx - m.cx, m.cx - m.minx, m.maxy - m.cy, m.cy - m.miny);
  const maxHalf = Math.min(m.cx - 140, m.W - 140 - m.cx, m.cy - 140, m.H - 140 - m.cy);
  const half = Math.round(Math.min(maxHalf, halfMark + 40));
  const crop = {
    left: Math.round(m.cx - half),
    top: Math.round(m.cy - half),
    width: half * 2,
    height: half * 2,
  };
  const navy = await sampleNavy(logo, crop);
  console.log(`mark bbox ${m.minx},${m.miny}→${m.maxx},${m.maxy}  crop ${crop.width}px  navy ${toHex(navy)}`);

  const cropPng = await sharp(SRC).extract(crop).png().toBuffer();

  for (const d of DENSITIES) {
    const dir = join(RES, `mipmap-${d.dir}`);
    const legacy = await composeIcon({ cropPng, size: d.legacy, fill: LEGACY_FILL, navy, round: false });
    const roundIco = await composeIcon({ cropPng, size: d.legacy, fill: LEGACY_FILL, navy, round: true });
    const fg = await composeIcon({ cropPng, size: d.fg, fill: FG_FILL, navy, round: false });
    writeFileSync(join(dir, 'ic_launcher.png'), legacy);
    writeFileSync(join(dir, 'ic_launcher_round.png'), roundIco);
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), fg);
    console.log(`mipmap-${d.dir}: launcher ${d.legacy}px, foreground ${d.fg}px`);
  }

  // Adaptive background layer → the mark's navy (keeps the masked edge seamless
  // with the opaque foreground).
  writeFileSync(
    join(RES, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${toHex(navy)}</color>\n</resources>\n`
  );
  console.log(`values/ic_launcher_background.xml → ${toHex(navy)}`);
}

main().catch((err) => {
  console.error('Android icon generation failed:', err.message);
  process.exit(1);
});
