import type { AssetRef } from '@core/stellar/tx';
import { isValidContractId, isValidPublicKey } from '@core/wallet/wallet';
import { MAX_MEMO_BYTES, type NetworkId } from '@shared/constants';
import type { ScanVerdict } from '@lantern/scanner';
import type { WalletScanInput } from '@core/scan/wallet';
import { signXdrScanInput, validateSignXdr, type ValidSignXdr } from '@core/dapp/sign-xdr';

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

// ── lantern:signXdr — sign a dApp-built transaction, don't submit it (#262) ──
//
//   dApp → { type: 'lantern:signXdr', xdr, networkPassphrase, id? }
//   Lantern → { type: 'lantern:signing' } at once (Centient treats no ack
//             within 5 s as "this Lantern can't sign transactions"), then one of
//             { type: 'lantern:xdrSigned', signedXdr }
//             { type: 'lantern:signRejected', error? }  — the user said no
//             { type: 'lantern:txError', error }        — refused / failed
//
// Every reply echoes the request's `id` when it had one (a string or a finite
// number), so a dApp can tell replies to concurrent requests apart later. The
// validate / scan / sign core is shared with web connect (#252):
// src/core/dapp/sign-xdr.ts.

export type BridgeRequestId = string | number;

/** The request's `id`, when it is one we echo. */
export function bridgeRequestId(data: unknown): BridgeRequestId | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const { id } = data as { id?: unknown };
  if (typeof id === 'string' && id.length > 0 && id.length <= 128) return id;
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  return undefined;
}

/** `message`, with `id` added when the request carried one. */
export function withRequestId<T extends { type: string }>(
  message: T,
  id: BridgeRequestId | undefined,
): T & { id?: BridgeRequestId } {
  return id === undefined ? message : { ...message, id };
}

export interface SignXdrReview {
  id?: BridgeRequestId;
  value: ValidSignXdr;
  scanInput: WalletScanInput;
  verdict: ScanVerdict;
}

export interface SignXdrBridge {
  post(message: { type: string; [k: string]: unknown }): void;
  // The site was approved through lantern:getPublicKey.
  connected: boolean;
  address: string;
  network: NetworkId;
  networkPassphrase: string;
  rpcUrl?: string;
  origin?: string;
  scan(input: WalletScanInput): Promise<ScanVerdict>;
}

/**
 * Take a `lantern:signXdr` request up to the review: acknowledge it before
 * anything asynchronous, reject what can't be reviewed, scan the rest.
 * Resolves to the review to show, or null when a reply has already been sent.
 */
export async function beginSignXdr(data: unknown, bridge: SignXdrBridge): Promise<SignXdrReview | null> {
  const id = bridgeRequestId(data);
  const reply = (m: { type: string; [k: string]: unknown }) => bridge.post(withRequestId(m, id));
  if (!bridge.connected) {
    reply({ type: 'lantern:txError', error: 'Connect the wallet first.' });
    return null;
  }
  // Synchronously, before any await: the dApp is timing this.
  reply({ type: 'lantern:signing' });
  const validated = validateSignXdr((data ?? {}) as Record<string, unknown>, {
    networkPassphrase: bridge.networkPassphrase,
    address: bridge.address,
  });
  if (!validated.ok) {
    reply({ type: 'lantern:txError', error: validated.error });
    return null;
  }
  const scanInput = signXdrScanInput(validated.value, {
    network: bridge.network,
    address: bridge.address,
    rpcUrl: bridge.rpcUrl,
    origin: bridge.origin,
  });
  try {
    const verdict = await bridge.scan(scanInput);
    return { ...(id !== undefined ? { id } : {}), value: validated.value, scanInput, verdict };
  } catch {
    reply({ type: 'lantern:txError', error: 'Could not check the transaction.' });
    return null;
  }
}
