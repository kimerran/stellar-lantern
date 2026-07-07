// Strict-send path discovery for swaps (#71, slice 2). Given "I want to spend
// exactly N of asset A for asset B", ask Horizon's `/paths/strict-send` endpoint
// for the best receivable amount + the route through SDEX order books / AMM pools.
// The quote feeds the swap builder (#74): `destAmount` → `destMinFromQuote` (the
// slippage floor) and `path` → the path payment's intermediate hops.
//
// Injectable `fetch` (not the SDK `Server`) so the whole path is unit-testable
// offline, mirroring the SEP/Soroban clients. Returns `null` when there's no
// route (zero liquidity) so the UI can say "no path" instead of erroring; a real
// network/HTTP failure throws for the caller to surface.

import type { AssetRef } from './tx';

export interface SwapQuote {
  /** Best receivable amount for the given send amount (decimal string). */
  destAmount: string;
  /** Intermediate hops between send and dest assets (excludes both endpoints). */
  path: AssetRef[];
}

export interface StrictSendQuoteParams {
  horizonUrl: string;
  sendAsset: AssetRef;
  sendAmount: string;
  destAsset: AssetRef;
  fetchImpl?: typeof fetch;
}

// Horizon asset query encoding.
function assetType(ref: AssetRef): string {
  if (ref.isNative) return 'native';
  return (ref.code ?? '').length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12';
}
// Canonical "native" | "CODE:ISSUER" used for the `destination_assets` list.
function assetParam(ref: AssetRef): string {
  return ref.isNative ? 'native' : `${ref.code}:${ref.issuer}`;
}

interface HorizonAsset {
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}
function refFromHorizon(a: HorizonAsset): AssetRef {
  if (a.asset_type === 'native') return { isNative: true };
  return { isNative: false, code: a.asset_code, issuer: a.asset_issuer };
}

interface PathRecord {
  destination_amount?: string;
  path?: HorizonAsset[];
}

/**
 * Fetch the best strict-send quote from Horizon. Returns the record with the
 * highest `destination_amount` (best price) as `{ destAmount, path }`, or `null`
 * when Horizon returns no routes (no liquidity). Throws on a network error or a
 * non-2xx response so the caller can distinguish "no path" from "lookup failed".
 */
export async function fetchStrictSendPaths(params: StrictSendQuoteParams): Promise<SwapQuote | null> {
  const { horizonUrl, sendAsset, sendAmount, destAsset } = params;
  const fetchImpl = params.fetchImpl ?? fetch;

  const q = new URLSearchParams({
    source_asset_type: assetType(sendAsset),
    source_amount: sendAmount,
    destination_assets: assetParam(destAsset),
  });
  if (!sendAsset.isNative) {
    q.set('source_asset_code', sendAsset.code ?? '');
    q.set('source_asset_issuer', sendAsset.issuer ?? '');
  }

  const res = await fetchImpl(`${horizonUrl.replace(/\/$/, '')}/paths/strict-send?${q.toString()}`);
  if (!res.ok) throw new Error(`Path lookup failed (${res.status}).`);

  let body: { _embedded?: { records?: PathRecord[] } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new Error('Could not read the path lookup response.');
  }

  const records = body._embedded?.records ?? [];
  let best: PathRecord | null = null;
  for (const r of records) {
    if (typeof r.destination_amount !== 'string') continue;
    if (!best || Number(r.destination_amount) > Number(best.destination_amount)) best = r;
  }
  if (!best || typeof best.destination_amount !== 'string') return null;

  return {
    destAmount: best.destination_amount,
    path: (best.path ?? []).map(refFromHorizon),
  };
}
