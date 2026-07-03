import { describe, it, expect } from 'vitest';
import {
  validatePaymentIntent,
  validateInvokeIntent,
  toAssetRef,
  intentAssetCode,
} from '@core/miniapps/bridge';

const DEST = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const ISSUER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const CONTRACT = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';

describe('validatePaymentIntent', () => {
  it('accepts a minimal native payment', () => {
    const r = validatePaymentIntent({ destination: DEST, amount: '25' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.destination).toBe(DEST);
      expect(r.value.amount).toBe('25');
      expect(r.value.asset).toBeUndefined();
    }
  });

  it('accepts a numeric amount and trims a memo', () => {
    const r = validatePaymentIntent({ destination: DEST, amount: 10, memo: '  hi  ' });
    expect(r.ok && r.value.amount).toBe('10');
    expect(r.ok && r.value.memo).toBe('hi');
  });

  it('accepts an issued asset', () => {
    const r = validatePaymentIntent({ destination: DEST, amount: '5', asset: { code: 'USDC', issuer: ISSUER } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.asset).toEqual({ code: 'USDC', issuer: ISSUER });
  });

  it('rejects an invalid destination', () => {
    expect(validatePaymentIntent({ destination: 'nope', amount: '1' })).toMatchObject({ ok: false });
    expect(validatePaymentIntent({ amount: '1' })).toMatchObject({ ok: false });
  });

  it('rejects non-positive / non-finite amounts', () => {
    for (const amount of ['0', '-1', 'abc', '']) {
      expect(validatePaymentIntent({ destination: DEST, amount })).toMatchObject({ ok: false });
    }
  });

  it('rejects an oversized memo (> 28 bytes)', () => {
    const r = validatePaymentIntent({ destination: DEST, amount: '1', memo: 'x'.repeat(29) });
    expect(r).toMatchObject({ ok: false });
  });

  it('rejects an asset with empty code or bad issuer', () => {
    expect(validatePaymentIntent({ destination: DEST, amount: '1', asset: { code: '', issuer: ISSUER } })).toMatchObject({ ok: false });
    expect(validatePaymentIntent({ destination: DEST, amount: '1', asset: { code: 'X', issuer: 'bad' } })).toMatchObject({ ok: false });
  });
});

describe('validateInvokeIntent', () => {
  it('accepts a contract call and normalizes args to strings', () => {
    const r = validateInvokeIntent({ contractId: CONTRACT, function: 'supply', args: ['100', 5, true] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ contractId: CONTRACT, function: 'supply', args: ['100', '5', 'true'] });
    }
  });

  it('defaults args to an empty list when omitted', () => {
    const r = validateInvokeIntent({ contractId: CONTRACT, function: 'get_balance' });
    expect(r.ok && r.value.args).toEqual([]);
  });

  it('rejects a non-contract (account) address', () => {
    const r = validateInvokeIntent({ contractId: DEST, function: 'supply' });
    expect(r).toMatchObject({ ok: false });
  });

  it('rejects an invalid function symbol', () => {
    expect(validateInvokeIntent({ contractId: CONTRACT, function: 'bad name!' })).toMatchObject({ ok: false });
    expect(validateInvokeIntent({ contractId: CONTRACT, function: 'x'.repeat(33) })).toMatchObject({ ok: false });
    expect(validateInvokeIntent({ contractId: CONTRACT, function: '' })).toMatchObject({ ok: false });
  });

  it('rejects non-list args and non-scalar arg entries', () => {
    expect(validateInvokeIntent({ contractId: CONTRACT, function: 'supply', args: 'nope' })).toMatchObject({ ok: false });
    expect(validateInvokeIntent({ contractId: CONTRACT, function: 'supply', args: [{}] })).toMatchObject({ ok: false });
  });

  it('rejects a non-object request', () => {
    expect(validateInvokeIntent(null)).toMatchObject({ ok: false });
  });
});

describe('toAssetRef / intentAssetCode', () => {
  it('maps a native intent', () => {
    const intent = { destination: DEST, amount: '1' };
    expect(toAssetRef(intent)).toEqual({ isNative: true });
    expect(intentAssetCode(intent)).toBe('XLM');
  });

  it('maps an issued intent', () => {
    const intent = { destination: DEST, amount: '1', asset: { code: 'USDC', issuer: ISSUER } };
    expect(toAssetRef(intent)).toEqual({ isNative: false, code: 'USDC', issuer: ISSUER });
    expect(intentAssetCode(intent)).toBe('USDC');
  });
});
