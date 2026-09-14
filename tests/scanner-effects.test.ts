import { describe, it, expect } from 'vitest';
import {
  auth,
  effects,
  ingest,
  runPipeline,
  toStroops,
  fromStroops,
  addAmounts,
  type AssetDelta,
  type RawSimulation,
  type ScanRequest,
} from '@lantern/scanner';

// Stage 3a — Effects from classic operations (#54). Offline: every XDR comes
// from packages/lantern-scanner/fixtures/ (classic-* built by make-classic.mjs).

interface Fixture {
  name: string;
  networkPassphrase: string;
  source: string;
  xdr: string;
  simulation: RawSimulation | null;
}
const ON_DISK = import.meta.glob<Fixture>('../packages/lantern-scanner/fixtures/*.json', {
  eager: true,
  import: 'default',
});
function fixture(name: string): Fixture {
  const f = Object.entries(ON_DISK).find(([p]) => p.endsWith(`/${name}.json`))?.[1];
  if (!f) throw new Error(`no fixture ${name}`);
  return f;
}
function requestFor(f: Fixture): ScanRequest {
  return {
    xdr: f.xdr,
    networkPassphrase: f.networkPassphrase,
    context: { network: 'TESTNET', fromAddress: f.source, destinationFunded: true },
  };
}
async function effectsFor(name: string) {
  const f = fixture(name);
  const request = requestFor(f);
  const sim = await ingest(request, f.simulation ? { simulate: async () => f.simulation! } : {});
  return effects(sim, auth(sim), request);
}
const row = (d: AssetDelta) =>
  `${d.direction} ${d.address.slice(0, 4)} ${d.asset.code}${d.asset.issuer ? ':' + d.asset.issuer.slice(0, 4) : ''} ${d.amount ?? '∅'} ${d.bound} #${d.opIndex}`;

const SOURCE = 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK';
const DEST = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const OTHER = 'GBVG3DQJNAYAPTB4FKPLL65BUNF76K2TKPTK72LDIAJKRATGRY5BFJBP';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// ── Exact decimal arithmetic ─────────────────────────────────────────────────
describe('decimal', () => {
  it('round-trips classic amounts through stroops without floats', () => {
    expect(toStroops('25')).toBe(250_000_000n);
    expect(toStroops('25.0000000')).toBe(250_000_000n);
    expect(toStroops('0.0000001')).toBe(1n);
    expect(toStroops('-1.5')).toBe(-15_000_000n);
    expect(fromStroops(250_000_000n)).toBe('25.0000000');
    expect(fromStroops(1n)).toBe('0.0000001');
    expect(fromStroops(-15_000_000n)).toBe('-1.5000000');
    // The classic float trap.
    expect(addAmounts('0.1', '0.2')).toBe('0.3000000');
    // Beyond Number.MAX_SAFE_INTEGER stroops (≈ 900 million XLM).
    expect(addAmounts('922337203685.4775807', '0.0000001')).toBe('922337203685.4775808');
  });

  it('rejects anything that is not a plain decimal', () => {
    for (const bad of ['1e5', '1.12345678', 'abc', '', '1,5']) {
      expect(() => toStroops(bad)).toThrow();
    }
  });
});

// ── Per-op deltas ────────────────────────────────────────────────────────────
describe('effects: classic deltas', () => {
  it('payment: exact out for the source, exact in for the destination, with issuer', async () => {
    const set = await effectsFor('classic-payment');
    expect(set.deltas.map(row)).toEqual([
      `out GAMN XLM 25.0000000 exact #0`,
      `in GDVE XLM 25.0000000 exact #0`,
    ]);
    expect(set.deltas[0]?.asset).toEqual({ code: 'XLM' });
    expect(set.deltas.every((d) => d.source === 'classic')).toBe(true);
    expect(set.closes).toEqual([]);
    expect(set.coverage).toBe('full');
  });

  it('pathPaymentStrictSend: exact send, at-least receive, both assets', async () => {
    const set = await effectsFor('path-payment');
    expect(set.deltas.map(row)).toEqual([
      `out GAMN XLM 10.0000000 exact #0`,
      `in GAMN USDC:GBBD 9.0000000 min #0`,
    ]);
    expect(set.deltas[1]?.asset).toEqual({ code: 'USDC', issuer: USDC_ISSUER });
  });

  it('pathPaymentStrictReceive: up-to send, exact receive — strict-send and strict-receive differ', async () => {
    const set = await effectsFor('classic-path-payment-receive');
    expect(set.deltas.map(row)).toEqual([
      `out GAMN XLM 10.0000000 max #0`,
      `in GDVE USDC:GBBD 9.0000000 exact #0`,
    ]);
    const send = (await effectsFor('path-payment')).deltas[0]!;
    const receive = set.deltas[0]!;
    expect(send.bound).toBe('exact');
    expect(receive.bound).toBe('max');
  });

  it('accountMerge: total outflow and account closure, never an amount of zero', async () => {
    const set = await effectsFor('classic-account-merge');
    expect(set.deltas.map(row)).toEqual([`out GAMN XLM ∅ total #0`, `in GDVE XLM ∅ total #0`]);
    expect(set.deltas[0]?.amount).toBeNull();
    expect(set.closes).toEqual([{ address: SOURCE, destination: DEST, opIndex: 0 }]);
    const net = set.net.find((n) => n.address === SOURCE)!;
    expect(net.outIsTotal).toBe(true);
    expect(net.out).toBe('0.0000000');
  });
});

