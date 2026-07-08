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
    expect(Object.keys(d)).toHaveLength(FLAG_COUNT); // one literal per flag
  });

  it('allFlagDefinesOn sets every literal to true (used by the test runner)', () => {
    const d = allFlagDefinesOn();
    expect(Object.keys(d)).toHaveLength(FLAG_COUNT);
    expect(Object.values(d).every((v) => v === 'true')).toBe(true);
  });
});
