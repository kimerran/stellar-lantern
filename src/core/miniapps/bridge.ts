import type { AssetRef } from '@core/stellar/tx';
import { isValidPublicKey } from '@core/wallet/wallet';
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
