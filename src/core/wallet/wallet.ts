import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { generateMnemonic as bip39Generate, mnemonicToSeedSync, validateMnemonic } from 'bip39';
import { deriveEd25519Seed } from './derivation';

// SEP-0005 derivation for Stellar account 0 (path m/44'/148'/0'). We use bip39
// (pure-JS @noble/hashes) for the mnemonic + seed and our own SLIP-0010 ed25519
// derivation (see ./derivation.ts) so the worker bundle never pulls in the
// fragile create-hmac/crypto-browserify chain.

export type MnemonicStrength = 128 | 256; // 12 or 24 words
const STELLAR_PATH = "m/44'/148'/0'";

export function generateMnemonic(strength: MnemonicStrength = 128): string {
  return bip39Generate(strength);
}

export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(normalizeMnemonic(mnemonic));
}

export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function keypairFromMnemonic(mnemonic: string): Keypair {
  const normalized = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(normalized)) throw new InvalidImportError();
  const seed = new Uint8Array(mnemonicToSeedSync(normalized)); // 64-byte BIP-39 seed
  const rawEd25519Seed = deriveEd25519Seed(STELLAR_PATH, seed);
  return Keypair.fromRawEd25519Seed(Buffer.from(rawEd25519Seed));
}

export function keypairFromSecret(secret: string): Keypair {
  return Keypair.fromSecret(secret.trim());
}

export interface ImportResult {
  keypair: Keypair;
  /** The exact secret to encrypt at rest: the mnemonic or the S... seed. */
  secretToStore: string;
}

export class InvalidImportError extends Error {
  constructor() {
    super('Enter a valid 12/24-word recovery phrase or a Stellar secret key (starts with S).');
    this.name = 'InvalidImportError';
  }
}

// Accepts either a BIP-39 mnemonic or a raw S... secret seed.
export function importFromInput(input: string): ImportResult {
  const trimmed = input.trim();
  if (StrKey.isValidEd25519SecretSeed(trimmed)) {
    return { keypair: keypairFromSecret(trimmed), secretToStore: trimmed };
  }
  const normalized = normalizeMnemonic(trimmed);
  if (isValidMnemonic(normalized)) {
    return { keypair: keypairFromMnemonic(normalized), secretToStore: normalized };
  }
  throw new InvalidImportError();
}

// Re-derive a Keypair from whatever secret was stored (mnemonic or S... seed).
export function keypairFromStoredSecret(secret: string): Keypair {
  if (StrKey.isValidEd25519SecretSeed(secret)) return keypairFromSecret(secret);
  return keypairFromMnemonic(secret);
}

export function isValidPublicKey(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address.trim());
}
