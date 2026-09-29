import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { createRegistryScreener, TESTNET_REGISTRY_ID, type PipelineDeps, type ScreenAnswer } from '@lantern/scanner';
import { composePayment, preparePasted, runDemoScan, screeningRows, DEMO_NETWORK } from '../src/demo/scan';
import { ScanResultView } from '../src/demo/ScanPanel';
import flagged from '../packages/lantern-scanner/fixtures/classic-payment-to-flagged.json';
import clean from '../packages/lantern-scanner/fixtures/classic-payment.json';

// The D4 playground's scan path (#184). Nothing here touches the network:
// the registry and Horizon are stubs, and the XDR comes from the scanner's
// recorded fixtures.

const FLAGGED = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

const registry =
  (answer: (address: string) => ScreenAnswer): PipelineDeps['screen'] =>
  async (address) =>
    answer(address);

const liveLike: PipelineDeps = {
  screen: registry((a) =>
    a === FLAGGED
      ? {
          outcome: 'flagged',
          source: 'registry',
          entry: {
            reporter: 'GB',
            reason: 'Scam',
            status: 'Active',
            evidence: '00',
            reportedAt: 0,
            updatedAt: 0,
            reports: 3,
            index: 0,
          } as unknown as NonNullable<ScreenAnswer['entry']>,
        }
      : { outcome: 'not_flagged', source: 'registry' },
  ),
};

const unreachable: PipelineDeps = {
  screen: createRegistryScreener({
    rpcUrl: 'https://rpc.invalid',
    contractId: TESTNET_REGISTRY_ID,
    timeoutMs: 500,
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  }),
};

describe('preparePasted', () => {
  it('accepts a testnet envelope and reads its source', () => {
    const p = preparePasted(`  ${flagged.xdr.slice(0, 40)}\n${flagged.xdr.slice(40)}  `);
    expect(p).toEqual({ ok: true, xdr: flagged.xdr, source: flagged.source });
  });

  it.each([
    ['', 'Paste a transaction first.'],
    ['hello world!', 'That isn’t a transaction'],
    ['AAAAAgAAAAA=', 'couldn’t be read as a Stellar transaction'],
  ])('turns %j into a sentence, not a stack trace', (text, message) => {
    const p = preparePasted(text);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.error).toContain(message);
      expect(p.error).not.toMatch(/Error|at \w+ \(|undefined/);
    }
  });
});

describe('composePayment', () => {
  const from = Keypair.random().publicKey();

  it('builds an unsigned payment from Horizon’s sequence, never asking for a key', async () => {
    const c = await composePayment({ from, to: FLAGGED, amount: '12.5' }, async (a) =>
      a === from ? { sequence: '100' } : 'missing',
    );
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.destinationFunded).toBe(false);
    const tx = TransactionBuilder.fromXDR(c.xdr, DEMO_NETWORK.passphrase);
    if (!(tx instanceof Transaction)) throw new Error('expected a plain transaction');
    expect(tx.signatures).toHaveLength(0);
    expect(tx.source).toBe(from);
    expect(tx.sequence).toBe('101');
    expect(tx.operations[0]).toMatchObject({ type: 'payment', destination: FLAGGED, amount: '12.5000000' });
  });

  it('says so when the source account is not on testnet', async () => {
    const c = await composePayment({ from, to: FLAGGED, amount: '1' }, async () => 'missing');
    expect(c).toMatchObject({ ok: false, missingSource: true });
  });

  it('rejects bad fields before any lookup', async () => {
    const never = async () => {
      throw new Error('looked up');
    };
    for (const f of [
      { from: 'GNOPE', to: FLAGGED, amount: '1' },
      { from, to: 'nope', amount: '1' },
      { from, to: from, amount: '1' },
      { from, to: FLAGGED, amount: '0' },
      { from, to: FLAGGED, amount: '1.12345678' },
    ]) {
      expect((await composePayment(f, never)).ok).toBe(false);
    }
  });

  it('turns an amount beyond int64 into a sentence instead of throwing', async () => {
    const c = await composePayment({ from, to: FLAGGED, amount: '99999999999999' }, async () => ({
      sequence: '100',
    }));
    expect(c).toMatchObject({ ok: false });
    if (!c.ok) {
      expect(c.error).toBe('That amount is too large for a Stellar payment.');
      expect(c.error).not.toMatch(/Error|at \w+ \(|undefined/);
    }
  });

  it('fails with a reason when Horizon is down', async () => {
    const c = await composePayment({ from, to: FLAGGED, amount: '1' }, async () => {
      throw new Error('503');
    });
    expect(c).toMatchObject({ ok: false });
    if (!c.ok) expect(c.error).toContain('couldn’t be reached');
  });
});

describe('runDemoScan', () => {
  it('a payment to the seeded scam address screens flagged / high', async () => {
    const out = await runDemoScan({ xdr: flagged.xdr, source: flagged.source }, liveLike);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.scan.result.risk).toBe('high');
    expect(screeningRows(out.scan.result.screen.answers)).toContainEqual(
      expect.objectContaining({ address: FLAGGED, tone: 'flagged' }),
    );
    expect(out.scan.result.explanation.length).toBeGreaterThan(0);
  });

  it('an unreachable registry fails closed: never low, never shown as clean, reason visible', async () => {
    const out = await runDemoScan({ xdr: clean.xdr, source: clean.source }, unreachable);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.scan.result.risk).not.toBe('low');
    const rows = screeningRows(out.scan.result.screen.answers);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.tone).toBe('unknown');
      expect(r.detail).toMatch(/Couldn’t check: the registry/);
    }
    const html = renderToStaticMarkup(createElement(ScanResultView, { scan: out.scan }));
    expect(html).toContain('data-tone="unknown"');
    expect(html).not.toContain('data-tone="clear"');
    expect(html).not.toContain('Not in the scam registry');
    expect(html).not.toContain('Checked by Lantern');
  });

  it('with the explainer unreachable, the rules-based sentence is labelled and the risk is unchanged', async () => {
    const input = { xdr: flagged.xdr, source: flagged.source };
    const withAi = await runDemoScan(input, { ...liveLike, explain: async () => 'An AI sentence.' });
    const down = await runDemoScan(input, {
      ...liveLike,
      explain: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const none = await runDemoScan(input, liveLike);
    if (!withAi.ok || !down.ok || !none.ok) throw new Error('scan failed');
    expect(withAi.scan.summarySource).toBe('explainer');
    expect(withAi.scan.result.explanation).toBe('An AI sentence.');
    expect(down.scan.summarySource).toBe('fallback');
    expect(none.scan.summarySource).toBe('fallback');
    expect(down.scan.result.risk).toBe(withAi.scan.result.risk);
    expect(down.scan.result.action).toBe(withAi.scan.result.action);
    const html = renderToStaticMarkup(createElement(ScanResultView, { scan: down.scan }));
    expect(html).toContain('rules-based (no AI)');
  });
});

describe('screeningRows', () => {
  it.each(['timeout', 'rpc_error', 'malformed', 'archived', 'no_registry', 'something new', undefined])(
    'unknown (%s) is its own tone, never clear',
    (reason) => {
      const [row] = screeningRows([
        { address: FLAGGED, answer: { outcome: 'unknown', source: 'registry', ...(reason ? { reason } : {}) } },
      ]);
      expect(row?.tone).toBe('unknown');
      expect(row?.label).toBe('Not checked — unverified');
    },
  );
});
