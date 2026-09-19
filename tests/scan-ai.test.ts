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
    expect(typeof hostedExplainer({ endpoint: 'https://proxy.invalid/v1/explain' })).toBe(
      'function',
    );
  });

  it('an endpoint without a key is proxy mode: the request carries no key and posts the ExplainInput', async () => {
    let sent: { headers: Record<string, string>; body: Record<string, unknown> } | undefined;
    const fetchImpl: typeof fetch = async (_u, init) => {
      sent = {
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)),
      };
      return new Response(JSON.stringify({ explanation: 'ok' }), { status: 200 });
    };
    const explainer = hostedExplainer({ endpoint: 'https://proxy.invalid/v1/explain', fetchImpl })!;
    const verdict = {
      risk: 'low',
      action: 'allow',
      reasons: [],
      signals: [],
      scope: 'effects shown, terms not judged',
    } as const;
    const effects = {
      source: null,
      effects: [],
      deltas: [],
      net: [],
      closes: [],
      contractsTouched: [],
      approvals: [],
      unverified: [],
      observed: [],
      observedNet: [],
      coverage: 'full',
    } as const;
    expect(await explainer({ verdict, effects })).toBe('ok');
    expect(sent?.headers['x-api-key']).toBeUndefined();
    expect(Object.keys(sent?.body ?? {}).sort()).toEqual(['effects', 'verdict']);
  });
});
