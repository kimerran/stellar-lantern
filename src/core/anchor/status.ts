// SEP-24 transfer-status → human-readable label.
//
// An anchor reports the state of a deposit/withdrawal via the `status` field on
// `GET /transaction` (SEP-24 §"Transaction History"). This module turns that raw
// enum into something we can render in the Activity/history view: a concise
// user-facing label, a coarse `kind` for styling/iconography, and whether the
// state is terminal (so a poller knows when to stop).
//
// Pure: a lookup table + a defensive fallback. No fetching, no side effects.

export type TransferStatusKind = 'pending' | 'action-needed' | 'done' | 'error';

export interface TransferStatusInfo {
  /** Concise, plain-language description for the wallet UI. */
  label: string;
  /** Coarse bucket for styling and progress semantics. */
  kind: TransferStatusKind;
  /** True once the transfer has reached a final state and polling can stop. */
  terminal: boolean;
}

// Returned for unrecognized input. The status comes from an anchor we don't
// fully trust, so an unknown value must degrade gracefully rather than throw.
const FALLBACK: TransferStatusInfo = { label: 'Processing…', kind: 'pending', terminal: false };

const STATUS_TABLE: Record<string, TransferStatusInfo> = {
  // Non-terminal, needs the user to act.
  incomplete: { label: 'Not finished — more info needed', kind: 'action-needed', terminal: false },
  pending_user_transfer_start: {
    label: 'Waiting for you to send funds',
    kind: 'action-needed',
    terminal: false,
  },
  pending_user_transfer_complete: {
    label: 'Waiting for you to complete the transfer',
    kind: 'action-needed',
    terminal: false,
  },
  pending_trust: { label: 'Add a trustline to receive this asset', kind: 'action-needed', terminal: false },
  pending_user: { label: 'Action needed from you', kind: 'action-needed', terminal: false },

  // Non-terminal, waiting on the anchor / network.
  pending_external: { label: 'Processing on the external network', kind: 'pending', terminal: false },
  pending_anchor: { label: 'Processing with the anchor', kind: 'pending', terminal: false },
  pending_stellar: { label: 'Settling on Stellar', kind: 'pending', terminal: false },
  on_hold: { label: 'On hold for review', kind: 'pending', terminal: false },

  // Terminal, successful.
  completed: { label: 'Completed', kind: 'done', terminal: true },
  refunded: { label: 'Refunded', kind: 'done', terminal: true },

  // Terminal, unsuccessful.
  expired: { label: 'Expired', kind: 'error', terminal: true },
  error: { label: 'Failed', kind: 'error', terminal: true },
  no_market: { label: 'No market for this asset', kind: 'error', terminal: true },
  too_small: { label: 'Amount is below the minimum', kind: 'error', terminal: true },
  too_large: { label: 'Amount is above the maximum', kind: 'error', terminal: true },
};

/**
 * Describe a SEP-24 transfer status for display in the wallet.
 *
 * Unknown or malformed statuses fall back to a safe "Processing…" pending state
 * instead of throwing — callers can render anchor-provided values directly.
 */
export function describeTransferStatus(status: string): TransferStatusInfo {
  return STATUS_TABLE[status] ?? FALLBACK;
}
