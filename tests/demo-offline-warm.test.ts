import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resetDemoScreening, runDemoScan } from '../src/demo/scan';
import { EXAMPLES, runExample } from '../src/demo/examples';
import { ScanResultView } from '../src/demo/ScanPanel';
import { ExampleResult } from '../src/demo/Examples';
import safe from '../packages/lantern-scanner/fixtures/classic-payment.json';

// D4 QA F-D4-1 and F-D4-2: a check made online, then the network goes away.
// The page must not answer from a remembered registry read: offline, a paste
// fails closed and an example replays its recording with the notice. Both go
// through the page's real dependency path with `fetch` stubbed.

let offline = false;
function stubNetwork() {
  offline = false;
  vi.stubGlobal('fetch', async (_url: string, init?: { body?: string }) => {
    if (offline) throw new TypeError('Failed to fetch');
    const body = init?.body ? (JSON.parse(init.body) as { method?: string }) : {};
    if (body.method !== 'getLedgerEntries') return new Response('{}', { status: 503 }); // explainer: fall back
    // The registry is up and has never heard of the recipient.
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { entries: [], latestLedger: 5_000_000 } }),
    );
  });
  resetDemoScreening(); // a fresh page
}

describe('warm, then offline', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('F-D4-1: a pasted scan fails closed offline, even right after an online check', async () => {
    stubNetwork();
    const input = { xdr: safe.xdr, source: safe.source };
    const online = await runDemoScan(input);
    if (!online.ok) throw new Error(online.error);
    expect(online.scan.result.screen.answers.map((a) => a.answer.outcome)).toEqual(['not_flagged']);

    offline = true;
    const out = await runDemoScan(input);
    if (!out.ok) throw new Error(out.error);
    expect(out.scan.result.screen.answers.map((a) => a.answer)).toEqual([
      expect.objectContaining({ outcome: 'unknown', reason: 'rpc_error' }),
    ]);
    expect(out.scan.result.risk).not.toBe('low');
    const html = renderToStaticMarkup(createElement(ScanResultView, { scan: out.scan }));
    expect(html).not.toContain('Checked by Lantern');
    expect(html).not.toContain('Not in the scam registry');
    expect(html).toContain('Not checked — unverified');
  });

  it('F-D4-2: an example run offline replays the recording, and says so, even right after an online run', async () => {
    stubNetwork();
    const example = EXAMPLES.find((e) => e.id === 'safe-payment')!;
    const online = await runExample(example);
    if (!online.ok) throw new Error(online.error);
    expect(online.cached).toBeUndefined(); // a live answer

    offline = true;
    const out = await runExample(example);
    if (!out.ok) throw new Error(out.error);
    expect(out.cached).toBeDefined();
    const html = renderToStaticMarkup(createElement(ExampleResult, { outcome: out }));
    expect(html).toContain('Using cached simulation');
    expect(html).not.toContain('Live testnet answer');
  });
});
