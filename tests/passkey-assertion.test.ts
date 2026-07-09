import { describe, it, expect } from 'vitest';
import { parseClientData, challengeMatches, webauthnSignedMessage } from '@core/passkey/assertion';

const enc = new TextEncoder();

function bytesToBase64url(b: Uint8Array): string {
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function clientData(type: string, challenge: Uint8Array, origin = 'https://lantern.app'): Uint8Array {
  return enc.encode(JSON.stringify({ type, challenge: bytesToBase64url(challenge), origin }));
}

const challenge = new Uint8Array([1, 2, 3, 4, 250, 251, 252, 253]); // includes bytes that need base64url

describe('parseClientData', () => {
  it('extracts type / challenge / origin', () => {
    const cd = parseClientData(clientData('webauthn.get', challenge));
    expect(cd.type).toBe('webauthn.get');
    expect(cd.origin).toBe('https://lantern.app');
    expect(cd.challenge).toBe(bytesToBase64url(challenge));
  });

  it('throws on malformed JSON or missing fields', () => {
    expect(() => parseClientData(enc.encode('not json'))).toThrow();
    expect(() => parseClientData(enc.encode('{"type":"webauthn.get"}'))).toThrow();
  });
});

describe('challengeMatches', () => {
  it('accepts an assertion whose challenge equals the expected payload', () => {
    expect(challengeMatches(clientData('webauthn.get', challenge), challenge)).toBe(true);
  });

  it('rejects a different challenge, a non-get type, or malformed data', () => {
    expect(challengeMatches(clientData('webauthn.get', challenge), new Uint8Array([9, 9]))).toBe(false);
    expect(challengeMatches(clientData('webauthn.create', challenge), challenge)).toBe(false); // registration, not assertion
    expect(challengeMatches(enc.encode('garbage'), challenge)).toBe(false);
  });

  // Regression: base64url re-padding must work for every byte length, not just
  // the 32-byte (mod-3) tx-hash path. A ≡1 (mod 3) length (16, 31, 64…) yields a
  // b64 length ≡ 2 (mod 4) needing TWO `=` — the earlier 2-char pad broke these.
  it.each([1, 2, 3, 15, 16, 31, 32, 33, 64])('matches a %i-byte challenge', (len) => {
    const c = new Uint8Array(len);
    for (let i = 0; i < len; i++) c[i] = (i * 37 + 5) & 0xff;
    expect(challengeMatches(clientData('webauthn.get', c), c)).toBe(true);
  });
});

describe('webauthnSignedMessage', () => {
  it('is authenticatorData ‖ SHA-256(clientDataJSON)', async () => {
    const authData = new Uint8Array(37).fill(0xa1); // rpIdHash(32)+flags(1)+counter(4)
    const cd = clientData('webauthn.get', challenge);
    const msg = await webauthnSignedMessage(authData, cd);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', cd));
    expect(msg.length).toBe(37 + 32);
    expect(Buffer.from(msg.subarray(0, 37)).equals(Buffer.from(authData))).toBe(true);
    expect(Buffer.from(msg.subarray(37)).equals(Buffer.from(hash))).toBe(true);
  });

  it('produces a message a P-256 key can sign and that then verifies', async () => {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    const authData = new Uint8Array(37).fill(0x5c);
    const cd = clientData('webauthn.get', challenge);
    const msg = await webauthnSignedMessage(authData, cd);
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, msg);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, sig, msg)).toBe(true);
  });
});
