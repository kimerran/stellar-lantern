import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import manifest from '../manifest.config';
import { APP_VERSION } from '@shared/version';
import {
  assetNames,
  checkReleaseVersion,
  compareVersions,
  latestReleasedVersion,
  nextVersion,
  versionCode,
} from '../scripts/release-assets.mjs';
import buildGradle from '../android/app/build.gradle?raw';
import releaseYml from '../.github/workflows/release.yml?raw';
import gateYml from '../.github/workflows/release-gate.yml?raw';

// One version, four surfaces (#141). Before this, the APK said 1.0 (code 1)
// while the manifest, telemetry and the Release said 0.1.0, and nothing
// checked. package.json is the source; everything else must derive from it.

const gradleLiteral = /^\s*version(Name|Code)\s+["']?[\d.]+["']?\s*$/m;

describe('a single version source', () => {
  it('package.json holds a plain semver version', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('the extension manifest reports package.json\'s version', async () => {
    const m = await (typeof manifest === 'function' ? manifest({ command: 'build', mode: 'production' }) : manifest);
    expect(m.version).toBe(pkg.version);
  });

  it('APP_VERSION (telemetry appVersion, Settings → About) is package.json\'s version', () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('build.gradle reads versionName and versionCode from package.json, with no literal left', () => {
    expect(buildGradle).not.toMatch(gradleLiteral);
    expect(buildGradle).toMatch(/JsonSlurper\(\)\.parse\(file\('\.\.\/\.\.\/package\.json'\)\)\.version/);
    expect(buildGradle).toMatch(/^\s*versionName lanternVersion\s*$/m);
    expect(buildGradle).toMatch(/^\s*versionCode lanternVersionCode\(lanternVersion\)\s*$/m);
    // The Groovy formula is the same as versionCode() below.
    expect(buildGradle).toContain('major * 10000 + minor * 100 + patch');
  });

  it('the release assets are named for that version', () => {
    expect(assetNames(pkg.version).apk).toBe(`lantern-${pkg.version}-testnet.apk`);
  });
});

describe('versionCode', () => {
  it('is major*10000 + minor*100 + patch', () => {
    expect(versionCode('0.1.0')).toBe(100);
    expect(versionCode('0.2.0')).toBe(200);
    expect(versionCode('1.0.3')).toBe(10003);
  });

  it('strictly increases across minor bumps, patch bumps and the jump to 1.0', () => {
    const seq = ['0.1.0', '0.1.1', '0.2.0', '0.10.0', '0.99.99', '1.0.0'].map(versionCode);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThan(seq[i - 1]!);
  });

  it('beats the versionCode 1 every APK shipped with before #141', () => {
    expect(versionCode(pkg.version)).toBeGreaterThan(1);
  });

  it('refuses versions it cannot order', () => {
    expect(() => versionCode('0.100.0')).toThrow();
    expect(() => versionCode('1.0')).toThrow();
  });
});

describe('the minor bump per release', () => {
  it('bumps minor by default, patch and major on request', () => {
    expect(nextVersion('0.1.0')).toBe('0.2.0');
    expect(nextVersion('0.9.3')).toBe('0.10.0');
    expect(nextVersion('0.2.0', 'patch')).toBe('0.2.1');
    expect(nextVersion('0.9.3', 'major')).toBe('1.0.0');
    expect(() => nextVersion('0.1.0', 'pre' as never)).toThrow();
  });

  it('compares numerically, not as strings', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0);
    expect(compareVersions('0.2.0', '1.0.0')).toBe(-1);
  });

  it('finds the latest released version among the release tags only', () => {
    const tags = ['v0.1.0-testnet.8', 'v0.1.0-testnet.12', 'v0.10.0-testnet.3', 'v0.9.0-testnet.40', 'docs-v2', 'v2.0.0'];
    expect(latestReleasedVersion(tags)).toBe('0.10.0');
    expect(latestReleasedVersion([])).toBeNull();
  });

  it('the gate fails a release that reuses a released version, and names the fix', () => {
    const tags = ['v0.1.0-testnet.8', 'v0.1.0-testnet.12'];
    const r = checkReleaseVersion('0.1.0', tags);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('npm run version:bump');
    expect(!r.ok && r.message).toContain('0.2.0');
    expect(checkReleaseVersion('0.2.0', tags)).toEqual({ ok: true, latest: '0.1.0' });
    expect(checkReleaseVersion('0.1.0', [])).toEqual({ ok: true, latest: null });
  });

  it('the package version is newer than the last release (the tags that existed at #141)', () => {
    expect(checkReleaseVersion(pkg.version, ['v0.1.0-testnet.8', 'v0.1.0-testnet.12']).ok).toBe(true);
  });
});

describe('the release workflows gate on the version and never push', () => {
  it('release.yml checks the version on push, before the tests and builds', () => {
    const gate = releaseYml.indexOf('run: npm run version:check');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(releaseYml.indexOf('name: Test'));
    expect(releaseYml.slice(releaseYml.lastIndexOf('- name:', gate), gate)).toContain("if: github.event_name == 'push'");
  });

  it('release PRs into main run the same check', () => {
    expect(gateYml).toMatch(/pull_request:\n    branches: \[main\]/);
    expect(gateYml).toContain('run: npm run version:check');
  });

  it('no release workflow commits or pushes, so a release cannot trigger another', () => {
    for (const yml of [releaseYml, gateYml]) {
      expect(yml).not.toMatch(/git (push|commit)/);
      expect(yml).not.toContain('run: npm run version:bump');
    }
  });
});
