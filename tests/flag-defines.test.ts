import { describe, it, expect } from 'vitest';
import { flagDefines, allFlagDefinesOn } from '../vite.flags';
import { FLAG_DEFS } from '@shared/flag-defs';

const FLAG_COUNT = Object.keys(FLAG_DEFS).length;

describe('flagDefines (Vite define map)', () => {
  it('maps each flag to its __FEATURE__ literal as a JSON boolean, honoring env + defaults', () => {
    const d = flagDefines({ VITE_FEATURE_GEOVELOCITY: 'true', VITE_FEATURE_SWAP: 'false' });
    expect(d.__FEATURE_GEOVELOCITY__).toBe('true'); // env turns a default-off flag on
    expect(d.__FEATURE_SWAP__).toBe('false'); // env turns a default-on flag off
    expect(d.__FEATURE_EARN_BLEND__).toBe('true'); // untouched default (on)
    expect(d.__FEATURE_DEMO_AFFORDANCES__).toBe('false'); // untouched default (off)
    // One literal per flag, plus the ingest-URL pin (telemetry defaults off).
    expect(Object.keys(d)).toHaveLength(FLAG_COUNT + 1);
  });

  it('pins import.meta.env.VITE_TELEMETRY_INGEST_URL to "" only when telemetry is off', () => {
    // Off: the URL must not survive into Vite's inlined import.meta.env object,
    // even if the CI job exports it (release.yml does) — see #96.
    const off = flagDefines({ VITE_FEATURE_TELEMETRY: 'false' });
    expect(off['import.meta.env.VITE_TELEMETRY_INGEST_URL']).toBe('""');
    // On: no pin, so the real env value reaches the bundle.
    const on = flagDefines({ VITE_FEATURE_TELEMETRY: 'true' });
    expect(on['import.meta.env.VITE_TELEMETRY_INGEST_URL']).toBeUndefined();
    expect(Object.keys(on)).toHaveLength(FLAG_COUNT);
  });

  it('allFlagDefinesOn sets every literal to true (used by the test runner)', () => {
    const d = allFlagDefinesOn();
    expect(Object.keys(d)).toHaveLength(FLAG_COUNT);
    expect(Object.values(d).every((v) => v === 'true')).toBe(true);
  });
});
