import { describe, expect, it } from 'vitest';
import {
  FLAG_NAMES,
  assetNames,
  flagSet,
  releaseName,
  releaseNotes,
  releaseTag,
  sha256Hex,
  sumsFile,
} from '../scripts/release-assets.mjs';
import releaseYml from '../.github/workflows/release.yml?raw';
import pkg from '../package.json';

// The GitHub Release that release.yml publishes on every push to main (#130):
// the asset names a tester sees, the tag scheme, the checksum file, the notes'
// flag set, and the workflow wiring — all offline.

describe('asset names and tag', () => {
  it('names the binaries for humans, and the APK ends in .apk', () => {
    expect(assetNames('0.1.0')).toEqual({
      apk: 'lantern-0.1.0-testnet.apk',
      zip: 'lantern-extension-0.1.0.zip',
      sums: 'SHA256SUMS.txt',
      notes: 'RELEASE_NOTES.md',
    });
  });

  it('tags with the version + run number so repeated merges never collide', () => {
    expect(releaseTag('0.1.0', 42)).toBe('v0.1.0-testnet.42');
    expect(releaseTag('0.1.0', 43)).not.toBe(releaseTag('0.1.0', 42));
    expect(releaseName('0.1.0', 42)).toBe('Lantern 0.1.0 — testnet build 42');
  });
});

describe('checksums', () => {
  it('writes the sha256sum format so `sha256sum -c` verifies a download as-is', () => {
    const line = sumsFile([{ name: 'a.apk', sha256: 'ab'.repeat(32) }]);
    expect(line).toBe(`${'ab'.repeat(32)}  a.apk\n`);
    expect(sha256Hex(Buffer.from('lantern'))).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(Buffer.from(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('release notes', () => {
  const flags = flagSet({
    VITE_FEATURE_SCANNER_AI: 'true',
    VITE_FEATURE_TELEMETRY: 'true',
    VITE_FEATURE_TELEMETRY_IDENTITY: 'true',
    VITE_FEATURE_DEMO_AFFORDANCES: 'false',
    VITE_SOROSWAP_API_KEY: 'sk-should-never-appear',
    VITE_LANTERN_API_URL: 'https://api.example',
  });
  const assets = assetNames('0.1.0');
  const sums = [
    { name: assets.apk, sha256: '1'.repeat(64) },
    { name: assets.zip, sha256: '2'.repeat(64) },
  ];
  const notes = releaseNotes({
    version: '0.1.0',
    tag: 'v0.1.0-testnet.7',
    sha: 'deadbeef',
    runNumber: 7,
    flags,
    assets,
    sums,
  });

  it('state the version, the commit and the VITE_FEATURE_* set', () => {
    expect(notes).toContain('Lantern 0.1.0');
    expect(notes).toContain('`v0.1.0-testnet.7`');
    expect(notes).toContain('`deadbeef`');
    expect(notes).toMatch(
      /\*\*on:\*\* `VITE_FEATURE_SCANNER_AI`, `VITE_FEATURE_TELEMETRY`, `VITE_FEATURE_TELEMETRY_IDENTITY`/,
    );
    expect(notes).toContain('`VITE_FEATURE_DEMO_AFFORDANCES=false`');
    // An absent flag is visible as `unset`, never silently skipped.
    expect(notes).toContain('`VITE_FEATURE_PASSKEY=unset`');
    expect(notes).toContain('attaches your public wallet address');
  });

  it('carry the hashes and an install pointer per target', () => {
    expect(notes).toContain(`${'1'.repeat(64)}  lantern-0.1.0-testnet.apk`);
    expect(notes).toContain(`${'2'.repeat(64)}  lantern-extension-0.1.0.zip`);
    expect(notes).toMatch(/\*\*Android\*\* — download `lantern-0\.1\.0-testnet\.apk`/);
    expect(notes).toMatch(/\*\*Load unpacked\*\*/);
  });

  it('never include a secret or a URL from the environment', () => {
    expect(notes).not.toContain('sk-should-never-appear');
    expect(notes).not.toContain('SOROSWAP');
    expect(notes).not.toContain('https://api.example');
    expect(flags.map((f) => f.name)).toEqual(FLAG_NAMES);
  });

  it('list exactly the flags release.yml sets, in its order', () => {
    const inYml = [...releaseYml.matchAll(/^  (VITE_FEATURE_[A-Z_]+):/gm)].map((m) => m[1]);
    expect(inYml).toEqual(FLAG_NAMES);
  });
});

describe('release.yml publishes a Release and keeps the artifacts', () => {
  it('has contents: write, stages after both builds, and creates a pre-release with all three files', () => {
    expect(releaseYml).toMatch(/^permissions:\n  contents: write/m);
    const apkBuild = releaseYml.indexOf('name: Build debug APK');
    const stageAt = releaseYml.indexOf('name: Stage release assets');
    const releaseAt = releaseYml.indexOf('uses: softprops/action-gh-release@v2');
    expect(apkBuild).toBeGreaterThan(0);
    expect(stageAt).toBeGreaterThan(apkBuild);
    expect(releaseAt).toBeGreaterThan(stageAt);
    expect(releaseYml).toMatch(/tag_name: \$\{\{ steps\.stage\.outputs\.tag \}\}/);
    expect(releaseYml).toMatch(/body_path: release\/assets\/RELEASE_NOTES\.md/);
    expect(releaseYml).toMatch(/prerelease: true/);
    expect(releaseYml).toMatch(/fail_on_unmatched_files: true/);
    for (const f of [
      'release/assets/lantern-*-testnet.apk',
      'release/assets/lantern-extension-*.zip',
      'release/assets/SHA256SUMS.txt',
    ]) {
      expect(releaseYml).toContain(f);
    }
    // Release only on a real push to main — a manual dispatch builds but does not publish.
    expect(releaseYml).toMatch(/name: Create GitHub Release\n\s+if: github\.event_name == 'push'/);
  });

  it('the run artifacts stay (debugging a run is not distribution)', () => {
    expect(releaseYml).toMatch(/name: extension-release\n\s+path: release\/\*\.zip/);
    expect(releaseYml).toMatch(
      /name: app-debug\n\s+path: android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/,
    );
  });

  it('the alpha flags the guide depends on are on in this workflow', () => {
    expect(releaseYml).toMatch(/VITE_FEATURE_SCANNER_AI: 'true'/);
    expect(releaseYml).toMatch(/VITE_FEATURE_TELEMETRY_IDENTITY: 'true'/);
  });

  it("the stager is called with the packager's zip and the package.json version", () => {
    expect(releaseYml).toMatch(/node scripts\/stage-release\.mjs/);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(assetNames(pkg.version).zip).toBe(`lantern-extension-${pkg.version}.zip`);
  });
});
