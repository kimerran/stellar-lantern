import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Address, SorobanDataBuilder, xdr } from '@stellar/stellar-sdk';
import { contractInstanceKey, entryLedgerKey, TESTNET_REGISTRY_ID } from '@lantern/scanner';
import {
  explorerTx,
  prepareReport,
  rescreen,
  signAndSubmit,
  type DemoWallet,
  type PreparedReport,
} from '../src/demo/report';
import { ReportPanel, ReportReview, walletNote } from '../src/demo/ReportPanel';
import type { runDemoScan } from '../src/demo/scan';
import hotRead from '../packages/lantern-scanner/fixtures/registry-hot-read.json';
import otherTx from '../packages/lantern-scanner/fixtures/classic-payment.json';

// Reporting from the playground (#187), offline: a fake fetch plays Horizon
// and the Soroban RPC, and a fake wallet records what it is asked to sign.

const REPORTER = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const FLAGGED = hotRead.subjects.flagged; // live Active entry in the recording
const FRESH = hotRead.subjects.clean; // never reported
const XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const FLAGGED_ENTRY = hotRead.response.result.entries[0]!;

function registryInstance(fee: bigint): string {
  const sym = (s: string) => xdr.ScVal.scvSymbol(s);
  const entry = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: sym(k), val: v });
  const i128 = xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString('0'),
      lo: xdr.Uint64.fromString(fee.toString()),
    }),
  );
  const config = xdr.ScVal.scvMap([
    entry('admin', new Address(REPORTER).toScVal()),
    entry('fee', i128),
    entry('fee_token', new Address(XLM_SAC).toScVal()),
    entry('treasury', new Address(REPORTER).toScVal()),
  ]);
  const instance = new xdr.ScContractInstance({
    executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32)),
    storage: [new xdr.ScMapEntry({ key: xdr.ScVal.scvVec([sym('Config')]), val: config })],
  });
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: new Address(TESTNET_REGISTRY_ID).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
      val: xdr.ScVal.scvContractInstance(instance),
    }),
  ).toXDR('base64');
}

/** A testnet in miniature. `reported` holds the subjects with a live entry. */
function network(
  opts: { funded?: boolean; reported?: Set<string>; submit?: 'ok' | 'reject' } = {},
) {
  const reported = opts.reported ?? new Set<string>();
  const log: string[] = [];
  const reply = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const impl = ((url: string, init?: { body?: string }) => {
    if (url.includes('/accounts/')) {
      log.push('horizon:account');
      return opts.funded === false ? reply({}, 404) : reply({ sequence: '4200' });
    }
    if (url.endsWith('/transactions')) {
      log.push('horizon:submit');
      if (opts.submit === 'reject') {
        return reply({ extras: { result_codes: { transaction: 'tx_insufficient_balance' } } }, 400);
      }
      reported.add(FRESH); // the report landed
      return reply({ hash: 'ab'.repeat(32) });
    }
    const body = JSON.parse(init!.body!) as { method: string; params: { keys: string[] } };
    log.push(`rpc:${body.method}`);
    if (body.method === 'simulateTransaction') {
      return reply({
        jsonrpc: '2.0',
        id: 1,
        result: {
          transactionData: new SorobanDataBuilder().build().toXDR('base64'),
          minResourceFee: '100',
        },
      });
    }
    const entries = body.params.keys.flatMap((k) => {
      if (k === contractInstanceKey(TESTNET_REGISTRY_ID))
        return [{ key: k, xdr: registryInstance(10_000_000n) }];
      for (const s of reported) {
        if (k === entryLedgerKey(TESTNET_REGISTRY_ID, s)) {
          return [{ ...FLAGGED_ENTRY, key: k }];
        }
      }
      return [];
    });
    return reply({ jsonrpc: '2.0', id: 1, result: { entries, latestLedger: 4679650 } });
  }) as unknown as typeof fetch;
  return { impl, log, reported };
}

/** Records every XDR the scanner saw, then answers with a fixed verdict. */
function recordingScan(action: 'allow' | 'warn' | 'block_confirm' = 'warn') {
  const scanned: string[] = [];
  const scan = (async ({ xdr: tx }: { xdr: string }) => {
    scanned.push(tx);
    return {
      ok: true,
      scan: {
        result: {
          risk: action === 'block_confirm' ? 'high' : action === 'warn' ? 'medium' : 'low',
          action,
          reasons: [],
          explanation: 'This calls report on the Lantern registry.',
          screen: {
            answers: [],
            unknown: [],
            hits: [],
            checked: [],
            outcome: 'clean',
            latencyMs: 1,
          },
          effects: { net: [], approvals: [] },
        },
        summarySource: 'fallback',
        ms: 5,
      },
    };
  }) as unknown as typeof runDemoScan;
  return { scan, scanned };
}

