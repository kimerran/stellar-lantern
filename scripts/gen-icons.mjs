// Generates the Lantern extension icons by downscaling the brand logo
// (logo.jpg) into the PNG sizes the MV3 manifest expects.
//
// Uses macOS `sips` (no npm image deps). On other platforms, resize logo.jpg to
// public/icons/icon-{16,32,48,128}.png with any tool — the committed PNGs are
// the source of truth for the build.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'logo.jpg');
const OUT = join(ROOT, 'public', 'icons');
const SIZES = [16, 32, 48, 128];

if (!existsSync(SRC)) {
  console.error(`Missing source logo: ${SRC}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

try {
  for (const size of SIZES) {
    const out = join(OUT, `icon-${size}.png`);
    execFileSync('sips', ['-s', 'format', 'png', '-z', String(size), String(size), SRC, '--out', out], {
      stdio: 'ignore',
    });
    console.log(`wrote icon-${size}.png`);
  }
} catch (err) {
  console.error('Icon generation failed. `sips` is macOS-only; on other platforms');
  console.error('resize logo.jpg into public/icons/icon-{16,32,48,128}.png manually.');
  console.error(err.message);
  process.exit(1);
}