// ── Aggregation ──────────────────────────────────────────────────────────────
describe('effects: aggregation per address', () => {
  it('a three-operation transaction nets per address and asset, honouring op-level sources', async () => {
    const set = await effectsFor('classic-multi-op');
    expect(set.deltas).toHaveLength(6);
    // The third op acts for OTHER, not the tx source.
    expect(set.deltas[4]).toMatchObject({ address: OTHER, direction: 'out', amount: '0.5000000' });
    const key = (n: { address: string; asset: { code: string } }) =>
      `${n.address.slice(0, 4)} ${n.asset.code}`;
    const byKey = Object.fromEntries(set.net.map((n) => [key(n), n]));
    expect(Object.keys(byKey).sort()).toEqual([
      'GAMN USDC',
      'GAMN XLM',
      'GBVG XLM',
      'GDVE USDC',
      'GDVE XLM',
    ]);
    expect(byKey['GAMN XLM']).toMatchObject({
      in: '0.5000000',
      out: '25.0000000',
      outIsTotal: false,
    });
    expect(byKey['GAMN USDC']).toMatchObject({ in: '0.0000000', out: '1.5000000' });
    expect(byKey['GDVE XLM']).toMatchObject({ in: '25.0000000', out: '0.0000000' });
    expect(byKey['GDVE USDC']).toMatchObject({ in: '1.5000000' });
    expect(byKey['GBVG XLM']).toMatchObject({ in: '0.0000000', out: '0.5000000' });
    // The headline `primary*` fields still only see the first op; the net does not.
    expect(set.source?.primaryAmount).toBe('25.0000000');
  });

  it('bounds propagate into the aggregate', async () => {
    const send = await effectsFor('path-payment');
    expect(send.net.find((n) => n.address === SOURCE && n.asset.code === 'USDC')).toMatchObject({
      in: '9.0000000',
      inAtLeast: true,
    });
    const receive = await effectsFor('classic-path-payment-receive');
    expect(receive.net.find((n) => n.address === SOURCE && n.asset.code === 'XLM')).toMatchObject({
      out: '10.0000000',
      outUpTo: true,
    });
  });

  it('every amount in the effect path is a canonical 7-decimal string', async () => {
    for (const name of [
      'classic-payment',
      'path-payment',
      'classic-path-payment-receive',
      'classic-multi-op',
    ]) {
      const set = await effectsFor(name);
      for (const d of set.deltas) if (d.amount !== null) expect(d.amount).toMatch(/^-?\d+\.\d{7}$/);
      for (const n of set.net) {
        expect(n.in).toMatch(/^\d+\.\d{7}$/);
        expect(n.out).toMatch(/^\d+\.\d{7}$/);
      }
    }
  });
});

// ── Contracts touched + the pipeline result ──────────────────────────────────
describe('effects: contracts and result', () => {
  it('lists every contract from the op and the auth tree once', async () => {
    const set = await effectsFor('deep-auth');
    expect(set.contractsTouched).toEqual([
      'CC4KSBTTPCKZUYBXB47SSZGXTKO6G23Y6LJOIR6YCOJVTGJZEYJCHBOH',
      'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU',
    ]);
    expect(set.deltas).toEqual([]);
    expect(set.approvals).toEqual([]);
  });

  it('ScanResult carries the frozen net-effect object', async () => {
    const f = fixture('classic-multi-op');
    const result = await runPipeline(requestFor(f));
    expect(Object.isFrozen(result.effects.net)).toBe(true);
    expect(result.effects.net).toHaveLength(5);
    expect(result.risk).toBe('low');
  });
});
