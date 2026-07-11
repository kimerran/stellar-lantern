import { describe, it, expect } from 'vitest';
import {
  p256PublicKeyFromSpki,
  derToRawEcdsaSignature,
  PasskeyFormatError,
  P256_PUBLIC_KEY_BYTES,
  P256_SIGNATURE_BYTES,
  normalizeLowS,
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

describe('normalizeLowS', () => {
  const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const HALF_N = N >> 1n;

  const toBytes32 = (n: bigint): Uint8Array => {
    const out = new Uint8Array(32);
    for (let i = 31; i >= 0; i--) {
      out[i] = Number(n & 0xffn);
      n >>= 8n;
    }
    return out;
  };
  const sOf = (sig: Uint8Array): bigint =>
    sig.subarray(32).reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);

  it('flips a high-S signature to n - s', () => {
    const s = HALF_N + 12345n; // definitely high
    const sig = new Uint8Array(64);
    sig.set(toBytes32(1n), 0); // r = 1 (untouched)
    sig.set(toBytes32(s), 32);
    const normalized = normalizeLowS(sig);
    expect(sOf(normalized)).toBe(N - s);
    expect(Buffer.from(normalized.subarray(0, 32)).equals(Buffer.from(sig.subarray(0, 32)))).toBe(true);
  });

  it('returns a low-S signature unchanged', () => {
    const sig = new Uint8Array(64);
    sig.set(toBytes32(7n), 0);
    sig.set(toBytes32(HALF_N), 32); // s == n/2 counts as low
    expect(Buffer.from(normalizeLowS(sig)).equals(Buffer.from(sig))).toBe(true);
  });

  it('a forced-high-S real signature still verifies after normalization', async () => {
    // Take the fixture signature; force s high (s' = n - s is also valid ECDSA
    // pre-normalization); normalizeLowS must give back a verifying signature.
    const s = sOf(rawSig);
    const high = new Uint8Array(rawSig);
    high.set(toBytes32(N - s), 32);
    const normalized = normalizeLowS(high);
    expect(sOf(normalized) <= HALF_N).toBe(true);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      keyPair.publicKey,
      normalized,
      message,
    );
    expect(ok).toBe(true);
  });

  it('rejects a wrong-length signature', () => {
    expect(() => normalizeLowS(new Uint8Array(63))).toThrow(PasskeyFormatError);
  });
});
