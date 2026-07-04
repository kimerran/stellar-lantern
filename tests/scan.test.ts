import { describe, it, expect } from 'vitest';
import { Account, Contract, nativeToScVal, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
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

// Build an unsigned setOptions XDR directly via the SDK (there is no
// buildSetOptions helper in core yet — the guardian-recovery flow that adds one
// is the rest of #23; this issue only teaches the scanner to *read* it).
function setOptionsXdr(opts: Parameters<typeof Operation.setOptions>[0]): string {
  const source = new Account(SOURCE, '1');
  return new TransactionBuilder(source, { fee: '100', networkPassphrase: pp })
    .addOperation(Operation.setOptions(opts))
    .setTimeout(180)
    .build()
    .toXDR();
}

// A valid Testnet contract id + an unsigned Soroban invoke XDR. No live network
// — just exercises the decode path (the real Blend supply flow is the rest of
// #21; this issue only teaches the scanner to *read* which function it calls).
const SAMPLE_CID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';
function invokeXdr(fn: string): string {
  const source = new Account(SOURCE, '1');
  const op = new Contract(SAMPLE_CID).call(fn, nativeToScVal(1, { type: 'i128' }));
  return new TransactionBuilder(source, { fee: '100', networkPassphrase: pp })
    .addOperation(op)
    .setTimeout(180)
    .build()
    .toXDR();
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

  it('decodes a setOptions signer add and names the signer + weight in the explanation', () => {
    const xdr = setOptionsXdr({ signer: { ed25519PublicKey: NORMAL_DEST, weight: 1 } });
    const decoded = decodeTransaction(xdr, pp);
    const op = decoded?.operations[0];
    expect(op?.type).toBe('setOptions');
    expect(op?.signerKey).toBe(NORMAL_DEST);
    expect(op?.signerWeight).toBe(1);
    // Specific plain-language wording (spec #23): who + weight, truncated key.
    expect(explainTransaction(decoded)).toMatch(/adds signer GDVE.{0,3}ZA57 with weight 1/i);
  });

  it('explains a signer removal (weight 0) as a removal', () => {
    const xdr = setOptionsXdr({ signer: { ed25519PublicKey: NORMAL_DEST, weight: 0 } });
    expect(explainTransaction(decodeTransaction(xdr, pp))).toMatch(/removes signer GDVE.{0,3}ZA57/i);
  });

  it('explains a threshold change with the specific values', () => {
    const xdr = setOptionsXdr({ lowThreshold: 1, medThreshold: 2, highThreshold: 2 });
    expect(explainTransaction(decodeTransaction(xdr, pp))).toMatch(
      /signing thresholds \(low 1, medium 2, high 2\)/i,
    );
  });

  it('preserves masterWeight 0 and explains it as removing signing power', () => {
    const xdr = setOptionsXdr({ masterWeight: 0 });
    const decoded = decodeTransaction(xdr, pp);
    expect(decoded?.operations[0]?.masterWeight).toBe(0);
    expect(explainTransaction(decoded)).toMatch(/removes your own key.{0,3}s signing power/i);
  });

  it('decodes a Soroban invoke: contract id, function name, and names it in the explanation', () => {
    const decoded = decodeTransaction(invokeXdr('supply'), pp);
    const op = decoded?.operations[0];
    expect(op?.type).toBe('invokeHostFunction');
    expect(decoded?.isSoroban).toBe(true);
    expect(op?.contractId).toBe(SAMPLE_CID);
    expect(op?.contractFunction).toBe('supply');
    expect(explainTransaction(decoded)).toMatch(/calls .*supply.* on a smart contract/i);
  });

  it('leads a known DeFi call (supply) with a friendly action and still names the function', () => {
    const explanation = explainTransaction(decodeTransaction(invokeXdr('supply'), pp));
    expect(explanation).toMatch(/^Deposits funds into a lending pool/);
    // Still spells out the raw function name + that it's a contract call.
    expect(explanation).toMatch(/calls .*supply.* on a smart contract/i);
  });

  it('matches DeFi function names case-insensitively', () => {
    const explanation = explainTransaction(decodeTransaction(invokeXdr('WITHDRAW'), pp));
    expect(explanation).toMatch(/^Withdraws funds from a lending pool/);
    expect(explanation).toMatch(/calls .*WITHDRAW.* on a smart contract/i);
  });

  it('keeps the generic wording for an unrecognized contract function (no regression)', () => {
    const explanation = explainTransaction(decodeTransaction(invokeXdr('frobnicate'), pp));
    expect(explanation).toMatch(
      /^This calls .*frobnicate.* on a smart contract.* that may move funds or change permissions/i,
    );
    expect(explanation).not.toMatch(/lending pool/i);
  });

  it('uses the generic Soroban fallback when there is no invoked function name', () => {
    const decoded = {
      operations: [{ type: 'invokeHostFunction' as const }],
      isSoroban: true,
    };
    expect(explainTransaction(decoded)).toMatch(
      /smart contract move funds or change permissions/i,
    );
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

  it('blocks adding a signer (account-control change) as high', () => {
    const xdr = setOptionsXdr({ signer: { ed25519PublicKey: NORMAL_DEST, weight: 1 } });
    const v = scan({ xdr, networkPassphrase: pp, context: { network: 'TESTNET', fromAddress: SOURCE } });
    expect(v.risk).toBe('high');
    expect(v.action).toBe('block_confirm');
    expect(v.reasons.some((r) => r.code === 'account_control_change')).toBe(true);
  });

  it('blocks a threshold change as high', () => {
    const xdr = setOptionsXdr({ highThreshold: 2, medThreshold: 2, lowThreshold: 1 });
    const v = scan({ xdr, networkPassphrase: pp, context: { network: 'TESTNET', fromAddress: SOURCE } });
    expect(v.risk).toBe('high');
    expect(v.reasons.some((r) => r.code === 'account_control_change')).toBe(true);
  });

  it('escalates masterWeight 0 to a "gives up control" warning', () => {
    const xdr = setOptionsXdr({ masterWeight: 0 });
    const v = scan({ xdr, networkPassphrase: pp, context: { network: 'TESTNET', fromAddress: SOURCE } });
    expect(v.risk).toBe('high');
    const reason = v.reasons.find((r) => r.code === 'account_control_change');
    expect(reason?.title).toMatch(/gives up/i);
  });

  it('does not flag a home-domain-only setOptions', () => {
    const xdr = setOptionsXdr({ homeDomain: 'example.com' });
    const v = scan({ xdr, networkPassphrase: pp, context: { network: 'TESTNET', fromAddress: SOURCE } });
    expect(v.reasons.some((r) => r.code === 'account_control_change')).toBe(false);
    expect(v.risk).toBe('low');
  });

  it('flags a Soroban contract call as medium and names the function it calls', () => {
    const v = scan({ xdr: invokeXdr('supply'), networkPassphrase: pp, context: { network: 'TESTNET', fromAddress: SOURCE } });
    expect(v.risk).toBe('medium');
    expect(v.tier).toBe(2); // uncertain contract call escalates to (mock) Tier 2
    const reason = v.reasons.find((r) => r.code === 'contract_call');
    expect(reason?.detail).toMatch(/supply/);
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
