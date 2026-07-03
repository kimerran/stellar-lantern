import { parse as parseToml } from 'toml';
import { isValidPublicKey } from '@core/wallet/wallet';

// SEP-1 stellar.toml discovery — the first step of an anchor "Cash in / Cash
// out" flow (#24). Pure parsing here; the network fetch is a thin, injectable
// wrapper so this stays unit-testable without a live anchor.

export interface AnchorCurrency {
  code: string;
  issuer?: string; // omitted for the native asset
}

// The subset of an anchor's stellar.toml Lantern needs to start a SEP-24
// deposit/withdraw. Every field is optional — a given anchor may only support
// some SEPs, so the caller decides which flows are usable.
export interface AnchorInfo {
  webAuthEndpoint?: string; // WEB_AUTH_ENDPOINT (SEP-10 web auth)
  transferServerSep24?: string; // TRANSFER_SERVER_SEP0024 (SEP-24 interactive)
  signingKey?: string; // SIGNING_KEY (SEP-10 challenge server key, G…)
  currencies: AnchorCurrency[]; // [[CURRENCIES]]
}

/**
 * Parse the text of a stellar.toml into the fields we consume. Pure: no
 * network. Throws only if the TOML itself is malformed; missing keys come back
 * `undefined`. SIGNING_KEY is validated as a real account key and dropped if
 * not — a bad server key must never be trusted for SEP-10.
 */
export function parseAnchorToml(text: string): AnchorInfo {
  const raw = parseToml(text) as Record<string, unknown>;
  return {
    webAuthEndpoint: str(raw.WEB_AUTH_ENDPOINT),
    transferServerSep24: str(raw.TRANSFER_SERVER_SEP0024),
    signingKey:
      typeof raw.SIGNING_KEY === 'string' && isValidPublicKey(raw.SIGNING_KEY)
        ? raw.SIGNING_KEY
        : undefined,
    currencies: currencies(raw.CURRENCIES),
  };
}

/**
 * Fetch + parse an anchor's stellar.toml from its home domain
 * (`https://<domain>/.well-known/stellar.toml`). `fetchImpl` is injectable for
 * tests; defaults to the platform `fetch`. A non-2xx response or network error
 * surfaces as a thrown Error with a readable message.
 */
export async function discoverAnchor(
  homeDomain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AnchorInfo> {
  const domain = homeDomain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!domain) throw new Error('Anchor home domain is required.');
  const res = await fetchImpl(`https://${domain}/.well-known/stellar.toml`);
  if (!res.ok) {
    throw new Error(`Could not load stellar.toml from ${domain} (${res.status}).`);
  }
  return parseAnchorToml(await res.text());
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function currencies(v: unknown): AnchorCurrency[] {
  if (!Array.isArray(v)) return [];
  const out: AnchorCurrency[] = [];
  for (const c of v) {
    if (!c || typeof c !== 'object') continue;
    const { code, issuer } = c as Record<string, unknown>;
    if (typeof code !== 'string' || code.trim() === '') continue;
    out.push({ code: code.trim(), ...(typeof issuer === 'string' ? { issuer } : {}) });
  }
  return out;
}
