import { Account, BASE_FEE, Operation, TransactionBuilder, WebAuth } from '@stellar/stellar-sdk';
import { isValidPublicKey } from '@core/wallet/wallet';

// Guardian social recovery — builds the on-chain weighted-multisig transactions
// (#23, Milestone 1): the guardian *setup* and the *recovery* that installs a
// new device key. Pure: no network, no signing (that runs through SIGN_ONLY in
// the worker). Both results are exactly the kind of high-impact setOptions
// change the scanner already flags `high` (see core/scan), so they are
// reviewed + confirmed before signing.

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
const MAX_SIGNERS = 20;
// Guardians are capped one below the signer limit so a recovery can ALWAYS add
// the new device key (the last slot) without exceeding it — this guarantees the
// feature's core promise ("K guardians can always recover") by construction,
// rather than letting setup create an account that can never be recovered.
const MAX_GUARDIANS = MAX_SIGNERS - 1; // 19

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
    throw new Error(
      `At most ${MAX_GUARDIANS} guardians are supported — one signer slot is reserved so recovery can always add a new key within Stellar's ${MAX_SIGNERS}-signer limit.`,
    );
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

export interface BuildRecoveryParams {
  sourceAccountId: string; // the account being recovered (unchanged)
  sourceSequence: string;
  networkPassphrase: string;
  baseFee: string; // stroops, as string
  newSignerKey: string; // fresh device key to install (G…)
  guardianCount: number; // N — guardians the account has (read from account state)
  timeoutSecs?: number;
}

// Builds the recovery transaction (#23, Milestone 1, item 4). When the owner's
// key is lost, the new device generates a fresh keypair and drafts this tx:
// install the new key with owner-level weight and disable the lost master key,
// in a single setOptions.
//
// This is a HIGH-threshold change (signer + masterWeight), so under the
// thresholds buildGuardianSetupXdr installed (`highThreshold = K`) it is
// authorized by exactly K guardian co-signatures — each collected out-of-band
// via SIGN_ONLY (#33), no single guardian able to submit alone. It deliberately
// leaves the thresholds AND the existing guardian signers untouched, so:
//   - the new key inherits the old owner's power (weight `N+1` meets the low/med
//     thresholds the setup set, and ≥ K meets high) and operates normally;
//   - the account stays guardian-protected — the same K-of-N can recover again.
//
// Assumes a buildGuardianSetupXdr-configured account (that's where `N+1` comes
// from); the caller supplies `guardianCount` from the account's current signers.
export function buildRecoveryXdr(params: BuildRecoveryParams): string {
  const {
    sourceAccountId,
    sourceSequence,
    networkPassphrase,
    baseFee,
    newSignerKey,
    guardianCount,
    timeoutSecs = 180,
  } = params;

  if (!isValidPublicKey(newSignerKey)) throw new Error('Invalid new signer address.');
  if (newSignerKey === sourceAccountId) {
    throw new Error('The new signer cannot be the account itself.');
  }
  if (!Number.isInteger(guardianCount) || guardianCount < 1) {
    throw new Error('Guardian count must be a positive integer.');
  }
  // The recovery adds one signer; with N guardian signers already present it must
  // stay within Stellar's signer limit. Setup caps N at MAX_GUARDIANS precisely
  // to guarantee this always holds, but validate defensively regardless.
  if (guardianCount > MAX_GUARDIANS) {
    throw new Error(`Too many guardians to add a new signer within Stellar's ${MAX_SIGNERS}-signer limit.`);
  }

  // Mirror the setup: the new key gets the same owner-level weight (N+1) so it
  // meets the low/med thresholds the setup installed and operates normally.
  const ownerWeight = guardianCount + 1;

  const source = new Account(sourceAccountId, sourceSequence);
  return new TransactionBuilder(source, { fee: baseFee || BASE_FEE, networkPassphrase })
    .addOperation(
      Operation.setOptions({
        signer: { ed25519PublicKey: newSignerKey, weight: ownerWeight },
        masterWeight: 0, // disable the lost master key
      }),
    )
    .setTimeout(timeoutSecs)
    .build()
    .toXDR();
}

export interface WeightedSigner {
  key: string; // signer account key (G…)
  weight: number;
}

// How much signature weight a (partially-)signed recovery transaction has
// collected, given the account's signers and their weights. The recovery
// coordination flow (#23 M1, item 4) uses this to know when enough guardians
// have co-signed — via SIGN_ONLY (#33), out-of-band — to submit. Pure: no
// network. Only signatures from the provided signers count; any unknown/extra
// signature is ignored, so a stray signature can't inflate the tally.
export function collectedSignatureWeight(
  xdr: string,
  networkPassphrase: string,
  signers: WeightedSigner[],
): number {
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  const signed = new Set(WebAuth.gatherTxSigners(tx, signers.map((s) => s.key)));
  return signers.reduce((sum, s) => (signed.has(s.key) ? sum + s.weight : sum), 0);
}

// Whether a (partially-)signed recovery tx has reached the weight required to
// submit — the account's HIGH threshold for a setOptions recovery (= K).
export function hasThresholdSignatures(
  xdr: string,
  networkPassphrase: string,
  signers: WeightedSigner[],
  requiredThreshold: number,
): boolean {
  return collectedSignatureWeight(xdr, networkPassphrase, signers) >= requiredThreshold;
}
