// Passkey ↔ Soroban format primitives (#53, Milestone 2b). A WebAuthn passkey is
// a secp256r1 (NIST P-256) credential; a Soroban secp256r1 smart account binds
// the *raw* public key as its signer and verifies *raw* (r‖s) signatures. But the
// browser hands us the key as SPKI DER (`credential.response.getPublicKey()`) and
// each assertion signature as ASN.1-DER ECDSA — so these pure converters bridge
// the two encodings. No WebAuthn/native calls here (those are a later slice);
// this is the offline-testable crypto core.

/** 65-byte uncompressed SEC1 point (0x04 ‖ X32 ‖ Y32). */
export const P256_PUBLIC_KEY_BYTES = 65;
/** 64-byte raw ECDSA signature (R32 ‖ S32). */
export const P256_SIGNATURE_BYTES = 64;

export class PasskeyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasskeyFormatError';
  }
}

/**
 * Extract the raw secp256r1 public key (65-byte uncompressed SEC1) from an SPKI
 * DER key — what `PublicKeyCredential`'s `getPublicKey()` returns. Uses WebCrypto
 * to import (which *validates* the point is a real P-256 key, rejecting junk) then
 * exports the raw point. Throws `PasskeyFormatError` if it isn't a P-256 SPKI key.
 */
export async function p256PublicKeyFromSpki(spki: Uint8Array): Promise<Uint8Array> {
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'spki',
      // Fresh ArrayBuffer-backed copy (avoids SharedArrayBuffer typing).
      Uint8Array.from(spki),
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify'],
    );
  } catch {
    throw new PasskeyFormatError('Not a valid P-256 SPKI public key.');
  }
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  if (raw.length !== P256_PUBLIC_KEY_BYTES || raw[0] !== 0x04) {
    throw new PasskeyFormatError('Unexpected public-key encoding.');
  }
  return raw;
}

// Read one DER INTEGER (0x02 len value) at `offset`; return its 32-byte big-endian
// magnitude (DER sign byte stripped, left-padded) and the next offset.
function readDerInt(der: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  if (der[offset] !== 0x02) throw new PasskeyFormatError('Malformed ECDSA signature (expected INTEGER).');
  const len = der[offset + 1];
  if (len === undefined || len === 0 || len > 33) {
    throw new PasskeyFormatError('Malformed ECDSA signature (bad INTEGER length).');
  }
  const start = offset + 2;
  const end = start + len;
  if (end > der.length) throw new PasskeyFormatError('Malformed ECDSA signature (truncated).');
  let bytes = der.subarray(start, end);
  // DER prepends a 0x00 when the high bit is set (to keep the INTEGER positive).
  if (bytes.length === 33) {
    if (bytes[0] !== 0x00) throw new PasskeyFormatError('Malformed ECDSA signature (oversized INTEGER).');
    bytes = bytes.subarray(1);
  }
  if (bytes.length > 32) throw new PasskeyFormatError('ECDSA integer too large for P-256.');
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length); // left-pad to 32
  return { value: out, next: end };
}

// P-256 group order n (and n/2), for low-S signature normalization.
const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const P256_HALF_N = P256_N >> 1n;

/**
 * Normalize a raw 64-byte r‖s ECDSA signature to its canonical low-S form
 * (s ≤ n/2, flipping s → n−s when needed — both are valid ECDSA, but WebAuthn
 * authenticators may emit either and on-chain verifiers can insist on low-S).
 * Returns the input untouched when already low-S. Pure.
 */
export function normalizeLowS(rawSig: Uint8Array): Uint8Array {
  if (rawSig.length !== P256_SIGNATURE_BYTES) {
    throw new PasskeyFormatError('Signature must be 64 bytes of r‖s.');
  }
  let s = 0n;
  for (let i = 32; i < 64; i++) s = (s << 8n) | BigInt(rawSig[i]!);
  if (s <= P256_HALF_N) return rawSig;
  let flipped = P256_N - s;
  const out = Uint8Array.from(rawSig);
  for (let i = 63; i >= 32; i--) {
    out[i] = Number(flipped & 0xffn);
    flipped >>= 8n;
  }
  return out;
}

/**
 * Convert an ASN.1-DER ECDSA signature (`SEQUENCE { INTEGER r, INTEGER s }`, as
 * WebAuthn assertions return) into the fixed 64-byte raw form (R32 ‖ S32) that
 * Soroban's secp256r1 verification expects. Throws `PasskeyFormatError` on any
 * malformed input. Pure.
 */
export function derToRawEcdsaSignature(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new PasskeyFormatError('Malformed ECDSA signature (expected SEQUENCE).');
  const seqLen = der[1];
  // P-256 signatures are well under 128 bytes, so the length is a single byte.
  if (seqLen === undefined || seqLen & 0x80 || seqLen !== der.length - 2) {
    throw new PasskeyFormatError('Malformed ECDSA signature (bad SEQUENCE length).');
  }
  const r = readDerInt(der, 2);
  const s = readDerInt(der, r.next);
  if (s.next !== der.length) throw new PasskeyFormatError('Malformed ECDSA signature (trailing bytes).');
  const out = new Uint8Array(P256_SIGNATURE_BYTES);
  out.set(r.value, 0);
  out.set(s.value, 32);
  return out;
}
