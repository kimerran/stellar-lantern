import { describe, it, expect } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { scan, DEMO_FLAGGED_ADDRESSES, sampleVerdict } from '@core/scan/engine';
import { buildTransferXdr } from '@core/stellar/tx';
import { analyzeMessage } from '@core/scan/paste';
import { decodeTransaction } from '@core/scan/decode';
import { explainTransaction } from '@core/scan/explainer';

const SOURCE = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
// A normal (NOT deny-listed) destination.
const NORMAL_DEST = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const pp = Networks.TESTNET;

function xdrFor(opts: { dest: string; amount: string; funded: boolean; memo?: string }): string {
  return buildTransferXdr({
    sourceAccountId: SOURCE,
    sourceSequence: '1',
    networkPassphrase: pp,
    baseFee: '100',
    destination: opts.dest,
    destinationFunded: opts.funded,
    asset: { isNative: true },
    amount: opts.amount,
    memo: opts.memo,
  });
}

describe('decode + explain', () => {
  it('decodes a payment and explains it in one sentence', () => {
    const xdr = xdrFor({ dest: NORMAL_DEST, amount: '12', funded: true });
    const decoded = decodeTransaction(xdr, pp);
    expect(decoded?.operations[0]?.type).toBe('payment');
    expect(Number(decoded?.primaryAmount)).toBe(12);
    expect(explainTransaction(decoded)).toMatch(/sends 12 XLM to/i);
  });

  it('describes createAccount as funding a new account', () => {
    const xdr = xdrFor({ dest: NORMAL_DEST, amount: '5', funded: false });
    const decoded = decodeTransaction(xdr, pp);
    expect(decoded?.operations[0]?.type).toBe('createAccount');
    expect(explainTransaction(decoded)).toMatch(/creates and funds a new account/i);
  });
});

describe('scan engine (mock)', () => {
  it('returns low/allow for a normal payment to a funded account', () => {
    const xdr = xdrFor({ dest: NORMAL_DEST, amount: '10', funded: true });
    const v = scan({ xdr, networkPassphrase: pp, context: { network: 'TESTNET', fromAddress: SOURCE, destinationFunded: true, spendableXlm: '1000' } });
    expect(v.risk).toBe('low');
    expect(v.action).toBe('allow');
    expect(v.checkedBy).toBe('Lantern');
  });

  it('flags a new/unfunded account as medium', () => {
    const xdr = xdrFor({ dest: NORMAL_DEST, amount: '5', funded: false });
    const v = scan({ xdr, networkPassphrase: pp, context: { network: 'TESTNET', fromAddress: SOURCE, destinationFunded: false, spendableXlm: '1000' } });
    expect(v.risk).toBe('medium');
    expect(v.action).toBe('warn');
    expect(v.reasons.some((r) => r.code === 'new_account')).toBe(true);
  });

  it('blocks a reported (deny-listed) address as high', () => {
    const flagged = [...DEMO_FLAGGED_ADDRESSES][0]!;
    const xdr = xdrFor({ dest: flagged, amount: '5', funded: true });
    const v = scan({ xdr, networkPassphrase: pp, context: { network: 'TESTNET', fromAddress: SOURCE, destinationFunded: true, spendableXlm: '1000' } });
    expect(v.risk).toBe('high');
    expect(v.action).toBe('block_confirm');
    expect(v.reasons.some((r) => r.code === 'reported_address')).toBe(true);
  });

  it('flags balance-draining amounts as high', () => {
    const xdr = xdrFor({ dest: NORMAL_DEST, amount: '99', funded: true });
    const v = scan({ xdr, networkPassphrase: pp, context: { network: 'TESTNET', fromAddress: SOURCE, destinationFunded: true, spendableXlm: '100' } });
    expect(v.risk).toBe('high');
    expect(v.reasons.some((r) => r.code === 'drains_balance')).toBe(true);
  });

  it('flags scam language in the memo', () => {
    const xdr = xdrFor({ dest: NORMAL_DEST, amount: '5', funded: true, memo: 'verify your seed' });
    const v = scan({ xdr, networkPassphrase: pp, context: { network: 'TESTNET', fromAddress: SOURCE, destinationFunded: true, spendableXlm: '1000' } });
    expect(v.reasons.some((r) => r.code === 'memo_language')).toBe(true);
    expect(v.risk).toBe('high');
  });

  it('honors the demo forceScenario override', () => {
    const xdr = xdrFor({ dest: NORMAL_DEST, amount: '1', funded: true });
    const v = scan({ xdr, networkPassphrase: pp, context: { network: 'TESTNET', fromAddress: SOURCE, forceScenario: 'high' } });
    expect(v.action).toBe('block_confirm');
  });

  it('provides sample verdicts for the demo gallery', () => {
    expect(sampleVerdict('low').action).toBe('allow');
    expect(sampleVerdict('medium').action).toBe('warn');
    expect(sampleVerdict('high').action).toBe('block_confirm');
  });
});

describe('paste-to-check (mock)', () => {
  it('treats a seed-phrase request as high risk', () => {
    const v = analyzeMessage('Send me your 12-word recovery phrase to restore your wallet');
    expect(v.risk).toBe('high');
    expect(v.reasons.some((r) => r.code === 'seed_request')).toBe(true);
    expect(v.whatToDo).toMatch(/never share/i);
  });

  it('treats a doubling giveaway as high risk', () => {
    const v = analyzeMessage('Official giveaway! Send 100 XLM and get double back instantly');
    expect(v.risk).toBe('high');
  });

  it('treats a benign message as low risk', () => {
    const v = analyzeMessage('hey, are we still on for lunch tomorrow?');
    expect(v.risk).toBe('low');
    expect(v.reasons).toHaveLength(0);
  });

  it('escalates a single medium signal to tier 2', () => {
    const v = analyzeMessage('Your account is locked, act immediately');
    expect(v.risk).toBe('medium');
    expect(v.tier).toBe(2);
  });
});
