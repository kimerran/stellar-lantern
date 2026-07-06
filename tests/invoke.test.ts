import { describe, it, expect } from 'vitest';
import {
  Networks,
  scValToNative,
  TransactionBuilder,
  SorobanDataBuilder,
  type Transaction,
} from '@stellar/stellar-sdk';
import {
  argToScVal,
  buildInvokeContractXdr,
  assembleInvokeXdr,
  prepareInvoke,
  type InvokeArg,
} from '@core/stellar/invoke';
import { decodeTransaction } from '@core/scan/decode';

const SOURCE = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const CONTRACT = 'CDNCUDGEUEPOEJOOKQGKXN3RBMBCLVBFRLSHUD6O7WVSMECTQRCW656Z';
const ACCOUNT = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const pp = Networks.TESTNET;

const common = {
  sourceAccount: SOURCE,
  sourceSequence: '1',
  contractId: CONTRACT,
  networkPassphrase: pp,
  fee: '100',
};

describe('buildInvokeContractXdr', () => {
  it('round-trips contract id + function through the scan decoder', () => {
    const xdr = buildInvokeContractXdr({
      ...common,
      functionName: 'supply',
      args: [
        { type: 'address', value: ACCOUNT },
        { type: 'i128', value: '1000000000' },
      ],
    });
    const decoded = decodeTransaction(xdr, pp);
    expect(decoded?.isSoroban).toBe(true);
    const op = decoded?.operations[0];
    expect(op?.type).toBe('invokeHostFunction');
    expect(op?.contractId).toBe(CONTRACT);
    expect(op?.contractFunction).toBe('supply');
  });

  it('builds a call with no args', () => {
    const xdr = buildInvokeContractXdr({ ...common, functionName: 'get_config', args: [] });
    const op = decodeTransaction(xdr, pp)?.operations[0];
    expect(op?.contractFunction).toBe('get_config');
  });

  it('rejects an invalid contract id', () => {
    expect(() =>
      buildInvokeContractXdr({ ...common, contractId: 'CNOTVALID', functionName: 'supply', args: [] }),
    ).toThrow(/contract address/i);
  });

  it('rejects an account (G…) address as the contract id', () => {
    expect(() =>
      buildInvokeContractXdr({ ...common, contractId: ACCOUNT, functionName: 'supply', args: [] }),
    ).toThrow(/contract address/i);
  });

  it('rejects an invalid function name', () => {
    expect(() =>
      buildInvokeContractXdr({ ...common, functionName: 'bad-name!', args: [] }),
    ).toThrow(/function name/i);
    expect(() =>
      buildInvokeContractXdr({ ...common, functionName: 'a'.repeat(33), args: [] }),
    ).toThrow(/function name/i);
  });

  it('propagates a bad typed arg error while building', () => {
    expect(() =>
      buildInvokeContractXdr({
        ...common,
        functionName: 'supply',
        args: [{ type: 'i128', value: 'not-a-number' }],
      }),
    ).toThrow(/i128/i);
  });
});

describe('argToScVal', () => {
  function roundTrip(arg: InvokeArg): unknown {
    return scValToNative(argToScVal(arg));
  }

  it('round-trips an address', () => {
    expect(roundTrip({ type: 'address', value: ACCOUNT })).toBe(ACCOUNT);
    expect(roundTrip({ type: 'address', value: CONTRACT })).toBe(CONTRACT);
  });

  it('round-trips a symbol and a string', () => {
    expect(roundTrip({ type: 'symbol', value: 'supply' })).toBe('supply');
    expect(roundTrip({ type: 'string', value: 'hello world' })).toBe('hello world');
  });

  it('round-trips a bool', () => {
    expect(roundTrip({ type: 'bool', value: 'true' })).toBe(true);
    expect(roundTrip({ type: 'bool', value: 'false' })).toBe(false);
  });

  it('round-trips 32-bit ints', () => {
    expect(roundTrip({ type: 'u32', value: '42' })).toBe(42);
    expect(roundTrip({ type: 'i32', value: '-42' })).toBe(-42);
  });

  it('round-trips 64/128-bit ints as bigint', () => {
    expect(roundTrip({ type: 'u64', value: '9223372036854775807' })).toBe(9223372036854775807n);
    expect(roundTrip({ type: 'i64', value: '-9223372036854775808' })).toBe(-9223372036854775808n);
    expect(roundTrip({ type: 'i128', value: '170141183460469231731687303715884105727' })).toBe(
      170141183460469231731687303715884105727n,
    );
    expect(roundTrip({ type: 'u128', value: '340282366920938463463374607431768211455' })).toBe(
      340282366920938463463374607431768211455n,
    );
  });

  it('round-trips bytes from hex', () => {
    const out = argToScVal({ type: 'bytes', value: 'deadbeef' });
    expect(Buffer.from(scValToNative(out) as Uint8Array).toString('hex')).toBe('deadbeef');
  });

  it('throws on a non-numeric int', () => {
    expect(() => argToScVal({ type: 'u64', value: '12x' })).toThrow(/u64/i);
  });

  it('throws on an out-of-range int', () => {
    expect(() => argToScVal({ type: 'u32', value: '-1' })).toThrow(/u32/i);
    expect(() => argToScVal({ type: 'u32', value: '4294967296' })).toThrow(/u32/i);
    expect(() => argToScVal({ type: 'i128', value: '170141183460469231731687303715884105728' })).toThrow(
      /i128/i,
    );
  });

  it('throws on an invalid address', () => {
    expect(() => argToScVal({ type: 'address', value: 'GBAD' })).toThrow(/address/i);
  });

  it('throws on an invalid symbol', () => {
    expect(() => argToScVal({ type: 'symbol', value: 'has space' })).toThrow(/symbol/i);
    expect(() => argToScVal({ type: 'symbol', value: 'x'.repeat(33) })).toThrow(/symbol/i);
  });

  it('throws on odd-length / non-hex bytes', () => {
    expect(() => argToScVal({ type: 'bytes', value: 'abc' })).toThrow(/hex/i);
    expect(() => argToScVal({ type: 'bytes', value: 'zz' })).toThrow(/hex/i);
  });

  it('throws on a bad bool', () => {
    expect(() => argToScVal({ type: 'bool', value: '1' })).toThrow(/bool/i);
  });
});

