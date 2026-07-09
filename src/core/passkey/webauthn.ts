// WebAuthn register / sign wrappers for passkey signing (#53, Milestone 2b). The
// thin device-facing layer that calls `navigator.credentials` and hands the raw
// bytes to the pure format helpers (secp256r1.ts / assertion.ts). Registration
// yields the secp256r1 public key to bind as a Soroban smart-account signer;
// signing yields the assertion (authenticatorData + clientDataJSON + raw r‖s
// signature) the contract verifies.
//
// The `credentials` API is injectable so the wrapper logic is unit-testable
// without a real authenticator; production defaults to `navigator.credentials`.

import { p256PublicKeyFromSpki, derToRawEcdsaSignature } from './secp256r1';

// ES256 (ECDSA over P-256 / secp256r1) — the only algorithm we accept.
const ES256 = -7;

// The subset of the browser Credentials Management API we use.
export interface CredentialsApi {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
}

export interface RegisteredPasskey {
  /** Credential id to reference this passkey in later assertions. */
  credentialId: Uint8Array;
  /** 65-byte uncompressed SEC1 public key — the Soroban smart-account signer. */
  publicKey: Uint8Array;
}

export interface RegisterPasskeyParams {
  rpId: string;
  rpName: string;
  userId: Uint8Array;
  userName: string;
  challenge: Uint8Array;
  credentials?: CredentialsApi;
}

export interface PasskeyAssertion {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  /** Raw 64-byte r‖s signature (converted from the assertion's DER form). */
  signature: Uint8Array;
}

export interface SignWithPasskeyParams {
  rpId: string;
  credentialId: Uint8Array;
  /** The payload to sign (e.g. a transaction hash); becomes the assertion challenge. */
  challenge: Uint8Array;
  credentials?: CredentialsApi;
}

function browserCredentials(): CredentialsApi {
  const creds = globalThis.navigator?.credentials as CredentialsApi | undefined;
  if (!creds) throw new Error('WebAuthn is not available in this environment.');
  return creds;
}

/**
 * Register a new secp256r1 passkey and return its public key (to bind as a smart-
 * account signer) + credential id. Requests a **resident key** with **user
 * verification** and only `ES256`, so the result is always a P-256 credential.
 * Rejects a cancelled prompt or a non-ES256 authenticator.
 */
export async function registerPasskey(params: RegisterPasskeyParams): Promise<RegisteredPasskey> {
  const api = params.credentials ?? browserCredentials();
  const credential = await api.create({
    publicKey: {
      rp: { id: params.rpId, name: params.rpName },
      user: { id: params.userId, name: params.userName, displayName: params.userName },
      challenge: params.challenge,
      pubKeyCredParams: [{ type: 'public-key', alg: ES256 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 60_000,
    },
  });
  if (!credential) throw new Error('Passkey registration was cancelled.');

  const cred = credential as PublicKeyCredential;
  const response = cred.response as AuthenticatorAttestationResponse;
  if (response.getPublicKeyAlgorithm?.() !== ES256) {
    throw new Error('This passkey is not a secp256r1 (ES256) credential.');
  }
  const spki = response.getPublicKey?.();
  if (!spki) throw new Error('The authenticator did not return a usable public key.');

  return {
    credentialId: new Uint8Array(cred.rawId),
    publicKey: await p256PublicKeyFromSpki(new Uint8Array(spki)),
  };
}

/**
 * Produce a passkey assertion over `challenge` (a tx hash). Returns the pieces the
 * Soroban secp256r1 contract needs: the authenticator data, the clientDataJSON
 * (which embeds the challenge), and the signature converted to raw 64-byte r‖s.
 */
export async function signWithPasskey(params: SignWithPasskeyParams): Promise<PasskeyAssertion> {
  const api = params.credentials ?? browserCredentials();
  const credential = await api.get({
    publicKey: {
      rpId: params.rpId,
      challenge: params.challenge,
      allowCredentials: [{ type: 'public-key', id: params.credentialId }],
      userVerification: 'required',
      timeout: 60_000,
    },
  });
  if (!credential) throw new Error('Passkey signing was cancelled.');

  const response = (credential as PublicKeyCredential).response as AuthenticatorAssertionResponse;
  return {
    authenticatorData: new Uint8Array(response.authenticatorData),
    clientDataJSON: new Uint8Array(response.clientDataJSON),
    signature: derToRawEcdsaSignature(new Uint8Array(response.signature)),
  };
}
