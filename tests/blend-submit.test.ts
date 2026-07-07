import { describe, it, expect } from 'vitest';
import {
  Networks,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { decodeTransaction } from '@core/scan/decode';
import { toBaseUnits, prepareBlendSubmit } from '@core/blend/submit';

const pp = Networks.TESTNET;
const USER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const POOL = StrKey.encodeContract(Buffer.alloc(32, 7));
const ASSET = StrKey.encodeContract(Buffer.alloc(32, 9));

describe('toBaseUnits', () => {
  it('converts a whole number', () => {
    expect(toBaseUnits('5', 7)).toBe('50000000');
  });
  it('converts a fractional amount', () => {
    expect(toBaseUnits('1.5', 7)).toBe('15000000');
    expect(toBaseUnits('0.0000001', 7)).toBe('1');
  });
  it('trims leading zeros', () => {
    expect(toBaseUnits('007', 2)).toBe('700');
  });
  it('rejects too many decimal places', () => {
    expect(() => toBaseUnits('1.12345678', 7)).toThrow(/decimal/i);
  });
  it('rejects a non-numeric or zero amount', () => {
    expect(() => toBaseUnits('abc', 7)).toThrow(/valid amount/i);
    expect(() => toBaseUnits('0', 7)).toThrow(/greater than zero/i);
    expect(() => toBaseUnits('0.0', 7)).toThrow(/greater than zero/i);
  });
});

describe('prepareBlendSubmit', () => {
  const footprint = new SorobanDataBuilder().build().toXDR('base64');

  function rpcFetch(result: unknown, init: { ok?: boolean; status?: number } = {}) {
    const calls: string[] = [];
    const impl = ((url: string) => {
      calls.push(url);
      return Promise.resolve({
        ok: init.ok ?? true,
        status: init.status ?? 200,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }),
      });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  const base = {
    poolId: POOL,
    userAddress: USER,
    reserveAssetId: ASSET,
    amount: '10000000',
    action: 'supply' as const,
    sourceSequence: '1',
    networkPassphrase: pp,
    rpcUrl: 'https://rpc.example.com',
  };

  it('builds → simulates → assembles into a ready-to-sign submit XDR', async () => {
    const { impl } = rpcFetch({ transactionData: footprint, minResourceFee: '500' });
    const r = await prepareBlendSubmit({ ...base, fetchImpl: impl });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const decoded = decodeTransaction(r.xdr, pp);
      expect(decoded?.operations[0]?.contractFunction).toBe('submit');
      expect(decoded?.operations[0]?.contractId).toBe(POOL);
      // fee = 100 inclusion + 500 resource
      expect((TransactionBuilder.fromXDR(r.xdr, pp) as Transaction).fee).toBe('600');
    }
  });

  it('returns ok:false with the reason when the contract would revert', async () => {
    const { impl } = rpcFetch({ error: 'HostError: Error(Contract, #13)' });
    const r = await prepareBlendSubmit({ ...base, fetchImpl: impl });
    expect(r).toEqual({ ok: false, error: 'HostError: Error(Contract, #13)' });
  });

  it('returns ok:false on a bad amount and never calls the RPC', async () => {
    const { impl, calls } = rpcFetch({ transactionData: footprint, minResourceFee: '1' });
    const r = await prepareBlendSubmit({ ...base, amount: '0', fetchImpl: impl });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('returns ok:false when the RPC request fails (non-2xx)', async () => {
    const { impl } = rpcFetch({}, { ok: false, status: 500 });
    const r = await prepareBlendSubmit({ ...base, fetchImpl: impl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/500/);
  });

  it('returns ok:false when the simulation has no footprint', async () => {
    const { impl } = rpcFetch({ minResourceFee: '500' }); // no transactionData
    const r = await prepareBlendSubmit({ ...base, fetchImpl: impl });
    expect(r.ok).toBe(false);
  });
});
