// Builds the D4 public playground (#183) into homepage/demo/, which is
// committed and served by the homepage's Railway static site at
// golantern.xyz/demo/ — the same arrangement as /docs.
//
//   npm run build:demo              # write homepage/demo/
//   npm run build:demo -- --check   # build to a temp dir and fail if
//                                   # homepage/demo/ differs from it
//
// Every build (check or not) also asserts on the emitted files themselves:
//   - the bundle carries the @lantern/scanner pipeline — grepped from the built
//     JS, so the "same scanner package the extension uses" claim is checked on
//     the output;
//   - no reference to the retired lantern.artisam.xyz domain (#173);
//   - no third-party font or CDN host, since the page must load nothing
//     from anyone else (#128's rule for the wallet, applied here).

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_REAL = join(ROOT, 'homepage', 'demo');
const check = process.argv.includes('--check');
const OUT = check ? join(ROOT, 'dist-report', '.demo-check') : OUT_REAL;

// A string only the scan pipeline's verdict stage emits (packages/lantern-
// scanner/src/verdict.ts) and the page never prints itself: present only if
// `runPipeline` is really in the bundle, not merely the package's constants.
const SCANNER_MARKER = 'screen_unknown';
const FORBIDDEN = [
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
  console.error(`build:demo: ${msg}`);
  process.exit(1);
};

rmSync(OUT, { recursive: true, force: true });
execSync(`npx vite build --config vite.config.demo.ts --outDir "${OUT}" --logLevel warn`, {
  cwd: ROOT,
  stdio: 'inherit',
});

const built = files(OUT);
if (!existsSync(join(OUT, 'index.html'))) fail('no index.html emitted');

const text = built.filter((f) => /\.(html|js|css)$/.test(f));
if (!text.some((f) => f.endsWith('.js') && readFileSync(f, 'utf8').includes(SCANNER_MARKER))) {
  fail('the built JS does not carry the @lantern/scanner pipeline (verdict code not found)');
}
for (const f of text) {
  const body = readFileSync(f, 'utf8');
  for (const host of FORBIDDEN) {
    if (body.includes(host)) fail(`${relative(ROOT, f)} references ${host}`);
  }
}

if (check) {
  const rel = (dir) => files(dir).map((f) => relative(dir, f));
  if (!existsSync(OUT_REAL)) fail('homepage/demo/ is missing — run `npm run build:demo` and commit it');
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
    fail(`homepage/demo/ is stale against a fresh build — run \`npm run build:demo\` and commit:\n  ${stale.join('\n  ')}`);
  }
  console.log('build:demo: homepage/demo/ is up to date');
} else {
  console.log(`build:demo: wrote ${built.length} files to homepage/demo/`);
}
