import {
  Account,
  Asset,
  BASE_FEE,
  Memo,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { BASE_RESERVE_XLM, FEE_BUFFER_XLM, MAX_MEMO_BYTES } from '@shared/constants';

export interface AssetRef {
  isNative: boolean;
  code?: string;
  issuer?: string;
}

export interface BuildTransferParams {
  sourceAccountId: string;
  sourceSequence: string;
  networkPassphrase: string;
  baseFee: string; // stroops, as string
  destination: string;
  destinationFunded: boolean;
  asset: AssetRef;
  amount: string; // decimal string, 7-dp
  memo?: string;
  timeoutSecs?: number;
}

function toAsset(ref: AssetRef): Asset {
  if (ref.isNative) return Asset.native();
  if (!ref.code || !ref.issuer) throw new Error('Non-native asset requires code and issuer.');
  return new Asset(ref.code, ref.issuer);
}

export function memoByteLength(memo: string): number {
  return new TextEncoder().encode(memo).length;
}

// Builds the *unsigned* transaction XDR. Signing happens in the worker only.
// - XLM to a non-existent account -> createAccount
// - otherwise -> payment
export function buildTransferXdr(params: BuildTransferParams): string {
  const {
    sourceAccountId,
    sourceSequence,
    networkPassphrase,
    baseFee,
    destination,
    destinationFunded,
    asset,
    amount,
    memo,
    timeoutSecs = 180,
  } = params;

  if (memo && memoByteLength(memo) > MAX_MEMO_BYTES) {
    throw new Error(`Memo must be ${MAX_MEMO_BYTES} bytes or fewer.`);
  }

  const source = new Account(sourceAccountId, sourceSequence);
  const builder = new TransactionBuilder(source, {
    fee: baseFee || BASE_FEE,
    networkPassphrase,
  });

  if (asset.isNative && !destinationFunded) {
    builder.addOperation(Operation.createAccount({ destination, startingBalance: amount }));
  } else {
    builder.addOperation(
      Operation.payment({ destination, asset: toAsset(asset), amount }),
    );
  }

  if (memo && memo.trim().length > 0) {
    builder.addMemo(Memo.text(memo));
  }

  return builder.setTimeout(timeoutSecs).build().toXDR();
}

// ── Weighted multi-sig (setOptions) — social-recovery primitive (#23) ────────

export interface SignerChange {
  ed25519PublicKey: string; // guardian / co-signer account
  weight: number; // 1–255 to add or re-weight, 0 to remove
}

export interface BuildSetOptionsParams {
  sourceAccountId: string;
  sourceSequence: string;
  networkPassphrase: string;
  baseFee: string; // stroops, as string
  signer?: SignerChange;
  masterWeight?: number;
  lowThreshold?: number;
  medThreshold?: number;
  highThreshold?: number;
  timeoutSecs?: number;
}

const WEIGHT_MIN = 0;
const WEIGHT_MAX = 255;

function assertWeight(label: string, w: number | undefined): void {
  if (w === undefined) return;
  if (!Number.isInteger(w) || w < WEIGHT_MIN || w > WEIGHT_MAX) {
    throw new Error(`${label} must be an integer between ${WEIGHT_MIN} and ${WEIGHT_MAX}.`);
  }
}

// Builds the *unsigned* XDR for a weighted-multisig change — add/remove a
// guardian signer and/or adjust the account thresholds. This is the on-chain
// primitive social recovery is built on (#23): signing/co-signing runs through
// SIGN_ONLY in the worker, and the scanner already flags the result as a
// high-risk account-control change (core/scan). Only the fields actually being
// changed are emitted, so an unspecified threshold is never silently zeroed;
// at least one change must be requested.
export function buildSetOptionsXdr(params: BuildSetOptionsParams): string {
  const {
    sourceAccountId,
    sourceSequence,
    networkPassphrase,
    baseFee,
    signer,
    masterWeight,
    lowThreshold,
    medThreshold,
    highThreshold,
    timeoutSecs = 180,
  } = params;

  assertWeight('signer weight', signer?.weight);
  assertWeight('masterWeight', masterWeight);
  assertWeight('lowThreshold', lowThreshold);
  assertWeight('medThreshold', medThreshold);
  assertWeight('highThreshold', highThreshold);

  const opts: Parameters<typeof Operation.setOptions>[0] = {};
  if (signer) opts.signer = { ed25519PublicKey: signer.ed25519PublicKey, weight: signer.weight };
  if (masterWeight !== undefined) opts.masterWeight = masterWeight;
  if (lowThreshold !== undefined) opts.lowThreshold = lowThreshold;
  if (medThreshold !== undefined) opts.medThreshold = medThreshold;
  if (highThreshold !== undefined) opts.highThreshold = highThreshold;

  if (Object.keys(opts).length === 0) {
    throw new Error('setOptions requires at least one signer or threshold change.');
  }

  const source = new Account(sourceAccountId, sourceSequence);
  return new TransactionBuilder(source, { fee: baseFee || BASE_FEE, networkPassphrase })
    .addOperation(Operation.setOptions(opts))
    .setTimeout(timeoutSecs)
    .build()
    .toXDR();
}

// MAX spendable XLM = balance − (base reserve × (2 + subentries)) − fee buffer.
// The +2 covers the base account reserve (2 entries). Never strand the account
// below its minimum reserve. Returns a 7-dp string, clamped at 0.
export function computeMaxXlm(balance: string, subentryCount: number): string {
  const bal = Number(balance);
  const reserve = BASE_RESERVE_XLM * (2 + subentryCount);
  const max = bal - reserve - FEE_BUFFER_XLM;
  if (!Number.isFinite(max) || max <= 0) return '0';
  // floor to 7 decimals to avoid over-spend from rounding
  return (Math.floor(max * 1e7) / 1e7).toFixed(7).replace(/\.?0+$/, '');
}

// The TOTAL network fee of a built transaction, as a 7-dp XLM string. A tx's
// stored fee is baseFee × operation count, so this is correct for multi-op
// transactions (e.g. a guardian setup with one op per guardian), not just the
// single-op case where baseFee alone happens to equal the total.
export function totalFeeXlm(xdr: string, networkPassphrase: string): string {
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  return (Number(tx.fee) / 1e7).toFixed(7).replace(/\.?0+$/, '');
}
