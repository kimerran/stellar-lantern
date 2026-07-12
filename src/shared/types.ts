import type { NetworkId } from './constants';

// Persisted in chrome.storage.local. Only the *encrypted* secret is stored.
export interface StoredVault {
  version: 1;
  address: string; // G... public key
  cipher: VaultCipher;
}

export interface VaultCipher {
  algorithm: 'AES-GCM';
  kdf: 'PBKDF2';
  salt: string; // base64
  iv: string; // base64
  iterations: number;
  ciphertext: string; // base64 — encrypts the mnemonic/seed
}

// A passkey smart account (#53): a Soroban contract whose signer is a device
// passkey. Everything here is PUBLIC (the contract address, the WebAuthn
// credential id, the public key) — there is no secret to protect, which is the
// point: the signing key never leaves the authenticator.
export interface PasskeyAccountRecord {
  version: 1;
  network: 'TESTNET'; // passkey accounts are testnet-only for now (friendbot fees)
  contractId: string; // C… smart-account address
  credentialId: string; // base64url WebAuthn credential id
  publicKey: string; // hex, 65-byte SEC1 P-256 public key
  rpId: string; // relying-party id the credential was registered under
}

export interface Settings {
  network: NetworkId;
  autoLockMinutes: number;
  // Optional per-network endpoint overrides, edited behind the Settings hub's
  // "Advanced" disclosure (#110). Empty/unset → the pinned public defaults in
  // constants. Applied centrally by resolveNetworkConfig (shared/network.ts).
  horizonOverrides?: { testnet?: string; public?: string };
  rpcOverrides?: { testnet?: string; public?: string };
  // Mini-app directory "favorites" / installs (#93): a list of MiniApp ids the
  // user pinned to their "My apps" section. Plain, non-secret metadata — a
  // bookmark, NOT elevated permissions. Lives in Settings so it live-updates
  // across surfaces for free via onSettingsChanged.
  favoriteApps?: string[];
}

// A single asset balance for display.
export interface AssetBalance {
  code: string; // "XLM" for native
  issuer?: string; // undefined for native
  balance: string; // full-precision string
  isNative: boolean;
}

export interface AccountState {
  funded: boolean;
  balances: AssetBalance[];
  // subentry count used for reserve math (native only)
  subentryCount: number;
}

// An account's on-chain signers + thresholds (for the guardians view).
export interface AccountSigner {
  key: string;
  weight: number;
}
export interface AccountThresholds {
  low: number;
  med: number;
  high: number;
}

export type TxDirection = 'sent' | 'received' | 'swap' | 'create';

export interface HistoryItem {
  id: string;
  hash: string;
  direction: TxDirection;
  title: string;
  counterparty: string | null; // other party address (already truncated upstream? no — full)
  amount: string | null; // absolute amount string
  signedAmount: string | null; // e.g. "+12.5" / "-3.0"
  assetCode: string;
  createdAt: string; // ISO timestamp
  memo?: string;
  fee?: string;
  ledger?: number;
  successful: boolean;
}

export interface HistoryPage {
  items: HistoryItem[];
  nextCursor: string | null;
}
