// In-wallet swap tx builder (#71, slice 1). `core/stellar/tx.ts` builds only
// createAccount / payment, so today there's no way to *make* a swap even though
// history already labels one. This adds the construction primitive.
//
// A market swap is a **strict-send path payment**: spend an EXACT amount of one
// asset and receive at least `destMin` of another, traversing SDEX order books +
// AMM liquidity via the optional `path`. Strict-send fits "swap this much XLM for
// as much USDC as I can get, but no less than X" — `destMin` is the slippage
// floor the network enforces atomically (a price move between quote and execution
// can never hand back a worse rate; the tx just fails). A swap is a self-payment,
// so `destination` defaults to the source account.
//
// Pure/offline: builds the *unsigned* XDR only. Signing runs through the worker
// and the tx is scanned/explained before signing, like every other op. The live
// quote + path discovery that feed `destMin`/`path` are a separate slice.

import { Account, Asset, BASE_FEE, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { AssetRef } from './tx';

export interface BuildSwapParams {
  sourceAccountId: string;
  sourceSequence: string;
  networkPassphrase: string;
  baseFee: string; // stroops, as string
  sendAsset: AssetRef;
  sendAmount: string; // exact amount spent (decimal, 7-dp)
  destAsset: AssetRef;
  destMin: string; // minimum acceptable received — the slippage floor (decimal, 7-dp)
  path?: AssetRef[]; // intermediate hops; empty/undefined = route directly
  destination?: string; // defaults to the source account (self-swap)
  timeoutSecs?: number;
}

function toAsset(ref: AssetRef): Asset {
  if (ref.isNative) return Asset.native();
  if (!ref.code || !ref.issuer) throw new Error('Non-native asset requires code and issuer.');
  return new Asset(ref.code, ref.issuer);
}

function sameAsset(a: AssetRef, b: AssetRef): boolean {
  if (a.isNative || b.isNative) return a.isNative && b.isNative;
  return a.code === b.code && a.issuer === b.issuer;
}

// Stellar amounts: strictly positive decimals with up to 7 fractional digits.
const AMOUNT_RE = /^\d+(\.\d{1,7})?$/;
function assertPositiveAmount(label: string, v: string): void {
  const t = v.trim();
  if (!AMOUNT_RE.test(t) || Number(t) <= 0) {
    throw new Error(`${label} must be a positive amount (up to 7 decimal places).`);
  }
}

/**
 * Build the *unsigned* XDR for a market swap (strict-send path payment).
 * Validates strictly-positive `sendAmount` + `destMin` (the slippage floor),
 * rejects a send == dest asset (not a swap), and validates each asset ref. The
 * optional `path` names intermediate assets to route through; omit to send direct.
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
 * Slippage floor for a swap: the minimum received the wallet will accept given a
 * quoted receive amount and a tolerance (e.g. `0.005` = 0.5%). Floored to 7 dp so
 * we never ask for more than the tolerance allows. Pure — the quote itself (a
 * Horizon path lookup) is a separate slice; this just turns a quote into `destMin`.
 */
export function destMinFromQuote(quotedReceive: string, tolerance: number): string {
  const q = Number(quotedReceive);
  if (!Number.isFinite(q) || q <= 0) throw new Error('Quote must be a positive amount.');
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance >= 1) {
    throw new Error('Tolerance must be between 0 and 1 (exclusive of 1).');
  }
  return (Math.floor(q * (1 - tolerance) * 1e7) / 1e7).toFixed(7);
}
