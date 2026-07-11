import { describe, it, expect } from 'vitest';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { buildPathPaymentStrictSendXdr, destMinFromQuote } from '@core/stellar/swap';
import type { AssetRef } from '@core/stellar/tx';

const pp = Networks.TESTNET;
const SOURCE = Keypair.random().publicKey();
const DEST = Keypair.random().publicKey();
const USDC_ISSUER = Keypair.random().publicKey();
const EURC_ISSUER = Keypair.random().publicKey();

const XLM: AssetRef = { isNative: true };
const USDC: AssetRef = { isNative: false, code: 'USDC', issuer: USDC_ISSUER };
const EURC: AssetRef = { isNative: false, code: 'EURC', issuer: EURC_ISSUER };

const common = { sourceAccountId: SOURCE, sourceSequence: '1', networkPassphrase: pp, baseFee: '100' };

// Decode the single operation from a built swap XDR via the SDK.
function op(xdr: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return TransactionBuilder.fromXDR(xdr, pp).operations[0] as any;
}

describe('buildPathPaymentStrictSendXdr', () => {
  it('builds a self-swap XLM → USDC (strict-send path payment)', () => {
    const o = op(
      buildPathPaymentStrictSendXdr({ ...common, sendAsset: XLM, sendAmount: '100', destAsset: USDC, destMin: '24.3' }),
    );
    expect(o.type).toBe('pathPaymentStrictSend');
    expect(o.sendAsset.isNative()).toBe(true);
    expect(Number(o.sendAmount)).toBe(100);
    expect(o.destAsset.getCode()).toBe('USDC');
    expect(o.destAsset.getIssuer()).toBe(USDC_ISSUER);
    expect(Number(o.destMin)).toBe(24.3);
    expect(o.destination).toBe(SOURCE); // self-swap by default
    expect(o.path).toHaveLength(0);
  });

  it('sends to a custom destination when given one', () => {
    const o = op(
      buildPathPaymentStrictSendXdr({ ...common, sendAsset: XLM, sendAmount: '10', destAsset: USDC, destMin: '2', destination: DEST }),
    );
    expect(o.destination).toBe(DEST);
  });

  it('routes through an intermediate path', () => {
    const o = op(
      buildPathPaymentStrictSendXdr({ ...common, sendAsset: XLM, sendAmount: '10', destAsset: USDC, destMin: '2', path: [EURC] }),
    );
    expect(o.path).toHaveLength(1);
    expect(o.path[0].getCode()).toBe('EURC');
    expect(o.path[0].getIssuer()).toBe(EURC_ISSUER);
  });

  it('swaps between two issued assets', () => {
    const o = op(
      buildPathPaymentStrictSendXdr({ ...common, sendAsset: USDC, sendAmount: '50', destAsset: EURC, destMin: '46' }),
    );
    expect(o.sendAsset.getCode()).toBe('USDC');
    expect(o.destAsset.getCode()).toBe('EURC');
  });

  it('rejects a swap between identical assets', () => {
    expect(() => buildPathPaymentStrictSendXdr({ ...common, sendAsset: XLM, sendAmount: '1', destAsset: XLM, destMin: '1' })).toThrow(/different assets/i);
    expect(() => buildPathPaymentStrictSendXdr({ ...common, sendAsset: USDC, sendAmount: '1', destAsset: { ...USDC }, destMin: '1' })).toThrow(/different assets/i);
  });

  it('rejects non-positive or over-precision amounts', () => {
    expect(() => buildPathPaymentStrictSendXdr({ ...common, sendAsset: XLM, sendAmount: '0', destAsset: USDC, destMin: '1' })).toThrow(/send amount/i);
    expect(() => buildPathPaymentStrictSendXdr({ ...common, sendAsset: XLM, sendAmount: 'abc', destAsset: USDC, destMin: '1' })).toThrow(/send amount/i);
    expect(() => buildPathPaymentStrictSendXdr({ ...common, sendAsset: XLM, sendAmount: '1.123456789', destAsset: USDC, destMin: '1' })).toThrow(/send amount/i);
    expect(() => buildPathPaymentStrictSendXdr({ ...common, sendAsset: XLM, sendAmount: '1', destAsset: USDC, destMin: '0' })).toThrow(/minimum received/i);
  });

  it('rejects a non-native asset missing its issuer', () => {
    const bad: AssetRef = { isNative: false, code: 'BAD' };
    expect(() => buildPathPaymentStrictSendXdr({ ...common, sendAsset: XLM, sendAmount: '1', destAsset: bad, destMin: '1' })).toThrow(/issuer/i);
  });
});

describe('destMinFromQuote', () => {
  it('applies the tolerance and floors to 7dp', () => {
    expect(destMinFromQuote('100', 0.005)).toBe('99.5000000');
    expect(destMinFromQuote('24.5', 0.01)).toBe('24.2550000');
    expect(destMinFromQuote('100', 0)).toBe('100.0000000');
  });

  it('rejects a bad quote or tolerance', () => {
    expect(() => destMinFromQuote('0', 0.01)).toThrow(/positive/i);
    expect(() => destMinFromQuote('abc', 0.01)).toThrow(/positive/i);
    expect(() => destMinFromQuote('100', 1)).toThrow(/tolerance/i);
    expect(() => destMinFromQuote('100', -0.1)).toThrow(/tolerance/i);
  });
});
