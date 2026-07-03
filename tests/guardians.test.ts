import { describe, it, expect } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { buildGuardianSetupXdr } from '@core/recovery/guardians';
import { decodeTransaction } from '@core/scan/decode';
import { scan } from '@core/scan/engine';

const SOURCE = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
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
});
