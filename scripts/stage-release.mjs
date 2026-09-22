// Stages the two release binaries under human names, with checksums and
// release notes, for the GitHub Release that release.yml publishes (#130).
//
// Why: Actions artifacts always arrive zipped (an APK downloads as a .zip the
// phone can't install), need a GitHub login, and expire. A Release serves each
// asset under its own name with no re-zipping — the APK downloads as an .apk
// and installs on tap — to anyone, indefinitely.
//
//   node scripts/stage-release.mjs \
//     --apk android/app/build/outputs/apk/debug/app-debug.apk \
//     --zip release/lantern-stellar-wallet-0.1.0.zip \
//     --out release/assets --sha <commit> --run <run_number>
//
// Writes  <out>/lantern-<version>-testnet.apk
//         <out>/lantern-extension-<version>.zip
//         <out>/SHA256SUMS.txt
//         <out>/RELEASE_NOTES.md
// and prints the tag + release name as `key=value` lines for the workflow.
//
// The pure helpers live in scripts/release-assets.mjs and are unit-tested
// (tests/release-assets.test.ts); this file only wires them to the filesystem.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assetNames,
  flagSet,
  releaseName,
  releaseNotes,
  releaseTag,
  sha256Hex,
  sumsFile,
} from './release-assets.mjs';

// ── CLI ──────────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) {
    if (fallback !== undefined) return fallback;
    console.error(`missing --${name}`);
    process.exit(2);
  }
  return process.argv[i + 1];
}

export function stage({ root, apkPath, zipPath, outDir, sha, runNumber, env }) {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const assets = assetNames(version);
  const tag = releaseTag(version, runNumber);
  for (const [label, p] of [
    ['APK', apkPath],
    ['extension zip', zipPath],
  ]) {
    if (!existsSync(p)) throw new Error(`${label} not found at ${p} — build it first.`);
  }
  mkdirSync(outDir, { recursive: true });
  copyFileSync(apkPath, join(outDir, assets.apk));
  copyFileSync(zipPath, join(outDir, assets.zip));
  const sums = [assets.apk, assets.zip].map((name) => ({
    name,
    sha256: sha256Hex(readFileSync(join(outDir, name))),
  }));
  writeFileSync(join(outDir, assets.sums), sumsFile(sums));
  const notes = releaseNotes({ version, tag, sha, runNumber, flags: flagSet(env), assets, sums });
  writeFileSync(join(outDir, assets.notes), notes);
  return { version, tag, name: releaseName(version, runNumber), assets, sums, outDir };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const result = stage({
    root,
    apkPath: resolve(root, arg('apk', 'android/app/build/outputs/apk/debug/app-debug.apk')),
    zipPath: resolve(root, arg('zip')),
    outDir: resolve(root, arg('out', 'release/assets')),
    sha: arg('sha', process.env.GITHUB_SHA ?? 'unknown'),
    runNumber: arg('run', process.env.GITHUB_RUN_NUMBER ?? '0'),
    env: process.env,
  });
  for (const s of result.sums) console.error(`${s.sha256}  ${s.name}`);
  console.error(`staged ${basename(result.outDir)}/ for ${result.tag}`);
  // `key=value` lines: the workflow appends stdout to $GITHUB_OUTPUT.
  console.log(`tag=${result.tag}`);
  console.log(`name=${result.name}`);
  console.log(`version=${result.version}`);
}
