import { Account, Asset, BASE_FEE, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { AssetRef } from './tx';

// In-wallet market swaps via a **strict-send path payment** (#71): send exactly
// `sendAmount` of `sendAsset` and receive at least `destMin` of `destAsset`,
// routed through `path` across the native SDEX order book + AMM liquidity pools.
// A swap is a self-payment (destination defaults to the source account), so the
// user converts their own balance from one asset to another.
//
// `destMin` is the **slippage floor**: the network guarantees the user receives
// at least this much or the whole transaction fails atomically — a price move
// between quote and execution can never silently hand back a worse rate. Callers
// compute it from a quote as `quotedReceive × (1 − tolerance)`.
//
// Pure/offline: builds the *unsigned* XDR only. Signing runs through the worker
// and the transaction is scanned/explained before signing, like every other op.

function toAsset(ref: AssetRef): Asset {
  if (ref.isNative) return Asset.native();
  if (!ref.code || !ref.issuer) throw new Error('Non-native asset requires code and issuer.');
  return new Asset(ref.code, ref.issuer);
}

function sameAsset(a: AssetRef, b: AssetRef): boolean {
  if (a.isNative || b.isNative) return a.isNative && b.isNative;
  return a.code === b.code && a.issuer === b.issuer;
}

// Up to 7 decimal places, strictly positive.
const AMOUNT_RE = /^\d+(\.\d{1,7})?$/;
function assertPositiveAmount(label: string, v: string): void {
  const t = v.trim();
  if (!AMOUNT_RE.test(t) || Number(t) <= 0) {
    throw new Error(`${label} must be a positive amount with up to 7 decimal places.`);
  }
}

export interface BuildSwapParams {
  sourceAccountId: string;
  sourceSequence: string;
  networkPassphrase: string;
  baseFee: string; // stroops, as string
  sendAsset: AssetRef;
  sendAmount: string; // exact amount to send (decimal, 7-dp)
  destAsset: AssetRef;
  destMin: string; // minimum acceptable received — the slippage floor (decimal, 7-dp)
  path?: AssetRef[]; // intermediate hops; empty = direct
  destination?: string; // defaults to the source account (self-swap)
  timeoutSecs?: number;
}

/**
 * Build the *unsigned* XDR for a market swap (strict-send path payment).
 * Validates strictly-positive `sendAmount`/`destMin`, that send and dest assets
 * differ, and that each asset ref is well-formed. Returns base64 XDR.
 */
export function buildPathPaymentStrictSendXdr(params: BuildSwapParams): string {
  const {
    sourceAccountId,
    sourceSequence,
    networkPassphrase,
    baseFee,
    sendAsset,
    sendAmount,
    destAsset,
    destMin,
    path = [],
    destination = sourceAccountId,
    timeoutSecs = 180,
  } = params;

  assertPositiveAmount('Send amount', sendAmount);
  assertPositiveAmount('Minimum received', destMin);
  if (sameAsset(sendAsset, destAsset)) {
    throw new Error('A swap must be between two different assets.');
  }

  const source = new Account(sourceAccountId, sourceSequence);
  return new TransactionBuilder(source, { fee: baseFee || BASE_FEE, networkPassphrase })
    .addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset: toAsset(sendAsset),
        sendAmount,
        destination,
        destAsset: toAsset(destAsset),
        destMin,
        path: path.map(toAsset),
      }),
    )
    .setTimeout(timeoutSecs)
    .build()
    .toXDR();
}

/**
 * The slippage floor for a swap: the minimum the user will accept given a quoted
 * receive amount and a tolerance (e.g. 0.005 = 0.5%). Rounded down to 7 dp so we
 * never ask for more than the tolerance allows. Pure helper for callers.
 */
export function destMinFromQuote(quotedReceive: string, tolerance: number): string {
  const q = Number(quotedReceive);
  if (!Number.isFinite(q) || q <= 0) throw new Error('Quote must be a positive amount.');
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance >= 1) {
    throw new Error('Tolerance must be between 0 and 1.');
  }
  const floor = Math.floor(q * (1 - tolerance) * 1e7) / 1e7;
  return floor.toFixed(7);
}
