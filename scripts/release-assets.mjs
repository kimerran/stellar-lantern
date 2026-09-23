// The pure half of the release staging (#130): asset names, the tag scheme,
// checksums, the flag set and the release notes. No node builtins, so the
// unit tests (tests/release-assets.test.ts) can import it under vitest's
// browser polyfills; scripts/stage-release.mjs does the filesystem work.

import { sha256 } from '@noble/hashes/sha256';

// Feature flags that describe what a build contains, in release.yml order.
// The notes list every one so a reviewer never has to read the workflow file
// at that commit to know what a given build carries (#125 needs SCANNER_AI and
// TELEMETRY_IDENTITY on for the alpha).
export const FLAG_NAMES = [
  'VITE_FEATURE_SWAP',
  'VITE_FEATURE_EARN_BLEND',
  'VITE_FEATURE_ANCHORS',
  'VITE_FEATURE_MINIAPPS',
  'VITE_FEATURE_SWAP_AGGREGATOR',
  'VITE_FEATURE_BIOMETRIC_UNLOCK',
  'VITE_FEATURE_GEOVELOCITY',
  'VITE_FEATURE_DEMO_AFFORDANCES',
  'VITE_FEATURE_PASSKEY',
  'VITE_FEATURE_SCANNER_AI',
  'VITE_FEATURE_TELEMETRY',
  'VITE_FEATURE_TELEMETRY_IDENTITY',
];

// The published names. Testnet is in the APK's name because that is what a
// tester sees in their Downloads folder; the extension zip is network-agnostic
// (the network is a Settings choice) so it carries the version only.
export function assetNames(version) {
  return {
    apk: `lantern-${version}-testnet.apk`,
    zip: `lantern-extension-${version}.zip`,
    sums: 'SHA256SUMS.txt',
    notes: 'RELEASE_NOTES.md',
  };
}

// Android's versionCode for a semver string (#141): major*10000 + minor*100 +
// patch, so it strictly increases across bumps and needs nothing but the
// version to reproduce. android/app/build.gradle computes the same formula in
// Groovy; tests/version.test.ts keeps the two in step. Minor and patch must
// stay under 100 for the ordering to hold.
export function versionCode(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-.*)?$/.exec(version);
  if (!m) throw new Error(`not a semver version: ${version}`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (minor > 99 || patch > 99) throw new Error(`versionCode needs minor and patch < 100: ${version}`);
  return major * 10000 + minor * 100 + patch;
}

// `v0.1.0-testnet.42`: the package version plus the workflow run number, so
// repeated merges of the same version never collide on a tag.
export function releaseTag(version, runNumber) {
  return `v${version}-testnet.${runNumber}`;
}

export function releaseName(version, runNumber) {
  return `Lantern ${version} — testnet build ${runNumber}`;
}

export function sha256Hex(bytes) {
  return Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

// The `sha256sum` file format: `<hex>  <name>` (two spaces), one per line,
// so `sha256sum -c SHA256SUMS.txt` verifies a download as-is.
export function sumsFile(entries) {
  return entries.map(({ name, sha256 }) => `${sha256}  ${name}`).join('\n') + '\n';
}

// Only the flags, only their string values — never a secret or a URL from the
// environment. Missing flags are listed as `unset` rather than skipped, so an
// absent flag is visible instead of silently defaulting.
export function flagSet(env) {
  return FLAG_NAMES.map((name) => ({
    name,
    value: env[name] === undefined ? 'unset' : String(env[name]),
  }));
}

export function releaseNotes({ version, tag, sha, runNumber, flags, assets, sums }) {
  const on = flags.filter((f) => f.value === 'true').map((f) => f.name);
  const off = flags.filter((f) => f.value !== 'true').map((f) => `${f.name}=${f.value}`);
  const sumOf = (name) => sums.find((s) => s.name === name)?.sha256 ?? '';
  return [
    `# Lantern ${version} — testnet build ${runNumber}`,
    '',
    `**Tag** \`${tag}\` · **Commit** \`${sha}\` · **Network** Stellar Testnet · **Alpha build** — not for real funds.`,
    '',
    '## Install',
    '',
    `- **Android** — download \`${assets.apk}\` on the phone, open it from the notification or Downloads, allow installs from this source if asked, tap **Install**. It is debug-signed for sideloading.`,
    `- **Chrome / Edge / Brave** — download \`${assets.zip}\`, unzip it somewhere you will keep (not Downloads), open \`chrome://extensions\`, turn on **Developer mode**, **Load unpacked**, pick the unzipped folder (it has \`manifest.json\` at its top level).`,
    '',
    '## Verify what you downloaded',
    '',
    '```',
    `${sumOf(assets.apk)}  ${assets.apk}`,
    `${sumOf(assets.zip)}  ${assets.zip}`,
    '```',
    '',
    `\`sha256sum -c ${assets.sums}\` in the download folder checks both (\`certutil -hashfile <file> SHA256\` on Windows, \`shasum -a 256 <file>\` on macOS).`,
    '',
    '## What this build contains',
    '',
    `Feature flags at build time — **on:** ${on.length ? on.map((n) => `\`${n}\``).join(', ') : 'none'}.`,
    '',
    `**Off / other:** ${off.length ? off.map((n) => `\`${n}\``).join(', ') : 'none'}.`,
    '',
    `Telemetry is opt-in and off until you turn it on in **Settings → Privacy**${on.includes('VITE_FEATURE_TELEMETRY_IDENTITY') ? '; this alpha build attaches your public wallet address to usage data once you do.' : '.'}`,
    '',
  ].join('\n');
}
