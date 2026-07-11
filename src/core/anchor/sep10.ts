import { WebAuth } from '@stellar/stellar-sdk';

// SEP-10 web authentication — the step between SEP-1 discovery and any SEP-24
// transfer (#24). The wallet GETs a challenge transaction from the anchor,
// VALIDATES it (server-signed, right domains — the guard that makes signing an
// anchor's transaction safe), signs it with SIGN_ONLY (#33, in the worker),
// then POSTs it back for a JWT. Network calls take an injectable `fetch` so the
// whole flow is unit-testable offline.

export interface ChallengeRequest {
  account: string; // the wallet's public key
  homeDomain: string; // the anchor's home domain (echoed in the challenge)
  clientDomain?: string;
}

export interface Challenge {
  transaction: string; // challenge XDR to validate + sign
  networkPassphrase: string; // network_passphrase the anchor built it for
}

/** GET the SEP-10 challenge from the anchor's `WEB_AUTH_ENDPOINT`. */
export async function fetchChallenge(
  webAuthEndpoint: string,
  req: ChallengeRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<Challenge> {
  const url = new URL(webAuthEndpoint);
  url.searchParams.set('account', req.account);
  url.searchParams.set('home_domain', req.homeDomain);
  if (req.clientDomain) url.searchParams.set('client_domain', req.clientDomain);

  const res = await fetchImpl(url.toString());
  if (!res.ok) throw new Error(`Anchor auth challenge failed (${res.status}).`);
  const body = (await res.json()) as { transaction?: unknown; network_passphrase?: unknown };
  if (typeof body.transaction !== 'string') {
    throw new Error('Anchor returned no challenge transaction.');
  }
  return {
    transaction: body.transaction,
    networkPassphrase: typeof body.network_passphrase === 'string' ? body.network_passphrase : '',
  };
}

export interface ChallengeCheck {
  serverAccountId: string; // SIGNING_KEY from the anchor's stellar.toml (SEP-1)
  networkPassphrase: string;
  homeDomain: string;
  webAuthDomain: string;
}

export type ValidationResult =
  | { ok: true; clientAccountId: string }
  | { ok: false; error: string };

/**
 * Validate a challenge BEFORE signing it. Wraps `WebAuth.readChallengeTx`,
 * which verifies the server signature against `serverAccountId` (the SEP-1
 * SIGNING_KEY), the sequence number is 0 (so it can never be a real ledger
 * transaction), the timebounds, and the home/web-auth domains. A challenge that
 * fails any check must never be handed to SIGN_ONLY.
 */
export function validateChallenge(xdr: string, check: ChallengeCheck): ValidationResult {
  try {
    const { clientAccountID } = WebAuth.readChallengeTx(
      xdr,
      check.serverAccountId,
      check.networkPassphrase,
      check.homeDomain,
      check.webAuthDomain,
    );
    return { ok: true, clientAccountId: clientAccountID };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid challenge transaction.' };
  }
}

/** POST the signed challenge back to the anchor and return the SEP-10 JWT. */
export async function submitChallenge(
  webAuthEndpoint: string,
  signedXdr: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(webAuthEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: signedXdr }),
  });
  if (!res.ok) throw new Error(`Anchor auth failed (${res.status}).`);
  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== 'string' || body.token === '') {
    throw new Error('Anchor returned no auth token.');
  }
  return body.token;
}
