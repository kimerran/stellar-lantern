import { describe, it, expect } from 'vitest';
import { registerPasskey, signWithPasskey, type CredentialsApi } from '@core/passkey/webauthn';
import { webauthnSignedMessage } from '@core/passkey/assertion';

const enc = new TextEncoder();

// A P-256 keypair fixture standing in for the authenticator's credential key.
const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
const CRED_ID = new Uint8Array([9, 8, 7, 6]);

function rawToDer(raw: Uint8Array): Uint8Array {
  const derInt = (b: Uint8Array): number[] => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = Array.from(b.subarray(i));
    if ((v[0]! & 0x80) !== 0) v = [0x00, ...v];
    return [0x02, v.length, ...v];
  };
  const content = [...derInt(raw.subarray(0, 32)), ...derInt(raw.subarray(32, 64))];
  return new Uint8Array([0x30, content.length, ...content]);
}

// Fake create() credential: controllable public-key algorithm.
function fakeRegistration(alg: number): CredentialsApi {
  return {
    create: async () =>
      ({
        rawId: CRED_ID.buffer,
        response: {
          getPublicKeyAlgorithm: () => alg,
          getPublicKey: () => (alg === -7 ? spki.buffer : null),
        },
      }) as unknown as Credential,
    get: async () => null,
  };
}

describe('registerPasskey', () => {
  it('returns the SEC1 public key + credential id from an ES256 authenticator', async () => {
    const reg = await registerPasskey({
      rpId: 'lantern.app',
      rpName: 'Lantern',
      userId: enc.encode('user-1'),
      userName: 'alice',
      challenge: new Uint8Array([1, 2, 3]),
      credentials: fakeRegistration(-7),
    });
    expect(Buffer.from(reg.publicKey).equals(Buffer.from(rawPub))).toBe(true);
    expect(Buffer.from(reg.credentialId).equals(Buffer.from(CRED_ID))).toBe(true);
  });

  it('rejects a cancelled prompt', async () => {
    const cancelling: CredentialsApi = { create: async () => null, get: async () => null };
    await expect(
      registerPasskey({ rpId: 'x', rpName: 'x', userId: enc.encode('u'), userName: 'u', challenge: new Uint8Array([1]), credentials: cancelling }),
    ).rejects.toThrow(/cancelled/i);
  });

  it('rejects a non-ES256 (e.g. RS256) credential', async () => {
    await expect(
      registerPasskey({ rpId: 'x', rpName: 'x', userId: enc.encode('u'), userName: 'u', challenge: new Uint8Array([1]), credentials: fakeRegistration(-257) }),
    ).rejects.toThrow(/secp256r1|ES256/i);
  });
});

describe('signWithPasskey', () => {
  it('returns the assertion with a raw signature that verifies end-to-end', async () => {
    const challenge = new Uint8Array([42, 43, 44, 45]);
    const authenticatorData = new Uint8Array(37).fill(0x3b);
    const clientDataJSON = enc.encode(
      JSON.stringify({ type: 'webauthn.get', challenge: 'KissLQ', origin: 'https://lantern.app' }),
    );
    const signedMessage = await webauthnSignedMessage(authenticatorData, clientDataJSON);
    const rawSig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signedMessage));

    const api: CredentialsApi = {
      create: async () => null,
      get: async () =>
        ({
          rawId: CRED_ID.buffer,
          response: {
            authenticatorData: authenticatorData.buffer,
            clientDataJSON: clientDataJSON.buffer,
            signature: rawToDer(rawSig).buffer, // authenticators return DER
          },
        }) as unknown as Credential,
    };

    const assertion = await signWithPasskey({ rpId: 'lantern.app', credentialId: CRED_ID, challenge, credentials: api });
    expect(assertion.signature.length).toBe(64);

    // The wrapper's raw signature verifies over the reconstructed signed message.
    const verifyKey = await crypto.subtle.importKey('raw', rawPub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const msg = await webauthnSignedMessage(assertion.authenticatorData, assertion.clientDataJSON);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, assertion.signature, msg)).toBe(true);
  });

  it('rejects a cancelled prompt', async () => {
    const cancelling: CredentialsApi = { create: async () => null, get: async () => null };
    await expect(
      signWithPasskey({ rpId: 'x', credentialId: CRED_ID, challenge: new Uint8Array([1]), credentials: cancelling }),
    ).rejects.toThrow(/cancelled/i);
  });
});