function wallet() {
  const signed: string[] = [];
  const w: DemoWallet = {
    productId: 'albedo',
    productName: 'Albedo',
    isAvailable: async () => true,
    getAddress: async () => ({ address: REPORTER }),
    signTransaction: async (tx) => {
      signed.push(tx);
      return { signedTxXdr: tx };
    },
  };
  return { w, signed };
}

describe('prepareReport: the guards run before anything touches the network', () => {
  it.each([
    ['a self-report', { subject: REPORTER, reason: 'Scam' as const }, /your own address/i],
    [
      'an invalid subject',
      { subject: 'GABC', reason: 'Scam' as const },
      /not a valid Stellar address/i,
    ],
    ['no reason chosen', { subject: FRESH, reason: null }, /Choose a reason/],
  ])('blocks %s', async (_label, p, message) => {
    const net = network();
    const { scan, scanned } = recordingScan();
    const out = await prepareReport({ reporter: REPORTER, ...p }, { fetchImpl: net.impl, scan });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(message) });
    expect(net.log).toEqual([]);
    expect(scanned).toEqual([]);
  });

  it('an unfunded wallet is told to use Friendbot, and nothing is scanned or signed', async () => {
    const net = network({ funded: false });
    const { scan, scanned } = recordingScan();
    const out = await prepareReport(
      { reporter: REPORTER, subject: FRESH, reason: 'Scam' },
      { fetchImpl: net.impl, scan },
    );
    expect(out).toMatchObject({
      ok: false,
      unfunded: true,
      error: expect.stringMatching(/Friendbot/),
    });
    expect(scanned).toEqual([]);
  });
});

describe('the scan gate: Lantern scans the report before any wallet sees it', () => {
  it('scans the exact XDR the wallet is then asked to sign, and only after the scan', async () => {
    const net = network();
    const { scan, scanned } = recordingScan();
    const { w, signed } = wallet();
    const out = await prepareReport(
      { reporter: REPORTER, subject: FRESH, reason: 'Phishing' },
      { fetchImpl: net.impl, scan },
    );
    if (!out.ok) throw new Error(out.error);
    expect(scanned).toEqual([out.report.xdr]);
    expect(signed).toEqual([]); // preparing never signs
    const sent = await signAndSubmit(w, out.report, REPORTER, { fetchImpl: net.impl });
    expect(sent).toEqual({ ok: true, hash: 'ab'.repeat(32) });
    expect(signed).toEqual([out.report.xdr]);
    // Order on the wire: fee + subject reads, build (account, simulate), then
    // submit, and the only submit comes after the scan above.
    expect(net.log.at(-1)).toBe('horizon:submit');
    expect(net.log.filter((l) => l === 'horizon:submit')).toHaveLength(1);
  });

  it('reads the fee from the registry, and the subject’s existing entry', async () => {
    const net = network({ reported: new Set([FLAGGED]) });
    const { scan } = recordingScan();
    const out = await prepareReport(
      { reporter: REPORTER, subject: FLAGGED, reason: 'Scam' },
      { fetchImpl: net.impl, scan },
    );
    if (!out.ok) throw new Error(out.error);
    expect(out.report.fee).toBe('10000000 base units of CDLZ…CYSC'); // token metadata unreadable here: never a guessed amount
    expect(out.report.existing.entry?.reports).toBeGreaterThan(0);
  });

  it('refuses to submit a signed envelope that isn’t the transaction Lantern scanned', async () => {
    const net = network();
    const { scan, scanned } = recordingScan();
    const out = await prepareReport(
      { reporter: REPORTER, subject: FRESH, reason: 'Scam' },
      { fetchImpl: net.impl, scan },
    );
    if (!out.ok) throw new Error(out.error);
    const swapping = (signedTxXdr: string): DemoWallet => ({
      ...wallet().w,
      signTransaction: async () => ({ signedTxXdr }),
    });
    const refused = {
      ok: false,
      error:
        'Albedo returned a different transaction from the one Lantern checked. Nothing was sent.',
    };
    // A different, valid transaction (a scanner fixture), and one that
    // doesn't decode at all.
    for (const returned of [otherTx.xdr, 'not an envelope']) {
      expect(
        await signAndSubmit(swapping(returned), out.report, REPORTER, { fetchImpl: net.impl }),
      ).toEqual(refused);
    }
    expect(scanned).toEqual([out.report.xdr]);
    expect(net.log).not.toContain('horizon:submit');
  });

  it('a wallet that declines, or a network rejection, is a sentence and records nothing', async () => {
    const { scan } = recordingScan();
    const prepared = await prepareReport(
      { reporter: REPORTER, subject: FRESH, reason: 'Scam' },
      { fetchImpl: network().impl, scan },
    );
    if (!prepared.ok) throw new Error(prepared.error);
    const declining: DemoWallet = {
      ...wallet().w,
      signTransaction: async () => {
        throw new Error('User declined');
      },
    };
    expect(
      await signAndSubmit(declining, prepared.report, REPORTER, { fetchImpl: network().impl }),
    ).toEqual({
      ok: false,
      error: 'Albedo didn’t sign the report. Nothing was sent.',
    });
    const rejected = await signAndSubmit(wallet().w, prepared.report, REPORTER, {
      fetchImpl: network({ submit: 'reject' }).impl,
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: expect.stringContaining('tx_insufficient_balance'),
    });
  });
});

