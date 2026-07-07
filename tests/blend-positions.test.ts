import { describe, it, expect } from 'vitest';
import { StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import {
  bTokensToUnderlying,
  readSuppliedPositions,
  SCALAR_12,
} from '@core/blend/positions';

const USER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const POOL = StrKey.encodeContract(Buffer.alloc(32, 7));
const USDC = StrKey.encodeContract(Buffer.alloc(32, 9));
const XLM = StrKey.encodeContract(Buffer.alloc(32, 5));

// ── ScVal fixture builders (mirror Blend's return shapes) ──
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });

// Positions { supply: Map<u32 index, i128 bTokens>, ... }
function positionsScVal(supply: Record<number, bigint>): xdr.ScVal {
  const supplyMap = xdr.ScVal.scvMap(
    Object.entries(supply).map(
      ([idx, amt]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvU32(Number(idx)), val: i128(amt) }),
    ),
  );
  const empty = xdr.ScVal.scvMap([]);
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: sym('collateral'), val: empty }),
    new xdr.ScMapEntry({ key: sym('liabilities'), val: empty }),
    new xdr.ScMapEntry({ key: sym('supply'), val: supplyMap }),
  ]);
}

// Reserve { config: { index, decimals }, data: { b_rate } }
function reserveScVal(index: number, decimals: number, bRate: bigint): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: sym('config'),
      val: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: sym('decimals'), val: xdr.ScVal.scvU32(decimals) }),
        new xdr.ScMapEntry({ key: sym('index'), val: xdr.ScVal.scvU32(index) }),
      ]),
    }),
    new xdr.ScMapEntry({
      key: sym('data'),
      val: xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: sym('b_rate'), val: i128(bRate) })]),
    }),
  ]);
}

// A fetch stub returning queued simulate results (one per call, in order). Each
// entry is either an ScVal (successful view) or a sentinel for an RPC failure.
function rpcQueue(items: Array<xdr.ScVal | 'http-fail'>) {
  let i = 0;
  const impl = (() => {
    const item = items[i++];
    if (item === 'http-fail') return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ jsonrpc: '2.0', id: 1, result: { results: [{ xdr: item!.toXDR('base64') }] } }),
    });
  }) as unknown as typeof fetch;
  return impl;
}

const opts = (impl: typeof fetch) => ({ rpcUrl: 'https://rpc.example.com', fetchImpl: impl });
const reserves = [
  { code: 'USDC', assetId: USDC },
  { code: 'XLM', assetId: XLM },
];

const B_RATE = 1055802308587n; // ~1.0558 (accrued yield), from live testnet

describe('bTokensToUnderlying', () => {
  it('is identity at rate 1.0', () => {
    expect(bTokensToUnderlying('10000000', SCALAR_12.toString())).toBe('10000000');
  });
  it('grows the amount by the b_rate (accrued yield)', () => {
    // 1e7 bTokens * 1.0558e12 / 1e12 = 10_558_023 base units
    expect(bTokensToUnderlying('10000000', B_RATE)).toBe('10558023');
  });
  it('returns 0 for a non-positive balance or rate', () => {
    expect(bTokensToUnderlying('0', B_RATE)).toBe('0');
    expect(bTokensToUnderlying('10000000', '0')).toBe('0');
  });
});

describe('readSuppliedPositions', () => {
  it('reports the underlying supplied per reserve (0 when none)', async () => {
    // USDC (index 3) has 1e7 bTokens supplied; XLM (index 0) has none.
    const impl = rpcQueue([
      positionsScVal({ 3: 10000000n }),
      reserveScVal(3, 7, B_RATE), // USDC
      reserveScVal(0, 7, SCALAR_12), // XLM, rate 1.0
    ]);
    const out = await readSuppliedPositions(POOL, USER, reserves, opts(impl));
    expect(out).toEqual([
      { code: 'USDC', suppliedBase: '10558023', decimals: 7 },
      { code: 'XLM', suppliedBase: '0', decimals: 7 },
    ]);
  });

  it('returns all-zero positions for an account that supplied nothing', async () => {
    const impl = rpcQueue([
      positionsScVal({}),
      reserveScVal(3, 7, B_RATE),
      reserveScVal(0, 7, SCALAR_12),
    ]);
    const out = await readSuppliedPositions(POOL, USER, reserves, opts(impl));
    expect(out?.map((p) => p.suppliedBase)).toEqual(['0', '0']);
  });

  it('fails soft (null) when positions cannot be read', async () => {
    const impl = rpcQueue(['http-fail']);
    const out = await readSuppliedPositions(POOL, USER, reserves, opts(impl));
    expect(out).toBeNull();
  });
});
