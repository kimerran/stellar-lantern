import { describe, it, expect, vi, afterEach } from 'vitest';
import { resetDemoScreening, runDemoScan } from '../src/demo/scan';
import hotRead from '../packages/lantern-scanner/fixtures/registry-hot-read.json';
import flagged from '../packages/lantern-scanner/fixtures/classic-payment-to-flagged.json';

// After a report, scanning the same payment again must read the registry
// afresh (#187, the walkthrough's "re-scan shows it flagged"). The page's
// screener caches a not-flagged answer for 60 s, so without a reset a re-scan
// within a minute would still say "Not in the scam registry".

describe('re-scanning after a report', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the registry afresh once the screening is reset', async () => {
    let reported = false; // the registry before and after the report lands
    vi.stubGlobal('fetch', async (_url: string, init?: { body?: string }) => {
      const body = init?.body
        ? (JSON.parse(init.body) as { method?: string; params?: { keys?: string[] } })
        : {};
      if (body.method !== 'getLedgerEntries') return new Response('{}', { status: 503 }); // explainer: fall back
      const entries = reported
        ? hotRead.response.result.entries.filter((e) => body.params!.keys!.includes(e.key))
        : [];
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { entries, latestLedger: hotRead.response.result.latestLedger },
        }),
      );
    });
    resetDemoScreening(); // start from a clean page
    const input = { xdr: flagged.xdr, source: flagged.source };
    const outcome = async () => {
      const out = await runDemoScan(input);
      if (!out.ok) throw new Error(out.error);
      return out.scan.result.screen.answers.map((a) => a.answer.outcome);
    };

    expect(await outcome()).toEqual(['not_flagged']);
    reported = true; // the visitor's report is now on the ledger
    expect(await outcome()).toEqual(['not_flagged']); // cached: the bug scene 5 would hit
    resetDemoScreening(); // what the report panel does on success
    expect(await outcome()).toEqual(['flagged']);
  });
});
