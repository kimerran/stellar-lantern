import { Asset } from '@stellar/stellar-sdk';
import type { AssetRef } from './tx';

// Soroswap aggregator client (#71, slice 5). Best-price routing across
// Soroswap / Aqua / Phoenix / SDEX via the Soroswap API, behind the
// `swapAggregator` feature flag + an API key. Every result still flows through
// the wallet's scan → review → SIGN_AND_SUBMIT gate; on ANY failure the caller
// falls back to the native Horizon path-payment engine, so the aggregator can
// never block a swap — it only takes over when it's configured AND quotes a
// strictly better price.
//
// Injectable `fetch` → fully unit-testable offline. Request/response shapes are
// modelled from the Soroswap OpenAPI (api.soroswap.finance/api-json). The live
// endpoint requires a Bearer API key, so an end-to-end call is validated by a
// human at integration time (the remaining #71 acceptance item) — until then the
// wallet swaps via the native SDEX engine and this stays inert without a key.

export const SOROSWAP_API_BASE = 'https://api.soroswap.finance';

export type SoroswapNetwork = 'testnet' | 'mainnet';

// Liquidity sources the aggregator routes across (Soroswap AMM + on-chain DEXs).
export const DEFAULT_PROTOCOLS = ['sdex', 'soroswap', 'phoenix', 'aqua'];

// Default slippage floor sent to the API, in basis points (0.5%).
export const DEFAULT_SLIPPAGE_BPS = 50;

// Stellar classic assets (and their SACs) are 7-decimal, matching the native
// path-payment engine. `amount` is submitted to the API in stroops (base units).
const STROOP = 10_000_000n;
const AMOUNT_RE = /^\d+(\.\d{1,7})?$/;

export interface SoroswapConfig {
  /** Bearer API key (secret). Without it the client is inert (returns null). */
  apiKey: string;
  network: SoroswapNetwork;
  /** Network passphrase, to derive each asset's Soroban SAC contract id. */
  networkPassphrase: string;
  baseUrl?: string;
  protocols?: string[];
  /** Slippage floor in bps sent to the API (default 0.5%). */
  slippageBps?: number;
  /** Platform/referral fee in bps (e.g. 50 = 0.5%). Only sent with `referralId`. */
  feeBps?: number;
  /** Our revenue-share wallet address; the API requires it when `feeBps` is set. */
  referralId?: string;
  fetchImpl?: typeof fetch;
}

export interface SoroswapQuote {
  /** Receivable amount as a 7-dp decimal string (for display + review). */
  amountOut: string;
  /** Raw receivable in stroops, as returned by the API. */
  amountOutStroops: string;
  /** Price-impact percentage string, or null if the API omitted it. */
  priceImpactPct: string | null;
  /** Routing platform the API chose ('router' | 'aggregator' | 'sdex'), or null. */
  platform: string | null;
  /** Opaque quote object, passed back to `/quote/build` verbatim. */
  raw: Record<string, unknown>;
}

function assetFromRef(ref: AssetRef): Asset {
  if (ref.isNative) return Asset.native();
  if (!ref.code || !ref.issuer) throw new Error('Non-native asset requires code and issuer.');
  return new Asset(ref.code, ref.issuer);
}

/** Map an `AssetRef` to the Soroban SAC contract id the Soroswap API expects. */
export function assetContractId(ref: AssetRef, networkPassphrase: string): string {
  return assetFromRef(ref).contractId(networkPassphrase);
}

/** Decimal (≤7-dp, positive) amount → integer stroop string. Throws on bad input. */
export function toStroops(amount: string): string {
  const t = amount.trim();
  if (!AMOUNT_RE.test(t) || Number(t) <= 0) {
    throw new Error('Amount must be positive with up to 7 decimal places.');
  }
  const [whole = '0', frac = ''] = t.split('.');
  const fracPadded = (frac + '0000000').slice(0, 7);
  return (BigInt(whole) * STROOP + BigInt(fracPadded)).toString();
}

/** Integer stroop string → 7-dp decimal string. */
export function fromStroops(stroops: string): string {
  const n = BigInt(stroops);
  const frac = (n % STROOP).toString().padStart(7, '0');
  return `${n / STROOP}.${frac}`;
}

