import { Account, BASE_FEE, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { isValidPublicKey } from '@core/wallet/wallet';

// Guardian social recovery — builds the on-chain weighted-multisig setup
// transaction (#23, Milestone 1). Pure: no network, no signing (that runs
// through SIGN_ONLY in the worker). The result is exactly the kind of
// high-impact setOptions change the scanner already flags `high` (see
// core/scan), so it is reviewed + confirmed before signing.

export interface BuildGuardianSetupParams {
  sourceAccountId: string;
  sourceSequence: string;
  networkPassphrase: string;
  baseFee: string; // stroops, as string
  guardians: string[]; // distinct guardian account keys (G…)
  threshold: number; // K — how many guardians are required to recover
  timeoutSecs?: number;
}

// Max signers Stellar allows on an account (the master key is separate).
const MAX_GUARDIANS = 20;

// Weighting policy (documented so it can be reviewed and can't silently lock an
// account OR hand guardians spending rights). Stellar maps operation categories
// to different threshold levels — crucially **Payment/offers/trustlines use the
// MEDIUM threshold, while a signer/threshold `setOptions` uses the HIGH
// threshold**. So the two must be decoupled:
//   - each guardian is added as a signer with weight 1;
//   - the owner's master key weight and the LOW + MEDIUM thresholds are set to
//     `ownerWeight = guardians.length + 1` — strictly greater than every
//     guardian combined, so the owner alone can do everything but NO number of
//     guardians can ever authorize a payment/offer/trustline change;
//   - only the HIGH threshold is set to K, the recovery quorum.
// Result: the owner (weight N+1) keeps full solo control and is never locked out
// while their key exists; any K guardians can perform ONLY the high-threshold
// class — the `setOptions` the recovery-installation transaction needs — and can
// never quietly drain the account. Fewer than K guardians can do nothing.
//
// Note: the HIGH class also includes `accountMerge`, so K colluding guardians
// could merge the account — but that is the same "K guardians can seize the
// account" power the recovery `setOptions` inherently grants, i.e. exactly the
// trust assumption of social recovery, not an extra capability. It is Stellar's
// threshold model, not this builder, that couples them.
//
// This assumes a standard single-master-key account (the wallet's default). It
// overwrites the master weight + thresholds, so it is a first-time-setup builder,
// not an incremental editor.
export function buildGuardianSetupXdr(params: BuildGuardianSetupParams): string {
  const {
    sourceAccountId,
    sourceSequence,
    networkPassphrase,
    baseFee,
    guardians,
    threshold,
    timeoutSecs = 180,
  } = params;

  if (guardians.length === 0) throw new Error('At least one guardian is required.');
  if (guardians.length > MAX_GUARDIANS) {
    throw new Error(`At most ${MAX_GUARDIANS} guardians are supported (Stellar's signer limit).`);
  }
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error('Threshold must be a positive integer.');
  }
  if (threshold > guardians.length) {
    throw new Error('Threshold cannot exceed the number of guardians.');
  }

  const seen = new Set<string>();
  for (const g of guardians) {
    if (!isValidPublicKey(g)) throw new Error(`Invalid guardian address: ${g}`);
    if (g === sourceAccountId) throw new Error('A guardian cannot be the account itself.');
    if (seen.has(g)) throw new Error(`Duplicate guardian: ${g}`);
    seen.add(g);
  }

  // Strictly greater than all guardians combined — guardians can never reach the
  // low/medium thresholds, so they cannot pay/trade/change trustlines.
  const ownerWeight = guardians.length + 1;

  const source = new Account(sourceAccountId, sourceSequence);
  const builder = new TransactionBuilder(source, { fee: baseFee || BASE_FEE, networkPassphrase });

  // One op per guardian — setOptions sets a single signer at a time.
  for (const g of guardians) {
    builder.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: g, weight: 1 } }));
  }
  // Owner keeps solo control of everything (low/med/high all met by ownerWeight);
  // only the HIGH threshold is lowered to K so any K guardians can co-sign the
  // recovery setOptions — and nothing lower (no payments).
  builder.addOperation(
    Operation.setOptions({
      masterWeight: ownerWeight,
      lowThreshold: ownerWeight,
      medThreshold: ownerWeight,
      highThreshold: threshold,
    }),
  );

  return builder.setTimeout(timeoutSecs).build().toXDR();
}
