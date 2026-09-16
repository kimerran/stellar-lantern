import { describe, it, expect } from 'vitest';
import manifestSrc from '../manifest.config.ts?raw';
import releaseYml from '../.github/workflows/release.yml?raw';
import androidYml from '../.github/workflows/android.yml?raw';
import testYml from '../.github/workflows/test.yml?raw';

// Build plumbing for telemetry (#81 T-4, #88): the flag, the ingest URL and
// the host permission must agree, and the flag-off proof must run in CI.

const INGEST = 'https://lantern-api-production-3fad.up.railway.app/v1/telemetry';
const ORIGIN = 'https://lantern-api-production-3fad.up.railway.app/*';

describe('telemetry build plumbing', () => {
  it('release and Android builds turn the flag on and point at the same ingest URL', () => {
    for (const [name, yml] of [
      ['release.yml', releaseYml],
      ['android.yml', androidYml],
    ] as const) {
      expect(yml, name).toMatch(/VITE_FEATURE_TELEMETRY:\s*'true'/);
      expect(yml, name).toContain(`VITE_TELEMETRY_INGEST_URL: '${INGEST}'`);
    }
  });

  it('the manifest grants exactly one origin of ours, matching the ingest URL', () => {
    expect(manifestSrc).toContain(`'${ORIGIN}'`);
    const ours = manifestSrc.match(/'https:\/\/[^']*railway\.app\/\*'/g) ?? [];
    expect(ours).toEqual([`'${ORIGIN}'`]);
    expect(INGEST.startsWith(ORIGIN.slice(0, -1))).toBe(true);
    // The header comment no longer claims host access is Horizon + friendbot only.
    expect(manifestSrc).not.toMatch(/limited to the Horizon \+ friendbot endpoints\./);
  });

  it('the PR test lane runs the flag-off dead-code proof', () => {
    expect(testYml).toMatch(/run: npm run verify:flags/);
    expect(releaseYml).toMatch(/run: npm run verify:flags/);
  });
});
