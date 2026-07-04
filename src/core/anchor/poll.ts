// SEP-24 transaction status polling (#24). After `startInteractive` hands back a
// transaction id, the wallet polls `GET /transaction` until the deposit/withdraw
// reaches a terminal state (completed / refunded / expired / error / …). This is
// that loop as a pure, injectable primitive: the `fetch` and the inter-poll
// `wait` are both injected, so the whole thing is unit-testable offline with no
// real timers, and an `onUpdate` callback lets the UI reflect each status change
// (and, via `describeTransferStatus`, know when to stop). No DOM, no side effects
// beyond the injected transport.

import { fetchTransaction, type TransferTransaction } from './sep24';
import { describeTransferStatus, type TransferStatusInfo } from './status';

export interface TransferStatusUpdate {
  transaction: TransferTransaction;
  info: TransferStatusInfo; // label / kind / terminal for tx.status
}

export interface PollTransferOptions {
  transferServer: string; // SEP-1 TRANSFER_SERVER_SEP0024
  id: string; // transaction id from startInteractive
  jwt: string; // SEP-10 token
  fetchImpl?: typeof fetch;
  // Delay between polls, injected as a function so tests resolve instantly.
  wait?: (ms: number) => Promise<void>;
  intervalMs?: number; // default 5000
  maxAttempts?: number; // default 60 (~5 min at the default interval)
  onUpdate?: (u: TransferStatusUpdate) => void; // fired on each *status change*
  isCancelled?: () => boolean; // stop early (e.g. the screen unmounted)
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a SEP-24 transaction until it reaches a terminal status, `maxAttempts`
 * is hit, or `isCancelled()` returns true; resolves with the last status seen.
 *
 * `onUpdate` fires only when the status actually changes (so a UI subscription
 * isn't spammed with identical `pending_anchor` ticks). Terminal is decided by
 * `describeTransferStatus(...).terminal`, so unknown/future anchor statuses keep
 * polling (they map to the safe non-terminal fallback) rather than stopping early.
 *
 * A failure on the *first* fetch throws (there is nothing to report yet); a
 * transient failure on a later poll is swallowed and retried, so one flaky
 * request doesn't abort a long-running transfer.
 */
export async function pollTransferStatus(opts: PollTransferOptions): Promise<TransferStatusUpdate> {
  const {
    transferServer,
    id,
    jwt,
    fetchImpl = fetch,
    wait = defaultWait,
    intervalMs = 5000,
    maxAttempts = 60,
    onUpdate,
    isCancelled,
  } = opts;

  let last: TransferStatusUpdate | undefined;
  let lastStatus: string | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (isCancelled?.()) break;

    let tx: TransferTransaction;
    try {
      tx = await fetchTransaction(transferServer, id, jwt, fetchImpl);
    } catch (e) {
      // Nothing to report on the very first attempt — surface the error. A later
      // transient failure is retried instead of killing the whole poll.
      if (attempt === 0) throw e;
      await wait(intervalMs);
      continue;
    }

    const info = describeTransferStatus(tx.status);
    last = { transaction: tx, info };
    if (tx.status !== lastStatus) {
      lastStatus = tx.status;
      onUpdate?.(last);
    }

    if (info.terminal) return last;
    await wait(intervalMs);
  }

  if (!last) {
    // Cancelled before any successful read, or maxAttempts was 0.
    throw new Error('Could not read the anchor transaction status.');
  }
  return last; // ran out of attempts (or cancelled) without a terminal status
}
