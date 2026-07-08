import { describe, it, expect } from 'vitest';
import {
  p256PublicKeyFromSpki,
  derToRawEcdsaSignature,
  PasskeyFormatError,
  P256_PUBLIC_KEY_BYTES,
  P256_SIGNATURE_BYTES,
} from '@core/passkey/secp256r1';

// A P-256 keypair fixture (the shape a WebAuthn passkey produces), built with
// WebCrypto so it works under the test runner's node polyfills.
const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const spkiDer = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
const message = new TextEncoder().encode('authorize this soroban op');
// WebCrypto signs in raw (r‖s); WebAuthn assertions are DER, so we DER-encode it
// to exercise derToRawEcdsaSignature and round-trip back.
const rawSig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, message));

// Minimal raw(r‖s) → DER SEQUENCE{INTEGER r, INTEGER s} (test-only inverse).
function rawToDer(raw: Uint8Array): Uint8Array {
  const derInt = (b: Uint8Array): number[] => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++; // strip leading zeros
    let v = Array.from(b.subarray(i));
    if ((v[0]! & 0x80) !== 0) v = [0x00, ...v]; // add sign byte if high bit set
    return [0x02, v.length, ...v];
  };
  const content = [...derInt(raw.subarray(0, 32)), ...derInt(raw.subarray(32, 64))];
  return new Uint8Array([0x30, content.length, ...content]);
}

describe('p256PublicKeyFromSpki', () => {
  it('extracts the 65-byte uncompressed SEC1 key from SPKI', async () => {
    const pub = await p256PublicKeyFromSpki(spkiDer);
    expect(pub.length).toBe(P256_PUBLIC_KEY_BYTES);
    expect(pub[0]).toBe(0x04); // uncompressed point marker
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
    expect(Buffer.from(pub).equals(Buffer.from(raw))).toBe(true);
  });

  it('rejects input that is not a P-256 SPKI key', async () => {
    await expect(p256PublicKeyFromSpki(new Uint8Array([1, 2, 3]))).rejects.toThrow(PasskeyFormatError);
  });
});

describe('derToRawEcdsaSignature', () => {
  it('round-trips a real signature (DER → raw) that still verifies', async () => {
    const der = rawToDer(rawSig);
    const raw = derToRawEcdsaSignature(der);
    expect(raw.length).toBe(P256_SIGNATURE_BYTES);
    expect(Buffer.from(raw).equals(Buffer.from(rawSig))).toBe(true);

    const pub = await p256PublicKeyFromSpki(spkiDer);
    const verifyKey = await crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, raw, message)).toBe(true);
  });

  it('left-pads a short r and strips the DER sign byte from a high-bit s', () => {
    // SEQUENCE { INTEGER r = 0x07, INTEGER s = 0x00 ‖ 32×0xAB (sign byte) }
    const der = new Uint8Array([0x30, 0x26, 0x02, 0x01, 0x07, 0x02, 0x21, 0x00, ...new Array(32).fill(0xab)]);
    const raw = derToRawEcdsaSignature(der);
    expect(raw.length).toBe(64);
    expect(raw[31]).toBe(0x07);
    expect(raw.slice(0, 31).every((b) => b === 0)).toBe(true); // r left-padded
    expect(raw.slice(32).every((b) => b === 0xab)).toBe(true); // s sign byte stripped
  });

  it('rejects malformed signatures', () => {
    expect(() => derToRawEcdsaSignature(new Uint8Array([0x31, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]))).toThrow(PasskeyFormatError); // not a SEQUENCE
    expect(() => derToRawEcdsaSignature(new Uint8Array([0x30, 0x04, 0x03, 0x01, 0x01, 0x02, 0x01, 0x01]))).toThrow(PasskeyFormatError); // r not an INTEGER
    expect(() => derToRawEcdsaSignature(new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0xff]))).toThrow(PasskeyFormatError); // trailing byte
  });
});