/**
 * Best-price selection between the native SDEX quote and the Soroswap quote.
 * Returns the engine whose receivable is strictly larger; ties — and any missing
 * or unusable Soroswap amount — prefer `'sdex'`, the reliable no-dependency path.
 * Amounts are 7-dp decimal strings.
 */
export function pickBestEngine(sdexReceive: string, soroswapReceive: string | null): 'sdex' | 'soroswap' {
  if (!soroswapReceive) return 'sdex';
  const a = Number(soroswapReceive);
  if (!Number.isFinite(a) || a <= 0) return 'sdex';
  const s = Number(sdexReceive);
  if (!Number.isFinite(s) || s <= 0) return 'soroswap';
  return a > s ? 'soroswap' : 'sdex';
}

function headers(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
}

/**
 * Fetch a best-route quote from the Soroswap aggregator. Returns the normalized
 * quote, or `null` on ANY failure (no API key, bad asset, non-2xx, empty route,
 * malformed body) so the caller can fall back to the native engine. Never throws.
 */
export async function fetchSoroswapQuote(params: {
  config: SoroswapConfig;
  sendAsset: AssetRef;
  sendAmount: string;
  destAsset: AssetRef;
}): Promise<SoroswapQuote | null> {
  const { config, sendAsset, sendAmount, destAsset } = params;
  if (!config.apiKey) return null;
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = (config.baseUrl ?? SOROSWAP_API_BASE).replace(/\/$/, '');

  let assetIn: string;
  let assetOut: string;
  let amount: string;
  try {
    assetIn = assetContractId(sendAsset, config.networkPassphrase);
    assetOut = assetContractId(destAsset, config.networkPassphrase);
    amount = toStroops(sendAmount);
  } catch {
    return null;
  }

  const body: Record<string, unknown> = {
    assetIn,
    assetOut,
    amount: Number(amount),
    tradeType: 'EXACT_IN',
    protocols: config.protocols ?? DEFAULT_PROTOCOLS,
    slippageBps: config.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
  };
  // The API requires a referralId whenever feeBps is present, so only send the
  // fee when both are configured (otherwise the request would be rejected).
  if (config.feeBps != null && config.referralId) body.feeBps = config.feeBps;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/quote?network=${config.network}`, {
      method: 'POST',
      headers: headers(config.apiKey),
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }

  const amountOutStroops = data.amountOut;
  if (typeof amountOutStroops !== 'string' || !/^\d+$/.test(amountOutStroops) || amountOutStroops === '0') {
    return null;
  }

  return {
    amountOut: fromStroops(amountOutStroops),
    amountOutStroops,
    priceImpactPct: typeof data.priceImpactPct === 'string' ? data.priceImpactPct : null,
    platform: typeof data.platform === 'string' ? data.platform : null,
    raw: data,
  };
}

/**
 * Build the unsigned swap XDR for a Soroswap quote. Returns the ready-to-sign
 * base64 XDR, or `null` on ANY failure (no key, non-2xx — including 428 "needs a
 * trustline/extra step", which we don't support in v1 — or a missing `xdr`) so
 * the caller can fall back to the native engine. Never throws. The swap is built
 * as a self-swap (`to = from`); signing/submission runs through the existing
 * SIGN_AND_SUBMIT path after the transaction is scanned.
 */
export async function buildSoroswapSwapXdr(params: {
  config: SoroswapConfig;
  quote: SoroswapQuote;
  from: string;
}): Promise<string | null> {
  const { config, quote, from } = params;
  if (!config.apiKey) return null;
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = (config.baseUrl ?? SOROSWAP_API_BASE).replace(/\/$/, '');

  const body: Record<string, unknown> = { quote: quote.raw, from, to: from };
  if (config.feeBps != null && config.referralId) body.referralId = config.referralId;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/quote/build?network=${config.network}`, {
      method: 'POST',
      headers: headers(config.apiKey),
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
  return typeof data.xdr === 'string' && data.xdr.length > 0 ? data.xdr : null;
}
