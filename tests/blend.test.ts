import { describe, it, expect } from 'vitest';
import { Networks, StrKey, TransactionBuilder, scValToNative } from '@stellar/stellar-sdk';
import { buildBlendSubmitXdr, BLEND_REQUEST_TYPE } from '@core/blend/pool';
import { decodeTransaction } from '@core/scan/decode';

const pp = Networks.TESTNET;
const USER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
// Two distinct, valid C… contract addresses for the pool and the reserve asset.
const POOL = StrKey.encodeContract(Buffer.alloc(32, 7));
const ASSET = StrKey.encodeContract(Buffer.alloc(32, 9));

const common = {
  poolId: POOL,
  userAddress: USER,
  reserveAssetId: ASSET,
  sourceSequence: '1',
  networkPassphrase: pp,
  fee: '100',
};

// Pull the decoded `submit` args (from, spender, to, requests) out of a built XDR.
// The SDK's xdr union isn't worth typing precisely in a test, so reach in via any.
/* eslint-disable @typescript-eslint/no-explicit-any */
function submitArgs(xdrStr: string) {
  const tx = TransactionBuilder.fromXDR(xdrStr, pp);
  const op = tx.operations[0] as any;
  expect(op.type).toBe('invokeHostFunction');
  const ic = op.func.invokeContract();
  return {
    fnName: ic.functionName().toString(),
    args: ic.args().map((a: any) => scValToNative(a)) as any[],
    rawRequests: ic.args()[3] as any,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('buildBlendSubmitXdr', () => {
  it('round-trips through the scan decoder as a submit invoke on the pool', () => {
    const xdr = buildBlendSubmitXdr({ ...common, amount: '1000000000', action: 'supply' });
    const decoded = decodeTransaction(xdr, pp);
    expect(decoded?.isSoroban).toBe(true);
    const op = decoded?.operations[0];
    expect(op?.type).toBe('invokeHostFunction');
    expect(op?.contractId).toBe(POOL);
    expect(op?.contractFunction).toBe('submit');
  });

  it('encodes from = spender = to = the user account', () => {
    const xdr = buildBlendSubmitXdr({ ...common, amount: '5', action: 'supply' });
    const { fnName, args } = submitArgs(xdr);
    expect(fnName).toBe('submit');
    expect(args[0]).toBe(USER); // from
    expect(args[1]).toBe(USER); // spender
    expect(args[2]).toBe(USER); // to
  });

  it('builds a supply request (request_type 0) with the asset + amount', () => {
    const xdr = buildBlendSubmitXdr({ ...common, amount: '250', action: 'supply' });
    const { args } = submitArgs(xdr);
    expect(args[3]).toEqual([
      { address: ASSET, amount: 250n, request_type: BLEND_REQUEST_TYPE.Supply },
    ]);
  });

  it('builds a withdraw request (request_type 1)', () => {
    const xdr = buildBlendSubmitXdr({ ...common, amount: '250', action: 'withdraw' });
    const { args } = submitArgs(xdr);
    expect(args[3]).toEqual([
      { address: ASSET, amount: 250n, request_type: BLEND_REQUEST_TYPE.Withdraw },
    ]);
  });

  it('orders the Request map keys ascending (address, amount, request_type)', () => {
    const xdr = buildBlendSubmitXdr({ ...common, amount: '1', action: 'supply' });
    const { rawRequests } = submitArgs(xdr);
    const keys = rawRequests
      .vec()[0]
      .map()
      .map((e: { key(): { sym(): Buffer } }) => e.key().sym().toString());
    expect(keys).toEqual(['address', 'amount', 'request_type']);
  });

  it('preserves full i128 amount precision', () => {
    const big = (2n ** 100n).toString();
    const xdr = buildBlendSubmitXdr({ ...common, amount: big, action: 'supply' });
    const { args } = submitArgs(xdr);
    expect(args[3][0].amount).toBe(2n ** 100n);
  });

  it('rejects an invalid pool address', () => {
    expect(() => buildBlendSubmitXdr({ ...common, poolId: 'CNOPE', amount: '1', action: 'supply' })).toThrow(
      /pool address/i,
    );
  });

  it('rejects an account (G…) as the pool address', () => {
    expect(() => buildBlendSubmitXdr({ ...common, poolId: USER, amount: '1', action: 'supply' })).toThrow(
      /pool address/i,
    );
  });

  it('rejects an invalid reserve asset address', () => {
    expect(() =>
      buildBlendSubmitXdr({ ...common, reserveAssetId: 'CBAD', amount: '1', action: 'supply' }),
    ).toThrow(/reserve asset/i);
  });

  it('rejects an invalid user account', () => {
    expect(() =>
      buildBlendSubmitXdr({ ...common, userAddress: 'GBAD', amount: '1', action: 'supply' }),
    ).toThrow(/account address/i);
  });

  it('rejects a zero, negative, or non-integer amount', () => {
    expect(() => buildBlendSubmitXdr({ ...common, amount: '0', action: 'supply' })).toThrow(/greater than zero/i);
    expect(() => buildBlendSubmitXdr({ ...common, amount: '-5', action: 'supply' })).toThrow(/amount/i);
    expect(() => buildBlendSubmitXdr({ ...common, amount: '1.5', action: 'supply' })).toThrow(/amount/i);
  });

  it('rejects an amount above the i128 max', () => {
    expect(() =>
      buildBlendSubmitXdr({ ...common, amount: (2n ** 127n).toString(), action: 'supply' }),
    ).toThrow(/out of range/i);
  });
});
