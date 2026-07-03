import { describe, it, expect } from 'vitest';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  buildGuardianSetupXdr,
  buildRecoveryXdr,
  collectedSignatureWeight,
  hasThresholdSignatures,
  mergeGuardianSignatures,
  describeGuardianSetup,
  classifyGuardianConfig,
} from '@core/recovery/guardians';
import { totalFeeXlm } from '@core/stellar/tx';
import { decodeTransaction } from '@core/scan/decode';
import { scan } from '@core/scan/engine';
import { explainTransaction } from '@core/scan/explainer';

const SOURCE = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const NEW_KEY = 'GBVG3DQJNAYAPTB4FKPLL65BUNF76K2TKPTK72LDIAJKRATGRY5BFJBP';
const G1 = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const G2 = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const G3 = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const G4 = 'GAIXZJSGJM7HWMEVNED4KXVPOBVHAQBXFP572VP45VOFJF5PCE3F62SA';
const G5 = 'GBSN3H3V3FNFZEMOOUICZXJFY6BP6CI5NMERSJENKDDK35HLSOR7X2EB';
const pp = Networks.TESTNET;

const common = {
  sourceAccountId: SOURCE,
  sourceSequence: '1',
  networkPassphrase: pp,
  baseFee: '100',
};

describe('buildGuardianSetupXdr', () => {
  it('adds each guardian (weight 1) then sets owner-only low/med + K high threshold', () => {
    const xdr = buildGuardianSetupXdr({ ...common, guardians: [G1, G2, G3], threshold: 2 });
    const ops = decodeTransaction(xdr, pp)?.operations ?? [];

    // 3 guardian ops + 1 threshold op.
    expect(ops).toHaveLength(4);
    expect(ops.slice(0, 3).map((o) => o.signerKey)).toEqual([G1, G2, G3]);
    expect(ops.slice(0, 3).every((o) => o.type === 'setOptions' && o.signerWeight === 1)).toBe(true);

    // ownerWeight = N+1 = 4 for low/med (owner-only) and highThreshold = K = 2.
    expect(ops[3]).toMatchObject({
      type: 'setOptions',
      masterWeight: 4,
      lowThreshold: 4,
      medThreshold: 4,
      highThreshold: 2,
    });
  });

  it('keeps guardians below the payment (medium) threshold — they can recover, not spend', () => {
    // The on-chain authorization invariant: Payment/offers/trustlines use the
    // MEDIUM threshold; a signer setOptions uses HIGH. K guardians must clear
    // HIGH (recovery) but never MEDIUM (spending). Guardians' combined weight is
    // exactly guardians.length (weight 1 each).
    for (const [n, k] of [[3, 2], [5, 3], [1, 1]] as const) {
      const guardians = [G1, G2, G3, G4, G5].slice(0, n);
      const ops = decodeTransaction(buildGuardianSetupXdr({ ...common, guardians, threshold: k }), pp)?.operations ?? [];
      const t = ops[ops.length - 1]!;
      const guardiansCombined = n; // weight 1 each
      // K guardians CAN meet high (recovery setOptions):
      expect(t.highThreshold).toBe(k);
      expect(guardiansCombined).toBeGreaterThanOrEqual(k);
      // …but ALL guardians together still can't meet medium (a payment) or low:
      expect(t.medThreshold!).toBeGreaterThan(guardiansCombined);
      expect(t.lowThreshold!).toBeGreaterThan(guardiansCombined);
      // …and the owner alone meets everything:
      expect(t.masterWeight!).toBeGreaterThanOrEqual(t.medThreshold!);
      expect(t.masterWeight!).toBeGreaterThanOrEqual(t.highThreshold!);
    }
  });

  it('supports a single guardian with threshold 1', () => {
    const xdr = buildGuardianSetupXdr({ ...common, guardians: [G1], threshold: 1 });
    const ops = decodeTransaction(xdr, pp)?.operations ?? [];
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ signerKey: G1, signerWeight: 1 });
    // ownerWeight = N+1 = 2 for low/med; highThreshold = K = 1.
    expect(ops[1]).toMatchObject({ masterWeight: 2, lowThreshold: 2, medThreshold: 2, highThreshold: 1 });
  });

  it('is flagged high-risk (account control change) by the scanner', () => {
    const xdr = buildGuardianSetupXdr({ ...common, guardians: [G1, G2, G3], threshold: 2 });
    const v = scan({ xdr, networkPassphrase: pp, context: { network: 'TESTNET', fromAddress: SOURCE } });
    expect(v.risk).toBe('high');
    expect(v.action).toBe('block_confirm');
    expect(v.reasons.some((r) => r.code === 'account_control_change')).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(() => buildGuardianSetupXdr({ ...common, guardians: [], threshold: 1 })).toThrow(/at least one/i);
    expect(() => buildGuardianSetupXdr({ ...common, guardians: [G1], threshold: 0 })).toThrow(/positive/i);
    expect(() => buildGuardianSetupXdr({ ...common, guardians: [G1, G2], threshold: 3 })).toThrow(/exceed/i);
    expect(() => buildGuardianSetupXdr({ ...common, guardians: ['not-a-key'], threshold: 1 })).toThrow(/invalid guardian/i);
    expect(() => buildGuardianSetupXdr({ ...common, guardians: [SOURCE], threshold: 1 })).toThrow(/cannot be the account/i);
    expect(() => buildGuardianSetupXdr({ ...common, guardians: [G1, G1], threshold: 1 })).toThrow(/duplicate/i);
  });

  it('caps guardians at 19 so a recovery signer slot is always reserved', () => {
    const twenty = Array.from({ length: 20 }, () => Keypair.random().publicKey());
    expect(() => buildGuardianSetupXdr({ ...common, guardians: twenty, threshold: 2 })).toThrow(/at most 19|reserved/i);
  });
});

