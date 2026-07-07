import { describe, it, expect } from 'vitest';
import { Networks, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import { buildPathPaymentStrictSendXdr, destMinFromQuote, type BuildSwapParams } from '@core/stellar/swap';
import type { AssetRef } from '@core/stellar/tx';

const pp = Networks.TESTNET;
const SOURCE = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const OTHER = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const XLM: AssetRef = { isNative: true };
const USDC: AssetRef = { isNative: false, code: 'USDC', issuer: USDC_ISSUER };
const EURC: AssetRef = { isNative: false, code: 'EURC', issuer: USDC_ISSUER };

const base: BuildSwapParams = {
  sourceAccountId: SOURCE,
  sourceSequence: '1',
  networkPassphrase: pp,
  baseFee: '100',
  sendAsset: XLM,
  sendAmount: '100',
  destAsset: USDC,
  destMin: '24.3',
};

// Decode the single pathPaymentStrictSend op out of a built XDR.
function decodeOp(xdr: string) {
  const tx = TransactionBuilder.fromXDR(xdr, pp) as Transaction;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { tx, op: tx.operations[0] as any };
}

describe('buildPathPaymentStrictSendXdr', () => {
  it('round-trips a native→issued swap with amounts + slippage floor', () => {
    const { tx, op } = decodeOp(buildPathPaymentStrictSendXdr(base));
    expect(op.type).toBe('pathPaymentStrictSend');
    expect(op.sendAsset.isNative()).toBe(true);
    expect(Number(op.sendAmount)).toBe(100);
    expect(op.destAsset.getCode()).toBe('USDC');
    expect(op.destAsset.getIssuer()).toBe(USDC_ISSUER);
    expect(Number(op.destMin)).toBe(24.3);
    expect(op.path).toHaveLength(0);
    expect(tx.source).toBe(SOURCE);
  });

  it('defaults destination to the source account (self-swap)', () => {
    expect(decodeOp(buildPathPaymentStrictSendXdr(base)).op.destination).toBe(SOURCE);
  });

  it('honors an explicit destination', () => {
    expect(decodeOp(buildPathPaymentStrictSendXdr({ ...base, destination: OTHER })).op.destination).toBe(OTHER);
  });

  it('supports an issued→native swap', () => {
    const { op } = decodeOp(
      buildPathPaymentStrictSendXdr({ ...base, sendAsset: USDC, sendAmount: '25', destAsset: XLM, destMin: '95' }),
    );
    expect(op.sendAsset.getCode()).toBe('USDC');
    expect(op.destAsset.isNative()).toBe(true);
  });

  it('encodes intermediate path hops', () => {
    const { op } = decodeOp(buildPathPaymentStrictSendXdr({ ...base, path: [EURC] }));
    expect(op.path).toHaveLength(1);
    expect(op.path[0].getCode()).toBe('EURC');
  });

  it('rejects a non-positive send amount or destMin', () => {
    expect(() => buildPathPaymentStrictSendXdr({ ...base, sendAmount: '0' })).toThrow(/send amount/i);
    expect(() => buildPathPaymentStrictSendXdr({ ...base, sendAmount: '-5' })).toThrow(/send amount/i);
    expect(() => buildPathPaymentStrictSendXdr({ ...base, destMin: '0' })).toThrow(/minimum received/i);
  });

  it('rejects more than 7 decimal places', () => {
    expect(() => buildPathPaymentStrictSendXdr({ ...base, sendAmount: '1.123456789' })).toThrow(/send amount/i);
  });

  it('rejects swapping an asset for itself', () => {
    expect(() => buildPathPaymentStrictSendXdr({ ...base, destAsset: XLM })).toThrow(/different assets/i);
    expect(() =>
      buildPathPaymentStrictSendXdr({ ...base, sendAsset: USDC, destAsset: { ...USDC } }),
    ).toThrow(/different assets/i);
  });

  it('rejects an issued asset missing its issuer', () => {
    expect(() =>
      buildPathPaymentStrictSendXdr({ ...base, destAsset: { isNative: false, code: 'USDC' } }),
    ).toThrow(/code and issuer/i);
  });
});

describe('destMinFromQuote', () => {
  it('applies the tolerance and floors to 7 dp', () => {
    expect(destMinFromQuote('100', 0.005)).toBe('99.5000000'); // 0.5%
    expect(destMinFromQuote('24.5', 0.01)).toBe('24.2550000'); // 1%
    expect(destMinFromQuote('24.5', 0)).toBe('24.5000000'); // no tolerance
  });

  it('rejects a non-positive quote or an out-of-range tolerance', () => {
    expect(() => destMinFromQuote('0', 0.01)).toThrow(/positive/i);
    expect(() => destMinFromQuote('abc', 0.01)).toThrow(/positive/i);
    expect(() => destMinFromQuote('100', 1)).toThrow(/tolerance/i);
    expect(() => destMinFromQuote('100', -0.1)).toThrow(/tolerance/i);
  });
});