describe('assembleInvokeXdr', () => {
  const built = buildInvokeContractXdr({
    ...common,
    functionName: 'supply',
    args: [{ type: 'i128', value: '100' }],
  });
  // A default (empty) SorobanTransactionData stands in for the simulation footprint.
  const footprint = new SorobanDataBuilder().build().toXDR('base64');

  it('applies footprint + resource fee and preserves the invoke call', () => {
    const assembled = assembleInvokeXdr({
      builtXdr: built,
      networkPassphrase: pp,
      minResourceFee: '12345',
      transactionData: footprint,
    });
    const tx = TransactionBuilder.fromXDR(assembled, pp) as Transaction;
    // total fee = 100 inclusion + 12345 resource
    expect(tx.fee).toBe('12445');
    // the SorobanTransactionData (footprint) is attached (tx ext arm 1)
    expect(tx.toEnvelope().v1().tx().ext().switch()).toBe(1);
    // the invoke call survived the rebuild (same contract + function)
    const decoded = decodeTransaction(assembled, pp);
    expect(decoded?.operations[0]?.contractFunction).toBe('supply');
    expect(decoded?.operations[0]?.contractId).toBe(CONTRACT);
    // source + sequence preserved
    expect(tx.source).toBe(SOURCE);
  });

  it('respects a custom inclusion fee', () => {
    const assembled = assembleInvokeXdr({
      builtXdr: built,
      networkPassphrase: pp,
      minResourceFee: '900',
      transactionData: footprint,
      inclusionFee: '10000',
    });
    expect((TransactionBuilder.fromXDR(assembled, pp) as Transaction).fee).toBe('10900');
  });

  it('throws when the simulation has no footprint data', () => {
    expect(() =>
      assembleInvokeXdr({ builtXdr: built, networkPassphrase: pp, minResourceFee: '1', transactionData: '' }),
    ).toThrow(/footprint/i);
  });
});

describe('prepareInvoke', () => {
  const footprint = new SorobanDataBuilder().build().toXDR('base64');

  // A JSON-RPC fetch stub returning a simulate `result`; records call count.
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
    sourceAccount: SOURCE,
    sourceSequence: '1',
    contractId: CONTRACT,
    functionName: 'supply',
    args: [{ type: 'i128', value: '100' }] as InvokeArg[],
    networkPassphrase: pp,
    rpcUrl: 'https://rpc.example.com',
  };

  it('builds → simulates → assembles into a ready-to-sign XDR', async () => {
    const { impl } = rpcFetch({ transactionData: footprint, minResourceFee: '500' });
    const r = await prepareInvoke({ ...base, fetchImpl: impl });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const decoded = decodeTransaction(r.xdr, pp);
      expect(decoded?.operations[0]?.contractFunction).toBe('supply');
      // fee = 100 inclusion + 500 resource
      expect((TransactionBuilder.fromXDR(r.xdr, pp) as Transaction).fee).toBe('600');
    }
  });

  it('returns ok:false with the reason when the contract would revert', async () => {
    const { impl } = rpcFetch({ error: 'HostError: insufficient balance' });
    const r = await prepareInvoke({ ...base, fetchImpl: impl });
    expect(r).toEqual({ ok: false, error: 'HostError: insufficient balance' });
  });

  it('returns ok:false on a bad arg and never calls the RPC', async () => {
    const { impl, calls } = rpcFetch({ transactionData: footprint, minResourceFee: '1' });
    const r = await prepareInvoke({ ...base, args: [{ type: 'i128', value: 'not-a-number' }], fetchImpl: impl });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('returns ok:false when the RPC request fails (non-2xx)', async () => {
    const { impl } = rpcFetch({}, { ok: false, status: 500 });
    const r = await prepareInvoke({ ...base, fetchImpl: impl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/500/);
  });
});
