import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { randomBytes } from '@noble/hashes/utils';
import englishWordlist from 'bip39/src/wordlists/english.json';

// English-only BIP-39, faithfully ported from bip39@3.1.0's src/index.js.
//
// Importing the `bip39` package barrel pulls in `src/_wordlists.js`, which
// statically `require()`s ALL 10 language wordlists (~296 KB of the worker
// bundle) — the try/catch requires are side-effecting, so passing the English
// list explicitly to the barrel's functions does NOT let the other 9 lists
// tree-shake out. This module reimplements the exact same algorithm over the
// same @noble/hashes primitives bip39 uses internally, importing only the
// English wordlist, so the wallet bundle contains just the one list we use.
// Behaviour is byte-for-byte identical to bip39 for English mnemonics (see the
// SEP-0005 vector and the bip39-parity checks in tests/wallet.test.ts).

const wordlist: string[] = englishWordlist;

const INVALID_MNEMONIC = 'Invalid mnemonic';
const INVALID_ENTROPY = 'Invalid entropy';
const INVALID_CHECKSUM = 'Invalid mnemonic checksum';

function normalize(str?: string): string {
  return (str || '').normalize('NFKD');
}

function lpad(str: string, padString: string, length: number): string {
  while (str.length < length) str = padString + str;
  return str;
}

function binaryToByte(bin: string): number {
  return parseInt(bin, 2);
}

function bytesToBinary(bytes: number[]): string {
  return bytes.map((x) => lpad(x.toString(2), '0', 8)).join('');
}

function deriveChecksumBits(entropyBuffer: Uint8Array): string {
  const ENT = entropyBuffer.length * 8;
  const CS = ENT / 32;
  const hash = sha256(entropyBuffer);
  return bytesToBinary(Array.from(hash)).slice(0, CS);
}

function salt(password?: string): string {
  return 'mnemonic' + (password || '');
}

function mnemonicToEntropy(mnemonic: string): string {
  const words = normalize(mnemonic).split(' ');
  if (words.length % 3 !== 0) throw new Error(INVALID_MNEMONIC);
  // convert word indices to 11 bit binary strings
  const bits = words
    .map((word) => {
      const index = wordlist.indexOf(word);
      if (index === -1) throw new Error(INVALID_MNEMONIC);
      return lpad(index.toString(2), '0', 11);
    })
    .join('');
  // split the binary string into ENT/CS
  const dividerIndex = Math.floor(bits.length / 33) * 32;
  const entropyBits = bits.slice(0, dividerIndex);
  const checksumBits = bits.slice(dividerIndex);
  // calculate the checksum and compare
  const entropyBytes = (entropyBits.match(/(.{1,8})/g) || []).map(binaryToByte);
  if (entropyBytes.length < 16) throw new Error(INVALID_ENTROPY);
  if (entropyBytes.length > 32) throw new Error(INVALID_ENTROPY);
  if (entropyBytes.length % 4 !== 0) throw new Error(INVALID_ENTROPY);
  const entropy = Uint8Array.from(entropyBytes);
  const newChecksum = deriveChecksumBits(entropy);
  if (newChecksum !== checksumBits) throw new Error(INVALID_CHECKSUM);
  return Buffer.from(entropy).toString('hex');
}

function entropyToMnemonic(entropy: Uint8Array): string {
  // 128 <= ENT <= 256
  if (entropy.length < 16) throw new TypeError(INVALID_ENTROPY);
  if (entropy.length > 32) throw new TypeError(INVALID_ENTROPY);
  if (entropy.length % 4 !== 0) throw new TypeError(INVALID_ENTROPY);
  const entropyBits = bytesToBinary(Array.from(entropy));
  const checksumBits = deriveChecksumBits(entropy);
  const bits = entropyBits + checksumBits;
  const chunks = bits.match(/(.{1,11})/g) || [];
  const words = chunks.map((binary) => wordlist[binaryToByte(binary)]);
  // English wordlist joins with a regular space (only Japanese uses U+3000).
  return words.join(' ');
}

export function generateMnemonic(strength = 128): string {
  if (strength % 32 !== 0) throw new TypeError(INVALID_ENTROPY);
  return entropyToMnemonic(randomBytes(strength / 8));
}

export function validateMnemonic(mnemonic: string): boolean {
  try {
    mnemonicToEntropy(mnemonic);
  } catch {
    return false;
  }
  return true;
}

export function mnemonicToSeedSync(mnemonic: string, password?: string): Buffer {
  const mnemonicBuffer = Uint8Array.from(Buffer.from(normalize(mnemonic), 'utf8'));
  const saltBuffer = Uint8Array.from(Buffer.from(salt(normalize(password)), 'utf8'));
  const res = pbkdf2(sha512, mnemonicBuffer, saltBuffer, { c: 2048, dkLen: 64 });
  return Buffer.from(res);
}
