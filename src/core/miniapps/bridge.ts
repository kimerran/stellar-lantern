import type { AssetRef } from '@core/stellar/tx';
import { isValidContractId, isValidPublicKey } from '@core/wallet/wallet';
import { MAX_MEMO_BYTES } from '@shared/constants';

// Pure helpers for the mini-app wallet bridge (see src/popup/screens/Apps.tsx).
// A connected dApp sends a payment *intent*; Lantern validates it here, then
// builds, scans, signs and submits. Kept framework-free + side-effect-free so
// it's unit-testable (tests/bridge.test.ts).

/** A payment a mini-app asks Lantern to make (XLM, or an issued asset). */
export interface PaymentIntent {
  destination: string;
  amount: string;
  memo?: string;
  asset?: { code: string; issuer: string };
}

export type IntentResult =
  | { ok: true; value: PaymentIntent }
  | { ok: false; error: string };

function memoByteLength(memo: string): number {
  return new TextEncoder().encode(memo).length;
}

/**
 * Validate a payment intent from an untrusted mini-app. Returns a normalized
 * intent on success, or a readable error the bridge can surface to the dApp.
 */
export function validatePaymentIntent(intent: unknown): IntentResult {
  if (!intent || typeof intent !== 'object') {
    return { ok: false, error: 'Invalid payment request.' };
  }
  const { destination, amount, memo, asset } = intent as Record<string, unknown>;

  if (typeof destination !== 'string' || !isValidPublicKey(destination)) {
    return { ok: false, error: 'Invalid destination address.' };
  }
  if (typeof amount !== 'string' && typeof amount !== 'number') {
    return { ok: false, error: 'Invalid amount.' };
  }
  const amountStr = String(amount);
  const amt = Number(amountStr);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, error: 'Amount must be greater than zero.' };
  }
  if (memo != null) {
    if (typeof memo !== 'string') return { ok: false, error: 'Invalid memo.' };
    if (memoByteLength(memo) > MAX_MEMO_BYTES) {
      return { ok: false, error: `Memo must be ${MAX_MEMO_BYTES} bytes or fewer.` };
    }
  }
  let normalizedAsset: PaymentIntent['asset'];
  if (asset != null) {
    if (typeof asset !== 'object') return { ok: false, error: 'Invalid asset.' };
    const { code, issuer } = asset as Record<string, unknown>;
    if (typeof code !== 'string' || code.trim() === '') {
      return { ok: false, error: 'Asset code is required for a non-native payment.' };
    }
    if (typeof issuer !== 'string' || !isValidPublicKey(issuer)) {
      return { ok: false, error: 'Invalid asset issuer.' };
    }
    normalizedAsset = { code: code.trim(), issuer };
  }

  return {
    ok: true,
    value: {
      destination,
      amount: amountStr,
      ...(typeof memo === 'string' && memo.trim() !== '' ? { memo: memo.trim() } : {}),
      ...(normalizedAsset ? { asset: normalizedAsset } : {}),
    },
  };
}

// ── Soroban contract-invocation intent (#21) ─────────────────────────────────

/**
 * A Soroban contract call a mini-app asks Lantern to sign — e.g. a Blend
 * `supply` of USDC. Args are kept opaque (stringified) at this bridge layer;
 * turning them into typed ScVals belongs in the (RPC-simulated) invoke builder,
 * not in untrusted-input validation. The call still flows through the same
 * connect → scan → approve → sign pipeline as a payment.
 */
export interface InvokeIntent {
  contractId: string; // C… contract address
  function: string; // invoked function name (Soroban symbol)
  args: string[]; // positional argument descriptors, normalized to strings
}

export type InvokeIntentResult =
  | { ok: true; value: InvokeIntent }
  | { ok: false; error: string };

// Soroban symbols: ASCII alphanumeric + underscore, at most 32 chars.
const SYMBOL_RE = /^[a-zA-Z0-9_]+$/;
const MAX_SYMBOL_LEN = 32;

/**
 * Validate a contract-invocation intent from an untrusted mini-app. Returns a
 * normalized intent, or a readable error the bridge can surface to the dApp.
 */
export function validateInvokeIntent(intent: unknown): InvokeIntentResult {
  if (!intent || typeof intent !== 'object') {
    return { ok: false, error: 'Invalid contract request.' };
  }
  const { contractId, function: fn, args } = intent as Record<string, unknown>;

  if (typeof contractId !== 'string' || !isValidContractId(contractId)) {
    return { ok: false, error: 'Invalid contract address.' };
  }
  if (typeof fn !== 'string' || !SYMBOL_RE.test(fn) || fn.length > MAX_SYMBOL_LEN) {
    return { ok: false, error: 'Invalid contract function name.' };
  }

  let normalizedArgs: string[] = [];
  if (args != null) {
    if (!Array.isArray(args)) return { ok: false, error: 'Contract args must be a list.' };
    for (const a of args) {
      if (typeof a !== 'string' && typeof a !== 'number' && typeof a !== 'boolean') {
        return { ok: false, error: 'Each contract arg must be a string, number, or boolean.' };
      }
    }
    normalizedArgs = args.map((a) => String(a));
  }

  return {
    ok: true,
    value: { contractId: contractId.trim(), function: fn, args: normalizedArgs },
  };
}

/** Map an intent to the tx builder's AssetRef — native XLM when no asset is set. */
export function toAssetRef(intent: PaymentIntent): AssetRef {
  return intent.asset
    ? { isNative: false, code: intent.asset.code, issuer: intent.asset.issuer }
    : { isNative: true };
}

/** Display label for the intent's asset. */
export function intentAssetCode(intent: PaymentIntent): string {
  return intent.asset ? intent.asset.code : 'XLM';
}