describe('closing the loop', () => {
  it('re-screening after the report reads flagged, with no page reload', async () => {
    const net = network();
    expect((await rescreen(FRESH, { fetchImpl: net.impl })).outcome).toBe('not_flagged');
    const { scan } = recordingScan();
    const out = await prepareReport(
      { reporter: REPORTER, subject: FRESH, reason: 'Scam' },
      { fetchImpl: net.impl, scan },
    );
    if (!out.ok) throw new Error(out.error);
    await signAndSubmit(wallet().w, out.report, REPORTER, { fetchImpl: net.impl });
    expect((await rescreen(FRESH, { fetchImpl: net.impl })).outcome).toBe('flagged');
    expect(explorerTx('ab'.repeat(32))).toBe(
      `https://stellar.expert/explorer/testnet/tx/${'ab'.repeat(32)}`,
    );
  });
});

describe('the confirmation sheet', () => {
  const report = (
    over: Partial<PreparedReport> = {},
    action: 'warn' | 'block_confirm' = 'warn',
  ): PreparedReport => ({
    xdr: 'AAAA',
    fee: '1 XLM',
    existing: { outcome: 'not_flagged', source: 'registry' },
    scan: {
      result: {
        risk: action === 'block_confirm' ? 'high' : 'medium',
        action,
        reasons: [],
        explanation: 'This calls report on the Lantern registry.',
        screen: { answers: [], unknown: [], hits: [], checked: [], outcome: 'clean', latencyMs: 1 },
        effects: { net: [], approvals: [] },
      },
      summarySource: 'fallback',
      ms: 5,
    } as unknown as PreparedReport['scan'],
    ...over,
  });
  const render = (r: PreparedReport, acknowledged = false) =>
    renderToStaticMarkup(
      createElement(ReportReview, {
        report: r,
        subject: FRESH,
        reason: 'Scam',
        wallet: 'Albedo',
        acknowledged,
        onAcknowledge: () => {},
      }),
    );

  it('shows the full address, the reason, the fee, and that it is public and permanent', () => {
    const html = render(report());
    expect(html).toContain(FRESH);
    expect(html).toContain('Scam');
    expect(html).toContain('1 XLM');
    expect(html).toContain('public and permanent');
    expect(html).toContain('Lantern’s scan of this report transaction');
    expect(html).toContain('data-testid="scan-result"');
    expect(html).not.toContain('already in the registry');
  });

  it('warns that a repeat report still charges the fee', () => {
    const html = render(
      report({
        existing: {
          outcome: 'flagged',
          source: 'registry',
          entry: { reports: 4, status: 'Active' } as unknown as NonNullable<
            PreparedReport['existing']['entry']
          >,
        },
      }),
    );
    expect(html).toContain('already in the registry (4 reports, Active)');
    expect(html).toContain('still charges the fee');
  });

  it('a high-risk scan of the report needs an explicit acknowledgement', () => {
    expect(render(report({}, 'block_confirm'))).toContain('type="checkbox"');
    expect(render(report({}, 'warn'))).not.toContain('type="checkbox"');
  });

  it('pre-selects no reason', () => {
    const html = renderToStaticMarkup(createElement(ReportPanel));
    expect(html).toMatch(/<option value="" selected="">Choose a reason…<\/option>/);
    expect(html).not.toMatch(/<option value="Scam" selected/);
  });
});

describe('the wallet list', () => {
  it('says what each wallet needs, and never claims a missing extension was detected', () => {
    expect(walletNote('albedo', true)).toBe('Web wallet, nothing to install');
    // xBull's module is always available: it falls back to its web wallet.
    expect(walletNote('xbull', true)).toBe('Extension, or its web wallet in a new window');
    expect(walletNote('freighter', true)).toBe('Extension detected');
    expect(walletNote('freighter', false)).toBe('Not installed in this browser');
    expect(walletNote('lobstr', false)).toBe('Not installed in this browser');
  });
});
