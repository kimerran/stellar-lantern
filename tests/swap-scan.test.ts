import { describe, it, expect } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { buildPathPaymentStrictSendXdr } from '@core/stellar/swap';
import type { AssetRef } from '@core/stellar/tx';
import { decodeTransaction } from '@core/scan/decode';
import { explainTransaction } from '@core/scan/explainer';
import { scan } from '@core/scan/engine';

const pp = Networks.TESTNET;
// Non-flagged addresses (avoid the engine's DEMO_FLAGGED_ADDRESSES set).
const ME = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const OTHER = 'GDNY6KQKJZZMJKGGATFHSAOBJZZTTLMOS54GAOOIQJSBHTNFJDVWY7HV';
const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const XLM: AssetRef = { isNative: true };
const USDC: AssetRef = { isNative: false, code: 'USDC', issuer: ISSUER };

function swapXdr(over: Partial<Parameters<typeof buildPathPaymentStrictSendXdr>[0]> = {}) {
  return buildPathPaymentStrictSendXdr({
    sourceAccountId: ME,
    sourceSequence: '1',
    networkPassphrase: pp,
    baseFee: '100',
    sendAsset: XLM,
    sendAmount: '100',
    destAsset: USDC,
    destMin: '24.3',
    ...over,
  });
}

describe('swap decode', () => {
  it('exposes both sides + the slippage floor of a strict-send swap', () => {
    const op = decodeTransaction(swapXdr(), pp)?.operations[0];
    expect(op?.type).toBe('pathPaymentStrictSend');
    expect(op?.sendAssetCode).toBe('XLM');
    expect(Number(op?.sendAmount)).toBe(100);
    expect(op?.destAssetCode).toBe('USDC');
    expect(Number(op?.destMin)).toBe(24.3);
  });
});

describe('swap explanation', () => {
  it('names both assets, amount, and the min received (not generic payment wording)', () => {
    const sentence = explainTransaction(decodeTransaction(swapXdr(), pp));
    expect(sentence).toBe('This swaps 100 XLM for at least 24.3 USDC.');
    expect(sentence).not.toMatch(/swaps assets and sends about/);
  });
});

describe('swap risk', () => {
  const ctx = { network: 'TESTNET' as const, fromAddress: ME };

  it('a self-swap is low-risk (allow)', () => {
    const v = scan({ xdr: swapXdr(), networkPassphrase: pp, context: ctx });
    expect(v.action).toBe('allow');
    expect(v.reasons.some((r) => r.code === 'swap_to_other')).toBe(false);
  });

  it('a swap sending proceeds to another account is flagged medium', () => {
    const v = scan({ xdr: swapXdr({ destination: OTHER }), networkPassphrase: pp, context: ctx });
    const reason = v.reasons.find((r) => r.code === 'swap_to_other');
    expect(reason?.severity).toBe('medium');
    expect(v.risk).toBe('medium');
  });
});
