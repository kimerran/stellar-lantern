import { describe, it, expect } from 'vitest';
import { StrKey, TransactionBuilder, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import {
  bTokensToUnderlying,
  readSuppliedPositions,
  readReserves,
  readSupplyMap,
  suppliedPositionsFromReserves,
  SCALAR_12,
} from '@core/blend/positions';
import { reserveApysFromReserves } from '@core/blend/apr';

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

// The name of the invoked contract function, decoded from a simulate request's XDR.
function invokedFn(txXdr: string): string {
  const tx = TransactionBuilder.fromXDR(txXdr, 'Test SDF Network ; September 2015');
  // The scan decoder isn't in scope here; reach into the SDK op union directly.
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const op = tx.operations[0] as any;
  return op.func.invokeContract().functionName().toString();
}

// A fetch stub that answers by invoked function name and tallies each call, so we
// can assert how many times `get_reserve` is actually hit per refresh.
function countingRpc() {
  const calls: Record<string, number> = { get_positions: 0, get_reserve: 0 };
  const impl = ((_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { params: { transaction: string } };
    const fn = invokedFn(body.params.transaction);
    calls[fn] = (calls[fn] ?? 0) + 1;
    const val =
      fn === 'get_positions' ? positionsScVal({ 3: 10000000n }) : reserveScVal(3, 7, B_RATE);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ jsonrpc: '2.0', id: 1, result: { results: [{ xdr: val.toXDR('base64') }] } }),
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

// Guards the de-dup fix (#127): deriving BOTH readouts from one shared reserve read
// hits `get_reserve` once per reserve, not twice (the old positions+apr double read).
describe('shared reserve read (de-dup)', () => {
  it('fetches get_positions once and get_reserve once per reserve for both readouts', async () => {
    const { impl, calls } = countingRpc();
    const refs = reserves;

    // Mirror Earn.tsx's per-pool refresh: one supply read + one shared reserve read.
    const [supply, decoded] = await Promise.all([
      readSupplyMap(POOL, USER, opts(impl)),
      readReserves(POOL, refs, opts(impl)),
    ]);
    const supplied = suppliedPositionsFromReserves(refs, decoded, supply);
    const apys = reserveApysFromReserves(refs, decoded);

    // Both readouts were produced from the single shared fetch…
    expect(supplied).not.toBeNull();
    expect(supplied?.[0]).toEqual({ code: 'USDC', suppliedBase: '10558023', decimals: 7 });
    expect(apys).not.toBeNull();

    // …and get_reserve was hit exactly once per reserve (2), not twice (4).
    expect(calls.get_positions).toBe(1);
    expect(calls.get_reserve).toBe(refs.length);
  });
});
