import { describe, it, expect } from 'vitest';
import { StrKey, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import {
  estimateSupplyApy,
  supplyApyFromReserve,
  readReserveApys,
  SCALAR_7,
  type ReserveApyInputs,
} from '@core/blend/apr';

const POOL = StrKey.encodeContract(Buffer.alloc(32, 7));
const USDC = StrKey.encodeContract(Buffer.alloc(32, 9));
const XLM = StrKey.encodeContract(Buffer.alloc(32, 5));

const SCALAR_12 = 10n ** 12n;

// A reserve at 1:1 rates (b_rate = d_rate = 1.0) so utilization is just d_supply /
// b_supply. Blend testnet-ish rate curve: r_base 1%, r_one 5%, r_two 50%, r_three
// 100%, target utilization 80%, ir_mod = 1.0.
function baseInputs(overrides: Partial<ReserveApyInputs> = {}): ReserveApyInputs {
  return {
    rBase: 0.01 * SCALAR_7,
    rOne: 0.05 * SCALAR_7,
    rTwo: 0.5 * SCALAR_7,
    rThree: 1.0 * SCALAR_7,
    targetUtil: 0.8 * SCALAR_7,
    irMod: SCALAR_7, // 1.0
    bRate: SCALAR_12,
    dRate: SCALAR_12,
    bSupply: 1_000_000n,
    dSupply: 500_000n, // 50% utilization
    ...overrides,
  };
}

describe('estimateSupplyApy', () => {
  it('returns 0 when nothing is supplied (no lending, no yield)', () => {
    expect(estimateSupplyApy(baseInputs({ bSupply: 0n }))).toBe(0);
  });

  it('returns 0 at zero utilization (no borrows)', () => {
    expect(estimateSupplyApy(baseInputs({ dSupply: 0n }))).toBe(0);
  });

  it('computes the supply APY on the first slope (below target utilization)', () => {
    // U = 0.5, target 0.8 → borrow APR = (0.5/0.8)*0.05 + 0.01 = 0.04125
    // supply APR = 0.04125 * 0.5 = 0.020625 ; APY = (1 + r/52)^52 - 1
    const apy = estimateSupplyApy(baseInputs())!;
    const borrowApr = (0.5 / 0.8) * 0.05 + 0.01;
    const supplyApr = borrowApr * 0.5;
    const expected = (1 + supplyApr / 52) ** 52 - 1;
    expect(apy).toBeCloseTo(expected, 10);
    // Sanity: a small-but-positive APY, and APY > APR (compounding).
    expect(apy).toBeGreaterThan(supplyApr);
    expect(apy).toBeGreaterThan(0.02);
    expect(apy).toBeLessThan(0.025);
  });

  it('uses the steep second slope above target utilization', () => {
    // U = 0.9 (between 0.8 target and 0.95): borrow APR jumps via r_two.
    const apy = estimateSupplyApy(baseInputs({ dSupply: 900_000n }))!;
    const s = (0.9 - 0.8) / (0.95 - 0.8);
    const borrowApr = s * 0.5 + 0.05 + 0.01;
    const supplyApr = borrowApr * 0.9;
    const expected = (1 + supplyApr / 52) ** 52 - 1;
    expect(apy).toBeCloseTo(expected, 10);
  });

  it('applies the third slope past 95% utilization', () => {
    // U = 0.98: extra rate off r_three on top of the intersection.
    const apy = estimateSupplyApy(baseInputs({ dSupply: 980_000n }))!;
    const s = (0.98 - 0.95) / (1 - 0.95);
    const borrowApr = s * 1.0 + 1.0 * (0.5 + 0.05 + 0.01);
    const supplyApr = borrowApr * 0.98;
    const expected = (1 + supplyApr / 52) ** 52 - 1;
    expect(apy).toBeCloseTo(expected, 10);
  });

  it('scales the borrow rate by the interest-rate modifier', () => {
    const plain = estimateSupplyApy(baseInputs())!;
    const boosted = estimateSupplyApy(baseInputs({ irMod: 2 * SCALAR_7 }))!;
    expect(boosted).toBeGreaterThan(plain);
  });

  it('reduces the supply APY by the backstop take rate', () => {
    const gross = estimateSupplyApy(baseInputs())!;
    const net = estimateSupplyApy(baseInputs({ backstopTakeRate: 0.2 * SCALAR_7 }))!;
    expect(net).toBeLessThan(gross);
    expect(net).toBeGreaterThan(0);
  });

  it('accounts for the accrued b_rate/d_rate in utilization', () => {
    // Equal token supplies but d_rate > b_rate → utilization > 1 raw, clamped to 1.
    const apy = estimateSupplyApy(
      baseInputs({ bSupply: 1_000_000n, dSupply: 1_000_000n, dRate: 2n * SCALAR_12 }),
    )!;
    expect(apy).toBeGreaterThan(0);
  });
});

// ── get_reserve fixture → estimate ──
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });
const u32 = (n: number) => xdr.ScVal.scvU32(n);

