// Passkey signing of Soroban authorization entries (#53) — the bridge between
// "simulation returned auth entries for the smart account" and "the contract's
// __check_auth accepts them". For each entry credentialed to the passkey smart
// account we: set the signature expiration ledger, hash the
// ENVELOPE_TYPE_SOROBAN_AUTHORIZATION preimage (that 32-byte hash is what
// Soroban feeds __check_auth as `signature_payload`), ask the authenticator to
// sign it (the hash becomes the WebAuthn challenge), and attach the assertion
// as the ScVal struct the contract's `Signature` type deserializes.
//
// Pure XDR surgery + the injectable `CredentialsApi` — no network.

import { Address, hash, xdr } from '@stellar/stellar-sdk';
import { assertionMatches } from './assertion';
import { normalizeLowS } from './secp256r1';
import { signWithPasskey, type CredentialsApi, type PasskeyAssertion } from './webauthn';

/**
 * The 32-byte payload Soroban hands the smart account's `__check_auth` for this
 * entry: sha256 of the HashIdPreimage over (network id, nonce, expiration,
 * invocation). The entry's expiration ledger must already be set — it is part
 * of the signed preimage.
 */
export function authEntryPayloadHash(
  entry: xdr.SorobanAuthorizationEntry,
  networkPassphrase: string,
): Uint8Array {
  const creds = entry.credentials().address();
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(networkPassphrase)),
      nonce: creds.nonce(),
      signatureExpirationLedger: creds.signatureExpirationLedger(),
      invocation: entry.rootInvocation(),
    }),
  );
  return new Uint8Array(hash(preimage.toXDR()));
}

/**
 * The auth-entry signature ScVal for a WebAuthn assertion — a map matching the
 * contract's `Signature` struct. Soroban requires map keys in ascending order:
 * authenticator_data < client_data_json < signature.
 */
export function passkeySignatureScVal(assertion: PasskeyAssertion): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('authenticator_data'),
      val: xdr.ScVal.scvBytes(Buffer.from(assertion.authenticatorData)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('client_data_json'),
      val: xdr.ScVal.scvBytes(Buffer.from(assertion.clientDataJSON)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signature'),
      val: xdr.ScVal.scvBytes(Buffer.from(normalizeLowS(assertion.signature))),
    }),
  ]);
}

export interface SignAuthEntriesParams {
  /** Base64 transaction envelope whose invoke op carries the auth entries. */
  txXdr: string;
  networkPassphrase: string;
  /** The passkey smart account (C…) whose entries we can sign. */
  smartAccountId: string;
  rpId: string;
  credentialId: Uint8Array;
  /** Ledger sequence the signatures stay valid until (part of the signed payload). */
  signatureExpirationLedger: number;
  /**
   * WebAuthn origins the assertion's `clientDataJSON.origin` must match (audit
   * finding #5 / #127). Exact, case-sensitive per WebAuthn semantics. Defaults to
   * `['https://' + rpId]` — the origin a browser produces for this relying party —
   * so the check binds to the configured `rpId` unless a caller overrides it for a
   * platform/extension origin (e.g. `chrome-extension://…`).
   */
  allowedOrigins?: string[];
  credentials?: CredentialsApi;
}

/**
 * Sign every auth entry addressed to the passkey smart account, in place, and
 * return the updated envelope XDR. Prompts the authenticator once per entry
 * (the normal case is exactly one). Entries credentialed to other addresses
 * (or to the tx source) are left untouched. Throws if no entry matches — that
 * means the transaction doesn't actually authorize anything for this account.
 */
export async function signAuthEntriesWithPasskey(
  params: SignAuthEntriesParams,
): Promise<{ xdr: string; signed: number }> {
  const envelope = xdr.TransactionEnvelope.fromXDR(params.txXdr, 'base64');
  if (envelope.switch().name !== 'envelopeTypeTx') {
    throw new Error('Expected a plain (non-fee-bump) transaction envelope.');
  }
  // The origins we accept on the assertion's clientDataJSON. Default binds to the
  // configured rpId (the origin a browser produces for it); callers may override.
  const allowedOrigins = params.allowedOrigins ?? [`https://${params.rpId}`];
  const operations = envelope.v1().tx().operations();
  const invokeOp = operations.find((op) => op.body().switch().name === 'invokeHostFunction');
  if (!invokeOp) throw new Error('Transaction has no invokeHostFunction operation.');

  let signed = 0;
  for (const entry of invokeOp.body().invokeHostFunctionOp().auth()) {
    if (entry.credentials().switch().name !== 'sorobanCredentialsAddress') continue;
    const creds = entry.credentials().address();
    if (Address.fromScAddress(creds.address()).toString() !== params.smartAccountId) continue;

    creds.signatureExpirationLedger(params.signatureExpirationLedger);
    const payload = authEntryPayloadHash(entry, params.networkPassphrase);
    const assertion = await signWithPasskey({
      rpId: params.rpId,
      credentialId: params.credentialId,
      challenge: payload,
      ...(params.credentials ? { credentials: params.credentials } : {}),
    });
    // Never attach an assertion over the wrong payload OR from an unexpected
    // origin — the contract would reject the wrong challenge anyway, but binding
    // the origin here (audit finding #5 / #127) stops a malicious frame's replayed
    // assertion at the local pre-trust check, and gives a clear error either way.
    if (!assertionMatches(assertion.clientDataJSON, { expectedChallenge: payload, allowedOrigins })) {
      throw new Error(
        'The authenticator signed a different challenge or origin than requested.',
      );
    }
    creds.signature(passkeySignatureScVal(assertion));
    signed += 1;
  }

  if (signed === 0) {
    throw new Error('No authorization entry for the smart account was found.');
  }
  return { xdr: envelope.toXDR('base64'), signed };
}
