import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';

// SEP-0005 key derivation = SLIP-0010 for the ed25519 curve.
//
// We implement this with the pure-JS @noble/hashes (already a transitive dep of
// bip39 / stellar-base) instead of stellar-hd-wallet, whose `create-hmac`
// dependency is part of the crypto-browserify chain that breaks when bundled
// into an MV3 service worker / web worker. See src/shared/polyfills.ts and the
// commit that introduced this module.

const ED25519_CURVE = new TextEncoder().encode('ed25519 seed');
const HARDENED_OFFSET = 0x80000000;

interface Node {
  key: Uint8Array; // 32-byte private key (IL)
  chainCode: Uint8Array; // 32-byte chain code (IR)
}

function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha512, key, data);
}

function masterFromSeed(seed: Uint8Array): Node {
  const I = hmacSha512(ED25519_CURVE, seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

// Hardened CKD for ed25519: data = 0x00 || key || ser32(index).
function ckdPriv(node: Node, index: number): Node {
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(node.key, 1);
  new DataView(data.buffer).setUint32(33, index >>> 0, false); // big-endian
  const I = hmacSha512(node.chainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

const PATH_RE = /^m(\/\d+')+$/;

// Derive the 32-byte ed25519 raw seed for a full hardened BIP-44 path
// (e.g. m/44'/148'/0'). All segments must be hardened.
export function deriveEd25519Seed(path: string, seed: Uint8Array): Uint8Array {
  if (!PATH_RE.test(path)) throw new Error(`Invalid derivation path: ${path}`);
  const segments = path
    .split('/')
    .slice(1)
    .map((s) => parseInt(s.replace("'", ''), 10));
  let node = masterFromSeed(seed);
  for (const segment of segments) {
    node = ckdPriv(node, segment + HARDENED_OFFSET);
  }
  return node.key;
}
