// Anchor transfer orchestration (#24): SEP-10 web-auth → SEP-24 interactive.
// The security-critical bit is the ORDER — fetch the challenge, VALIDATE it
// against the anchor's SEP-1 SIGNING_KEY and expected domains, and only THEN
// hand it to the signer. A challenge that fails validation is never signed, so a
// malicious "anchor" can't trick the wallet into signing something else. The
// signer + fetch are injected so this whole flow is unit-testable offline.

import { fetchChallenge, validateChallenge, submitChallenge } from './sep10';
import { startInteractive, type TransferKind, type InteractiveResponse } from './sep24';

/** Signs an already-validated challenge XDR without submitting it (SIGN_ONLY). */
export type ChallengeSigner = (xdr: string, networkPassphrase: string) => Promise<string>;

export interface AnchorAuthParams {
  webAuthEndpoint: string; // SEP-1 WEB_AUTH_ENDPOINT
  signingKey: string; // SEP-1 SIGNING_KEY (the anchor's server account)
  homeDomain: string; // the anchor's home domain
  webAuthDomain: string; // the web-auth host (challenge's web_auth_domain)
  account: string; // the wallet's public key
  networkPassphrase: string; // the wallet's active network
  signChallenge: ChallengeSigner; // injected — wraps the SIGN_ONLY worker path
  fetchImpl?: typeof fetch;
}

/**
 * SEP-10: fetch a challenge, verify it is server-signed by `signingKey` for the
 * right domains/network, then sign + submit it for a JWT. Throws (without ever
 * calling `signChallenge`) if the challenge can't be validated — validate BEFORE
 * sign is the guard that keeps this a safe signing surface.
 */
export async function authenticateSep10(p: AnchorAuthParams): Promise<string> {
  const fetchImpl = p.fetchImpl ?? fetch;
  const challenge = await fetchChallenge(
    p.webAuthEndpoint,
    { account: p.account, homeDomain: p.homeDomain },
    fetchImpl,
  );
  // The anchor must have built the challenge for our network.
  if (challenge.networkPassphrase && challenge.networkPassphrase !== p.networkPassphrase) {
    throw new Error('This anchor’s sign-in request is for a different network.');
  }
  const passphrase = challenge.networkPassphrase || p.networkPassphrase;
  const check = validateChallenge(challenge.transaction, {
    serverAccountId: p.signingKey,
    networkPassphrase: passphrase,
    homeDomain: p.homeDomain,
    webAuthDomain: p.webAuthDomain,
  });
  if (!check.ok) {
    throw new Error(`Couldn’t verify the anchor’s sign-in request: ${check.error}`);
  }
  // Only a validated challenge is ever handed to the signer.
  const signed = await p.signChallenge(challenge.transaction, passphrase);
  return submitChallenge(p.webAuthEndpoint, signed, fetchImpl);
}

export interface AnchorTransferParams extends AnchorAuthParams {
  transferServer: string; // SEP-1 TRANSFER_SERVER_SEP0024
  kind: TransferKind; // 'deposit' (cash in) | 'withdraw' (cash out)
  assetCode: string;
}

/**
 * Authenticate (SEP-10) then start the SEP-24 interactive deposit/withdraw.
 * Returns the interactive URL (to open in the sandboxed Browser overlay) plus
 * the transaction id (to poll via `fetchTransaction`).
 */
export async function startAnchorTransfer(p: AnchorTransferParams): Promise<InteractiveResponse> {
  const jwt = await authenticateSep10(p);
  return startInteractive(
    p.transferServer,
    { kind: p.kind, assetCode: p.assetCode, account: p.account, jwt },
    p.fetchImpl ?? fetch,
  );
}