describe('buildRecoveryXdr', () => {
  it('installs the new key at owner weight (N+1) and disables the lost master, in one op', () => {
    const ops = decodeTransaction(buildRecoveryXdr({ ...common, newSignerKey: NEW_KEY, guardianCount: 3 }), pp)?.operations ?? [];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: 'setOptions',
      signerKey: NEW_KEY,
      signerWeight: 4, // N+1, mirrors the setup so the new key operates normally
      masterWeight: 0, // lost master key disabled
    });
  });

  it('is scanned high-risk and explained as installing a signer + removing the old key', () => {
    const xdr = buildRecoveryXdr({ ...common, newSignerKey: NEW_KEY, guardianCount: 3 });
    const v = scan({ xdr, networkPassphrase: pp, context: { network: 'TESTNET', fromAddress: SOURCE } });
    expect(v.risk).toBe('high');
    expect(v.action).toBe('block_confirm');
    const explanation = explainTransaction(decodeTransaction(xdr, pp));
    expect(explanation).toMatch(/adds signer/i);
    expect(explanation).toMatch(/removes your own key.{0,3}s signing power/i);
  });

  it('rejects malformed input', () => {
    expect(() => buildRecoveryXdr({ ...common, newSignerKey: 'nope', guardianCount: 3 })).toThrow(/invalid new signer/i);
    expect(() => buildRecoveryXdr({ ...common, newSignerKey: SOURCE, guardianCount: 3 })).toThrow(/cannot be the account/i);
    expect(() => buildRecoveryXdr({ ...common, newSignerKey: NEW_KEY, guardianCount: 0 })).toThrow(/positive/i);
    expect(() => buildRecoveryXdr({ ...common, newSignerKey: NEW_KEY, guardianCount: 20 })).toThrow(/20-signer limit/i);
  });

  it('the max allowed setup (19 guardians) is always recoverable — the headroom guarantee', () => {
    const nineteen = Array.from({ length: 19 }, () => Keypair.random().publicKey());
    // Setup accepts exactly 19…
    expect(() => buildGuardianSetupXdr({ ...common, guardians: nineteen, threshold: 10 })).not.toThrow();
    // …and recovery for that same N=19 account stays within the signer limit.
    expect(() => buildRecoveryXdr({ ...common, newSignerKey: NEW_KEY, guardianCount: 19 })).not.toThrow();
  });
});

describe('collectedSignatureWeight / hasThresholdSignatures', () => {
  // Three guardian keypairs (weight 1 each) on a recovery tx.
  const g = [Keypair.random(), Keypair.random(), Keypair.random()];
  const signers = g.map((k) => ({ key: k.publicKey(), weight: 1 }));

  function recoverySignedBy(...keys: Keypair[]): string {
    const xdr = buildRecoveryXdr({ ...common, newSignerKey: NEW_KEY, guardianCount: 3 });
    const tx = TransactionBuilder.fromXDR(xdr, pp);
    if (keys.length) tx.sign(...keys);
    return tx.toXDR();
  }

  it('sums the weight of the guardians who actually signed', () => {
    expect(collectedSignatureWeight(recoverySignedBy(), pp, signers)).toBe(0);
    expect(collectedSignatureWeight(recoverySignedBy(g[0]!), pp, signers)).toBe(1);
    expect(collectedSignatureWeight(recoverySignedBy(g[0]!, g[1]!), pp, signers)).toBe(2);
  });

  it('ignores signatures from keys not in the signer set', () => {
    const stranger = Keypair.random();
    // g0 + a stranger sign; only g0 is a known signer, so weight stays 1.
    expect(collectedSignatureWeight(recoverySignedBy(g[0]!, stranger), pp, signers)).toBe(1);
  });

  it('honors per-signer weights', () => {
    const weighted = g.map((k) => ({ key: k.publicKey(), weight: 3 }));
    expect(collectedSignatureWeight(recoverySignedBy(g[0]!, g[1]!), pp, weighted)).toBe(6);
  });

  it('reaches the threshold once K guardians have co-signed', () => {
    expect(hasThresholdSignatures(recoverySignedBy(g[0]!), pp, signers, 2)).toBe(false);
    expect(hasThresholdSignatures(recoverySignedBy(g[0]!, g[1]!), pp, signers, 2)).toBe(true);
    expect(hasThresholdSignatures(recoverySignedBy(g[0]!, g[1]!, g[2]!), pp, signers, 2)).toBe(true);
  });
});

