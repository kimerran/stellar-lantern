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

export interface Settings {
  network: NetworkId;
  autoLockMinutes: number;
  horizonOverrides?: { testnet?: string; public?: string };
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
