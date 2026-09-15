import { describe, it, expect } from 'vitest';
import { hostedExplainer } from '@core/scan/ai';

// The wallet-side composition for the scanner's hosted explainer (#59).
// Flags are all ON under test, so the flag branch is exercised here; the
// OFF branch is what `npm run verify:flags`-style builds dead-code-eliminate.

describe('hostedExplainer', () => {
  it('is wired to the scannerAi flag (ON under test)', () => {
    expect(__FEATURE_SCANNER_AI__).toBe(true);
  });

  it('returns nothing without a key or a proxy endpoint', () => {
    expect(hostedExplainer({})).toBeUndefined();
    expect(hostedExplainer({ model: 'x' })).toBeUndefined();
  });

  it('returns an Explainer when the host supplies a key, or a proxy endpoint', () => {
    expect(typeof hostedExplainer({ apiKey: 'k' })).toBe('function');
    expect(typeof hostedExplainer({ endpoint: 'https://proxy.invalid/v1/messages' })).toBe(
      'function',
    );
  });
});
