// Hand-written types for the hot-read helper, so the Vitest suite can import it
// from TypeScript without `allowJs` or an `any`. The script itself stays plain
// .mjs — it is a standalone operator tool, not part of the bundle.
import type { xdr } from '@stellar/stellar-sdk';

/** The contract's `Entry` struct, decoded. Nine fields: `index` arrived in #32. */
export interface DecodedEntry {
  subject: string;
  reporter: string;
  /** Unit-variant enum, unwrapped: `Scam` | `Phishing` | `Drainer` | `Poisoning` | `Mixer` | `Other`. */
  reason: string;
  /** Unit-variant enum, unwrapped: `Active` | `Disputed` | `Revoked`. */
  status: string;
  /** sha256 of the off-chain evidence, hex. All-zero means none. */
  evidence: string;
  reported_at: number;
  updated_at: number;
  reports: number;
  index: number;
}

/** Build the `LedgerKey` for `DataKey::Entry(subject)` — pure, offline. */
export function entryLedgerKey(contractId: string, subject: string): xdr.LedgerKey;

/** Decode a returned `ContractData` value into the contract's `Entry` shape. */
export function decodeEntry(val: xdr.ScVal): DecodedEntry;
