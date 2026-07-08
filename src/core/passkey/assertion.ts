// WebAuthn assertion helpers for passkey signing (#53, Milestone 2b). When a
// passkey signs, the authenticator signs the bytes `authenticatorData ‖
// SHA-256(clientDataJSON)` — NOT the raw challenge. A Soroban secp256r1 smart
// account verifies exactly that, and the challenge (what we actually want signed,
// e.g. a transaction hash) is embedded in `clientDataJSON`. These pure helpers
// reconstruct the signed message and confirm the challenge, so the wallet can
// (a) verify an assertion locally and (b) hand the contract the right payload.
//
// No `navigator.credentials` calls here (those are thin device-gated forwarders,
// a later slice) — this is the offline-testable core.

export interface ClientData {
  type: string; // 'webauthn.get' for an assertion, 'webauthn.create' for registration
  challenge: string; // base64url, no padding — what the authenticator was asked to sign over
  origin: string;
}

const decoder = new TextDecoder();

/** Parse the UTF-8 `clientDataJSON` an authenticator returns. Throws on bad JSON. */
export function parseClientData(clientDataJSON: Uint8Array): ClientData {
  let obj: unknown;
  try {
    obj = JSON.parse(decoder.decode(clientDataJSON));
  } catch {
    throw new Error('Malformed clientDataJSON.');
  }
  const { type, challenge, origin } = (obj ?? {}) as Record<string, unknown>;
  if (typeof type !== 'string' || typeof challenge !== 'string' || typeof origin !== 'string') {
    throw new Error('clientDataJSON is missing type / challenge / origin.');
  }
  return { type, challenge, origin };
}

// WebAuthn base64url: no padding, `-`/`_` for `+`/`/`.
function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * True when the assertion's `clientDataJSON` is a `webauthn.get` whose challenge
 * equals `expected` — i.e. the authenticator signed over *our* payload (a tx
 * hash), not something the site swapped in. Guards against a replayed / mismatched
 * assertion before we trust the signature.
 */
export function challengeMatches(clientDataJSON: Uint8Array, expected: Uint8Array): boolean {
  let data: ClientData;
  try {
    data = parseClientData(clientDataJSON);
  } catch {
    return false;
  }
  if (data.type !== 'webauthn.get') return false;
  try {
    return bytesEqual(base64urlToBytes(data.challenge), expected);
  } catch {
    return false;
  }
}

/**
 * The exact message an authenticator signs for an assertion:
 * `authenticatorData ‖ SHA-256(clientDataJSON)`. Feed this (with the raw r‖s
 * signature) to `crypto.subtle.verify` / the Soroban secp256r1 contract.
 */
export async function webauthnSignedMessage(
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
): Promise<Uint8Array> {
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const out = new Uint8Array(authenticatorData.length + clientHash.length);
  out.set(authenticatorData, 0);
  out.set(clientHash, authenticatorData.length);
  return out;
}