describe('totalFeeXlm (multi-op fee shown on the setup review)', () => {
  // The setup tx has N+1 ops, so the total fee is baseFee(100) × (N+1), NOT
  // baseFee alone — the review screen must show the real total. (Regression for
  // the (N+1)× fee understatement bug.)
  it('scales the displayed fee with the operation count', () => {
    const three = buildGuardianSetupXdr({ ...common, guardians: [G1, G2, G3], threshold: 2 });
    expect(totalFeeXlm(three, pp)).toBe('0.00004'); // 4 ops × 100 stroops
    const one = buildGuardianSetupXdr({ ...common, guardians: [G1], threshold: 1 });
    expect(totalFeeXlm(one, pp)).toBe('0.00002'); // 2 ops × 100 stroops
  });
});

describe('classifyGuardianConfig', () => {
  it('reads guardians (non-master signers) + recovery threshold from account state', () => {
    const cfg = classifyGuardianConfig(
      SOURCE,
      [
        { key: SOURCE, weight: 3 }, // the master key
        { key: G1, weight: 1 },
        { key: G2, weight: 1 },
        { key: G3, weight: 1 },
      ],
      { low: 3, med: 3, high: 2 },
    );
    expect(cfg.isRecoveryEnabled).toBe(true);
    expect(cfg.masterWeight).toBe(3);
    expect(cfg.recoveryThreshold).toBe(2);
    expect(cfg.guardians.map((g) => g.key)).toEqual([G1, G2, G3]);
  });

  it('reports no recovery when the account has only its master key', () => {
    const cfg = classifyGuardianConfig(SOURCE, [{ key: SOURCE, weight: 1 }], { low: 0, med: 0, high: 0 });
    expect(cfg.isRecoveryEnabled).toBe(false);
    expect(cfg.guardians).toEqual([]);
    expect(cfg.masterWeight).toBe(1);
  });
});

describe('mergeGuardianSignatures', () => {
  const gk = [Keypair.random(), Keypair.random(), Keypair.random()];
  const signers = gk.map((k) => ({ key: k.publicKey(), weight: 1 }));
  // One shared recovery XDR that every guardian signs a copy of.
  const shared = buildRecoveryXdr({ ...common, newSignerKey: NEW_KEY, guardianCount: 3 });

  function signedCopy(k: Keypair, xdr = shared): string {
    const t = TransactionBuilder.fromXDR(xdr, pp);
    t.sign(k);
    return t.toXDR();
  }

  it('combines separate guardian signatures onto the shared tx (composes with the tally)', () => {
    const merged = mergeGuardianSignatures(shared, [signedCopy(gk[0]!), signedCopy(gk[1]!)], pp);
    expect(TransactionBuilder.fromXDR(merged, pp).signatures).toHaveLength(2);
    expect(collectedSignatureWeight(merged, pp, signers)).toBe(2);
  });

  it('ignores duplicate signatures', () => {
    const one = signedCopy(gk[0]!);
    const merged = mergeGuardianSignatures(shared, [one, one], pp);
    expect(TransactionBuilder.fromXDR(merged, pp).signatures).toHaveLength(1);
  });

  it('rejects a signature for a different transaction', () => {
    const otherXdr = buildRecoveryXdr({ ...common, newSignerKey: G1, guardianCount: 3 });
    expect(() => mergeGuardianSignatures(shared, [signedCopy(gk[0]!, otherXdr)], pp)).toThrow(/different transaction/i);
  });

  it('returns the base unchanged when there is nothing to merge', () => {
    expect(TransactionBuilder.fromXDR(mergeGuardianSignatures(shared, [], pp), pp).signatures).toHaveLength(0);
  });
});

describe('describeGuardianSetup', () => {
  it('describes a K-of-N quorum', () => {
    expect(describeGuardianSetup(3, 2)).toMatch(/Any 2 of your 3 guardians can help you recover/i);
  });
  it('describes an all-guardians quorum', () => {
    expect(describeGuardianSetup(3, 3)).toMatch(/All 3 guardians can help you recover/i);
  });
  it('handles a single guardian', () => {
    expect(describeGuardianSetup(1, 1)).toMatch(/Your 1 guardian can help you recover/i);
  });
  it('returns empty for an invalid/incomplete selection', () => {
    expect(describeGuardianSetup(0, 1)).toBe('');
    expect(describeGuardianSetup(2, 3)).toBe(''); // threshold > guardians
  });
});