function reserveScVal(): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: sym('config'),
      val: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: sym('r_base'), val: u32(0.01 * SCALAR_7) }),
        new xdr.ScMapEntry({ key: sym('r_one'), val: u32(0.05 * SCALAR_7) }),
        new xdr.ScMapEntry({ key: sym('r_three'), val: u32(1.0 * SCALAR_7) }),
        new xdr.ScMapEntry({ key: sym('r_two'), val: u32(0.5 * SCALAR_7) }),
        new xdr.ScMapEntry({ key: sym('util'), val: u32(0.8 * SCALAR_7) }),
      ]),
    }),
    new xdr.ScMapEntry({
      key: sym('data'),
      val: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: sym('b_rate'), val: i128(SCALAR_12) }),
        new xdr.ScMapEntry({ key: sym('b_supply'), val: i128(1_000_000n) }),
        new xdr.ScMapEntry({ key: sym('d_rate'), val: i128(SCALAR_12) }),
        new xdr.ScMapEntry({ key: sym('d_supply'), val: i128(500_000n) }),
        new xdr.ScMapEntry({ key: sym('ir_mod'), val: i128(BigInt(SCALAR_7)) }),
      ]),
    }),
  ]);
}

function rpcQueue(items: Array<xdr.ScVal | 'http-fail'>) {
  let i = 0;
  return (() => {
    const item = items[i++];
    if (item === 'http-fail') return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ jsonrpc: '2.0', id: 1, result: { results: [{ xdr: item!.toXDR('base64') }] } }),
    });
  }) as unknown as typeof fetch;
}

const opts = (impl: typeof fetch) => ({ rpcUrl: 'https://rpc.example.com', fetchImpl: impl });
const reserves = [
  { code: 'USDC', assetId: USDC },
  { code: 'XLM', assetId: XLM },
];

describe('supplyApyFromReserve', () => {
  it('matches the pure estimate for a decoded reserve fixture', () => {
    const decoded = scValToNative(reserveScVal());
    const apy = supplyApyFromReserve(decoded);
    expect(apy).toBeCloseTo(estimateSupplyApy(baseInputs())!, 10);
  });

  it('fails soft (null) when rate fields are missing or reserve is absent', () => {
    expect(supplyApyFromReserve(null)).toBeNull();
    expect(supplyApyFromReserve({ config: {}, data: {} })).toBeNull();
  });
});

describe('readReserveApys', () => {
  it('returns an est. APY per reserve code', async () => {
    const impl = rpcQueue([reserveScVal(), reserveScVal()]);
    const out = await readReserveApys(POOL, reserves, opts(impl));
    expect(out).not.toBeNull();
    expect(out!.USDC).toBeCloseTo(estimateSupplyApy(baseInputs())!, 10);
    expect(out!.XLM).toBeCloseTo(estimateSupplyApy(baseInputs())!, 10);
  });

  it('fails soft: a per-reserve RPC error maps that code to null', async () => {
    const impl = rpcQueue(['http-fail', reserveScVal()]);
    const out = await readReserveApys(POOL, reserves, opts(impl));
    expect(out!.USDC).toBeNull();
    expect(out!.XLM).toBeCloseTo(estimateSupplyApy(baseInputs())!, 10);
  });

  it('returns null when no reserve can be read at all', async () => {
    const impl = rpcQueue(['http-fail', 'http-fail']);
    const out = await readReserveApys(POOL, reserves, opts(impl));
    expect(out).toBeNull();
  });
});
