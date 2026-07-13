// Dead-code-elimination proof for build-time feature flags (#81).
//
// Builds the extension bundle twice and asserts the DEMO_AFFORDANCES-gated demo
// forced-verdict / "preview warnings" gallery is STRIPPED when the flag is off
// and PRESENT when on — i.e. the `__FEATURE_DEMO_AFFORDANCES__` define actually
// removes code + its imports (a store build can't be told to fake a verdict),
// not just skips a branch at runtime. Run via `npm run verify:flags`.

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Unique to the demo "preview warnings" gallery — sampleVerdict()'s sample text
// (src/core/scan/engine.ts), imported only by the DEMO_AFFORDANCES-gated
// <DemoWarnings> in Scan.tsx, so it tree-shakes away when the flag is off.
// (The demo deny-list ADDRESS is no longer a valid marker: it now intentionally
// ships in every build because isReportedAddress flags it on testnet — see #22.)
const MARKER = 'This sends 480 XLM to a brand-new account';
const DIST = 'dist';

// Only inspect emitted JS — sourcemaps embed the original source, so a `.map`
// would contain the marker even after the code is eliminated.
function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

function bundleHasMarker() {
  return jsFiles(DIST).some((f) => readFileSync(f, 'utf8').includes(MARKER));
}

function build(demoOn) {
  execSync('npx vite build', {
    stdio: 'ignore',
    env: { ...process.env, VITE_FEATURE_DEMO_AFFORDANCES: demoOn ? 'true' : 'false' },
  });
}

console.log('Building with VITE_FEATURE_DEMO_AFFORDANCES=false …');
build(false);
const offHas = bundleHasMarker();

console.log('Building with VITE_FEATURE_DEMO_AFFORDANCES=true …');
build(true);
const onHas = bundleHasMarker();

// Leave dist/ in the default (flag-off) state.
build(false);

let failed = false;
if (offHas) {
  console.error('✗ FAIL: demo forced-verdict/sample-gallery code is in the bundle with the flag OFF — no dead-code elimination.');
  failed = true;
} else {
  console.log('✓ demo forced-verdict/sample-gallery code ABSENT with DEMO_AFFORDANCES=false (dead-code-eliminated).');
}
if (!onHas) {
  console.error('✗ FAIL: demo forced-verdict/sample-gallery code absent with the flag ON — the marker or gate is wrong.');
  failed = true;
} else {
  console.log('✓ demo forced-verdict/sample-gallery code present with DEMO_AFFORDANCES=true (sanity check).');
}

process.exit(failed ? 1 : 0);
