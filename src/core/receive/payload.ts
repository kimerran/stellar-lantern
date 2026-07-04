import { StrKey } from '@stellar/stellar-sdk';

// The payload encoded into a "Receive" QR code. For a plain address receive the
// standard is the raw account public key (G…) — a bare address every Stellar
// wallet scanner understands. A SEP-0007 `web+stellar:pay?destination=…` URI
// (amount/memo/asset request) is a deliberate follow-up.
//
// Pure + side-effect-free so it can be unit-tested without a DOM/canvas.
export function receiveQrPayload(address: string): string {
  const trimmed = address.trim();
  if (!StrKey.isValidEd25519PublicKey(trimmed)) {
    throw new Error('Not a valid Stellar address.');
  }
  return trimmed;
}
