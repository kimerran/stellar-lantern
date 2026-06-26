// Packages the built extension (dist/) into a versioned zip for distribution
// (Chrome Web Store upload, or hand-off for "Load unpacked"). Run after `build`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const RELEASE = join(ROOT, 'release');

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

const { name, version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
mkdirSync(RELEASE, { recursive: true });

const out = join(RELEASE, `${name}-${version}.zip`);
rmSync(out, { force: true }); // zip appends; start clean

try {
  // -r recurse, -X strip extra macOS attrs; run from dist so paths are relative.
  execFileSync('zip', ['-r', '-X', out, '.'], { cwd: DIST, stdio: 'ignore' });
} catch (err) {
  console.error('Packaging failed. `zip` is required (preinstalled on macOS/Linux).');
  console.error(err.message);
  process.exit(1);
}

console.log(`Packaged: release/${name}-${version}.zip`);
