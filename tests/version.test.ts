import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import manifest from '../manifest.config';
import { APP_VERSION } from '@shared/version';
import { assetNames, versionCode } from '../scripts/release-assets.mjs';
import buildGradle from '../android/app/build.gradle?raw';

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
