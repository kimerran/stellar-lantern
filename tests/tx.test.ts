import { describe, it, expect } from 'vitest';
import { Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { buildSetOptionsXdr, buildTransferXdr, computeMaxXlm, memoByteLength } from '@core/stellar/tx';
import { decodeTransaction } from '@core/scan/decode';

const SOURCE = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const DEST = 'GBK4XQYHX7K3X2R7L4K4Z2K3X2R7L4K4Z2K3X2R7L4K4Z2K3X2R7L4K4'; // placeholder
const DEST_VALID = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const GUARDIAN = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';

const common = {
  sourceAccountId: SOURCE,
  sourceSequence: '1',
  networkPassphrase: Networks.TESTNET,
  baseFee: '100',
};

function firstOpType(xdr: string): string {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  // @ts-expect-error operations exist on Transaction
  return tx.operations[0].type;
}

describe('buildTransferXdr', () => {
  it('uses createAccount for XLM to a non-existent destination', () => {
    const xdr = buildTransferXdr({
      ...common,
      destination: DEST_VALID,
      destinationFunded: false,
      asset: { isNative: true },
      amount: '5',
    });
    expect(firstOpType(xdr)).toBe('createAccount');
  });

  it('uses payment for XLM to an existing destination', () => {
    const xdr = buildTransferXdr({
      ...common,
      destination: DEST_VALID,
      destinationFunded: true,
      asset: { isNative: true },
      amount: '5',
    });
    expect(firstOpType(xdr)).toBe('payment');
  });

  it('rejects an over-long memo', () => {
    expect(() =>
      buildTransferXdr({
        ...common,
        destination: DEST_VALID,
        destinationFunded: true,
        asset: { isNative: true },
        amount: '1',
        memo: 'x'.repeat(29),
      }),
    ).toThrow();
  });

  it('counts memo bytes (not characters)', () => {
    expect(memoByteLength('hello')).toBe(5);
    expect(memoByteLength('héllo')).toBe(6); // é is 2 bytes in UTF-8
  });
});

describe('buildSetOptionsXdr', () => {
  const opts = { ...common };

  it('adds a guardian signer (round-trips through the scan decode)', () => {
    const xdr = buildSetOptionsXdr({ ...opts, signer: { ed25519PublicKey: GUARDIAN, weight: 1 } });
    const op = decodeTransaction(xdr, Networks.TESTNET)?.operations[0];
    expect(op?.type).toBe('setOptions');
    expect(op?.signerKey).toBe(GUARDIAN);
    expect(op?.signerWeight).toBe(1);
  });

  it('removes a signer with weight 0', () => {
    const xdr = buildSetOptionsXdr({ ...opts, signer: { ed25519PublicKey: GUARDIAN, weight: 0 } });
    const op = decodeTransaction(xdr, Networks.TESTNET)?.operations[0];
    expect(op?.signerWeight).toBe(0);
  });

  it('sets thresholds and master weight, emitting only the changed fields', () => {
    const xdr = buildSetOptionsXdr({ ...opts, masterWeight: 1, lowThreshold: 1, medThreshold: 2, highThreshold: 2 });
    const op = decodeTransaction(xdr, Networks.TESTNET)?.operations[0];
    expect(op).toMatchObject({ masterWeight: 1, lowThreshold: 1, medThreshold: 2, highThreshold: 2 });
    // A field we didn't set must stay unset (not silently zeroed).
    expect(op?.signerKey).toBeUndefined();
  });

  it('throws when no signer or threshold change is requested', () => {
    expect(() => buildSetOptionsXdr({ ...opts })).toThrow(/at least one/i);
  });

  it('rejects an out-of-range weight', () => {
    expect(() => buildSetOptionsXdr({ ...opts, signer: { ed25519PublicKey: GUARDIAN, weight: 300 } })).toThrow(/255/);
    expect(() => buildSetOptionsXdr({ ...opts, highThreshold: -1 })).toThrow(/between/i);
  });
});

describe('computeMaxXlm', () => {
  it('subtracts the base reserve (2 entries) and fee buffer', () => {
    // balance 10, no subentries: 10 - 0.5*2 - 0.001 = 8.999
    expect(computeMaxXlm('10', 0)).toBe('8.999');
  });

  it('accounts for subentries', () => {
    // balance 10, 2 subentries: 10 - 0.5*4 - 0.001 = 7.999
    expect(computeMaxXlm('10', 2)).toBe('7.999');
  });

  it('clamps to 0 when below reserve', () => {
    expect(computeMaxXlm('0.5', 0)).toBe('0');
  });
});

// keep DEST referenced to avoid unused-var lint in case of edits
void DEST;
