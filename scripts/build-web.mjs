// Builds the installable web app (#237) into webapp/, which is committed and
// served as a static site at app.golantern.xyz. Same arrangement as the
// playground (scripts/build-demo.mjs).
//
//   npm run build:web              # write webapp/
//   npm run build:web -- --check   # build to a temp dir and fail if webapp/
//                                  # differs from it
//
// Every build (check or not) also asserts on the emitted files:
//   - the shell is complete: index.html, the web-app manifest, the service
//     worker and the icons the manifest names;
//   - the bundle carries the @lantern/scanner pipeline;
//   - no chrome.* extension call and no Android-only plugin made it in (the
//     `__WEB_BUILD__` / `__NATIVE_BUILD__` guards dead-code-eliminate them);
//   - no retired domain and no third-party font or CDN host;
//   - a strict Content-Security-Policy in index.html, with nothing inline.
//
// Then it writes webapp/SHA256SUMS, the hash of every file it serves, so anyone
// can compare app.golantern.xyz with this repository (#238).

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_REAL = join(ROOT, 'webapp');
const check = process.argv.includes('--check');
const OUT = check ? join(ROOT, 'dist-report', '.web-check') : OUT_REAL;

// Emitted only by the scan pipeline's verdict stage (packages/lantern-scanner).
const SCANNER_MARKER = 'screen_unknown';
const FORBIDDEN = [
  // Extension APIs: the web build talks to the in-page handler and IndexedDB.
  'chrome.runtime',
  'chrome.storage',
  'chrome.tabs',
  // Android-only plugins.
  'capacitor-mlkit',
  'isGoogleBarcodeScannerModuleAvailable',
  '@capacitor/preferences',
  // The "Open in Lantern" deep-link listener (#263), behind __NATIVE_BUILD__.
  'appUrlOpen',
  // As for the playground.
  'lantern.artisam.xyz',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
];

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out.sort();
}

const fail = (msg) => {
  console.error(`build:web: ${msg}`);
  process.exit(1);
};

rmSync(OUT, { recursive: true, force: true });
execSync(`npx vite build --config vite.config.web.ts --outDir "${OUT}" --logLevel warn`, {
  cwd: ROOT,
  stdio: 'inherit',
});

const built = files(OUT);
for (const f of ['index.html', 'manifest.webmanifest', 'sw.js']) {
  if (!existsSync(join(OUT, f))) fail(`no ${f} emitted`);
}
const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons ?? []) {
  if (!existsSync(join(OUT, icon.src)))
    fail(`the manifest names ${icon.src}, which wasn't emitted`);
}
const html = readFileSync(join(OUT, 'index.html'), 'utf8');
if (!html.includes('rel="manifest"')) fail('index.html does not link the web-app manifest');
// The CSP (#238): present straight after <meta charset>, strict, and nothing
// inline for it to have to allow.
const cspTag = html.match(
  /<head>\s*<meta charset="UTF-8"\s*\/?>\s*<meta http-equiv="Content-Security-Policy" content="([^"]+)"/,
);
if (!cspTag) fail('index.html has no Content-Security-Policy straight after <meta charset>');
const csp = cspTag[1]
  .replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&');
if (!/(^|; )script-src 'self'(;|$)/.test(csp))
  fail(`the CSP's script-src isn't exactly 'self': ${csp}`);
if (/unsafe-|\*/.test(csp)) fail(`the CSP allows unsafe sources or wildcards: ${csp}`);
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html))
  fail('index.html has an inline <script>, which the CSP blocks');
if (/\son[a-z]+=/i.test(html)) fail('index.html has an inline event handler, which the CSP blocks');

// Only the app's own JS: public/miniapps/ are separate sample pages.
const appJs = built.filter((f) => f.endsWith('.js') && !relative(OUT, f).startsWith('miniapps'));
if (!appJs.some((f) => readFileSync(f, 'utf8').includes(SCANNER_MARKER))) {
  fail('the built JS does not carry the @lantern/scanner pipeline (verdict code not found)');
}
for (const f of built.filter((f) => /\.(html|js|css|webmanifest)$/.test(f))) {
  const body = readFileSync(f, 'utf8');
  for (const s of FORBIDDEN) {
    if (body.includes(s)) fail(`${relative(ROOT, f)} contains ${s}`);
  }
}

// The served files' hashes, in `sha256sum --check` format (#238).
const sums = built
  .map(
    (f) =>
      `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${relative(OUT, f).split('\\').join('/')}`,
  )
  .join('\n');
writeFileSync(join(OUT, 'SHA256SUMS'), sums + '\n');

if (check) {
  const rel = (dir) => files(dir).map((f) => relative(dir, f));
  if (!existsSync(OUT_REAL)) fail('webapp/ is missing: run `npm run build:web` and commit it');
  const want = rel(OUT);
  const have = rel(OUT_REAL);
  const stale = [
    ...want.filter((f) => !have.includes(f)).map((f) => `missing ${f}`),
    ...have.filter((f) => !want.includes(f)).map((f) => `extra ${f}`),
    ...want
      .filter((f) => have.includes(f))
      .filter((f) => !readFileSync(join(OUT, f)).equals(readFileSync(join(OUT_REAL, f))))
      .map((f) => `changed ${f}`),
  ];
  rmSync(OUT, { recursive: true, force: true });
  if (stale.length) {
    fail(
      `webapp/ is stale against a fresh build: run \`npm run build:web\` and commit:\n  ${stale.join('\n  ')}`,
    );
  }
  console.log('build:web: webapp/ is up to date');
} else {
  console.log(`build:web: wrote ${built.length} files to webapp/`);
}
