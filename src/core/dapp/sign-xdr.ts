import { FeeBumpTransaction, Keypair, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import { decodeTransaction, signingRequirements, type SigningRequirements } from '@lantern/scanner';
import type { NetworkId } from '@shared/constants';
import type { Result } from '@shared/messages';
import type { WalletScanInput } from '@core/scan/wallet';

// Signing a transaction a dApp built (#262), without submitting it.
//
// The mini-app bridge's `lantern:signXdr` (src/core/miniapps/bridge.ts) and
// web connect's `signTransaction` (#252) both hand Lantern a finished
// envelope — possibly already signed by someone else, e.g. Centient's sponsor
// — and want it back with the user's signature added. The protocol around it
// differs; this core does not:
//
//   validateSignXdr  → reject before any review (pure, no I/O)
//   signXdrScanInput → what the scanner is asked about it
//   signXdrWith      → SIGN_ONLY, then check the envelope we hand back
//
// Rejected before review, deliberately:
//   - a `networkPassphrase` other than the active network: the signature is
//     over a hash that includes the passphrase, so signing "for" another
//     network would sign a transaction the user never reviewed on this one;
//   - XDR that doesn't decode as a transaction envelope;
//   - a fee-bump envelope. Its signature hash is the OUTER transaction, which
//     the fee source signs; an op source (the user, in a sponsored setup)
//     signs the inner one. The scanner only decodes the inner transaction and
//     does not model the fee source, so the review could not say what our
//     signature on the wrapper would authorize. A dApp sends the inner
//     transaction and wraps it after we return it;
//   - a transaction that needs no signature from the user (not the source,
//     no op acts for them): signing would only add an extra signature, which
//     the network rejects (tx_bad_auth_extra).

// A generous ceiling: the largest classic envelope (100 ops, 20 signatures)
// is well under this, and a Soroban one with a big footprint too.
export const MAX_SIGN_XDR_LENGTH = 200_000;

export type SignXdrErrorCode =
  | 'invalid_request'
  | 'network_mismatch'
  | 'bad_xdr'
  | 'fee_bump'
  | 'not_a_signer';

export interface ValidSignXdr {
  xdr: string;
  networkPassphrase: string;
  // Who signs which op (the scanner's #261 helper), for the user.
  signing: SigningRequirements;
  operationCount: number;
  // Total fee in stroops, paid by `signing.txSource`.
  fee: string;
  // How many signatures the envelope already carries (e.g. the sponsor's).
  existingSignatures: number;
}

export type SignXdrValidation =
  | { ok: true; value: ValidSignXdr }
  | { ok: false; code: SignXdrErrorCode; error: string };

const fail = (code: SignXdrErrorCode, error: string): SignXdrValidation => ({ ok: false, code, error });

/**
 * Validate an untrusted request to sign `xdr` for `address` on the network
 * with `activePassphrase`. Pure — no network, no clock.
 */
export function validateSignXdr(
  request: { xdr?: unknown; networkPassphrase?: unknown },
  active: { networkPassphrase: string; address: string },
): SignXdrValidation {
  const { xdr, networkPassphrase } = request;
  if (typeof xdr !== 'string' || xdr.trim() === '' || xdr.length > MAX_SIGN_XDR_LENGTH) {
    return fail('invalid_request', 'Missing or invalid transaction XDR.');
  }
  if (typeof networkPassphrase !== 'string' || networkPassphrase === '') {
    return fail('invalid_request', 'Missing network passphrase.');
  }
  if (networkPassphrase !== active.networkPassphrase) {
    return fail(
      'network_mismatch',
      'This transaction is for a different network than the one Lantern is on. Switch networks in Lantern and try again.',
    );
  }
  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXDR(xdr.trim(), networkPassphrase);
  } catch {
    return fail('bad_xdr', 'The transaction could not be read.');
  }
  if (tx instanceof FeeBumpTransaction) {
    return fail('fee_bump', 'Fee-bump transactions are not supported. Send the inner transaction instead.');
  }
  const decoded = decodeTransaction(xdr.trim(), networkPassphrase);
  if (!decoded) return fail('bad_xdr', 'The transaction could not be read.');
  if (decoded.operations.length === 0) return fail('bad_xdr', 'The transaction has no operations.');
  const signing = signingRequirements(decoded, active.address);
  if (!signing.userIsTxSource && signing.userOps.length === 0) {
    return fail('not_a_signer', 'This transaction doesn’t need a signature from your account.');
  }
  return {
    ok: true,
    value: {
      xdr: xdr.trim(),
      networkPassphrase,
      signing,
      operationCount: decoded.operations.length,
      fee: tx.fee,
      existingSignatures: tx.signatures.length,
    },
  };
}

/**
 * The scanner input for a dApp-built transaction. No `destinationFunded` /
 * `spendableXlm`: those describe a payment the wallet built, and the user's
 * own account may not exist yet (a sponsored setup creates it) — nothing here
 * looks the account up, so a brand-new 0-XLM wallet scans and re-checks like
 * any other (#121 / #262).
 */
export function signXdrScanInput(
  v: ValidSignXdr,
  ctx: { network: NetworkId; address: string; rpcUrl?: string; origin?: string },
): WalletScanInput {
  return {
    xdr: v.xdr,
    networkPassphrase: v.networkPassphrase,
    ...(ctx.rpcUrl ? { rpcUrl: ctx.rpcUrl } : {}),
    context: { network: ctx.network, fromAddress: ctx.address, ...(ctx.origin ? { origin: ctx.origin } : {}) },
  };
}

type SignOnly = (req: {
  type: 'SIGN_ONLY';
  xdr: string;
  networkPassphrase: string;
}) => Promise<Result<{ signedXdr: string }>>;

const sigKey = (s: { hint(): Buffer; signature(): Buffer }) =>
  `${s.hint().toString('hex')}:${s.signature().toString('hex')}`;

/**
 * Add the user's signature through SIGN_ONLY (never submits), then check what
 * we hand back: every signature the envelope already had is still there, the
 * transaction itself is unchanged, and a signature by `address` over its hash
 * was added.
 */
export async function signXdrWith(
  send: SignOnly,
  v: Pick<ValidSignXdr, 'xdr' | 'networkPassphrase'>,
  address: string,
): Promise<Result<{ signedXdr: string }>> {
  const res = await send({ type: 'SIGN_ONLY', xdr: v.xdr, networkPassphrase: v.networkPassphrase });
  if (!res.ok) return res;
  const problem = checkSigned(v.xdr, res.data.signedXdr, v.networkPassphrase, address);
  if (problem) return { ok: false, error: problem };
  return res;
}

/** Why `signed` is not `original` plus the user's signature, or null. */
export function checkSigned(
  original: string,
  signed: string,
  networkPassphrase: string,
  address: string,
): string | null {
  try {
    const before = TransactionBuilder.fromXDR(original, networkPassphrase);
    const after = TransactionBuilder.fromXDR(signed, networkPassphrase);
    if (!after.hash().equals(before.hash())) return 'The signed transaction does not match the one reviewed.';
    const had = new Set(before.signatures.map(sigKey));
    const now = new Set(after.signatures.map(sigKey));
    for (const k of had) if (!now.has(k)) return 'An existing signature was lost while signing.';
    const kp = Keypair.fromPublicKey(address);
    const ours = after.signatures.some(
      (s) => s.hint().equals(kp.signatureHint()) && kp.verify(after.hash(), s.signature()),
    );
    return ours ? null : 'The wallet’s signature is missing from the signed transaction.';
  } catch {
    return 'The signed transaction could not be read.';
  }
}
