import { describe, it, expect, vi } from 'vitest';
import { pollTransferStatus, type TransferStatusUpdate } from '@core/anchor/poll';

const TRANSFER = 'https://anchor.example.com/sep24';
const ID = 'tx-1';
const JWT = 'jwt.abc';

// A fetch stub that returns a scripted sequence of SEP-24 `GET /transaction`
// bodies, one per call. A `null` entry rejects (simulates a transient failure).
function scriptedFetch(statuses: Array<string | null>) {
  let i = 0;
  const calls: string[] = [];
  const impl = ((url: string) => {
    calls.push(url);
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    if (status === null) return Promise.reject(new Error('network blip'));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ transaction: { id: ID, status } }),
    });
  }) as unknown as typeof fetch;
  return { impl, calls: () => calls, count: () => i };
}

// An injected wait that never actually sleeps — keeps the tests instant.
const noWait = () => Promise.resolve();

const base = (fetchImpl: typeof fetch, extra: Partial<Parameters<typeof pollTransferStatus>[0]> = {}) => ({
  transferServer: TRANSFER,
  id: ID,
  jwt: JWT,
  fetchImpl,
  wait: noWait,
  intervalMs: 1,
  ...extra,
});

describe('pollTransferStatus', () => {
  it('polls until a terminal status and returns the final update', async () => {
    const { impl, count } = scriptedFetch(['pending_anchor', 'pending_anchor', 'completed']);
    const result = await pollTransferStatus(base(impl));
    expect(result.transaction.status).toBe('completed');
    expect(result.info).toMatchObject({ kind: 'done', terminal: true });
    // Stops the moment it sees terminal — 3 reads, no poll after 'completed'.
    expect(count()).toBe(3);
  });

  it('fires onUpdate only on a status *change*, not on every identical tick', async () => {
    const { impl } = scriptedFetch(['pending_user_transfer_start', 'pending_user_transfer_start', 'completed']);
    const updates: TransferStatusUpdate[] = [];
    await pollTransferStatus(base(impl, { onUpdate: (u) => updates.push(u) }));
    expect(updates.map((u) => u.transaction.status)).toEqual(['pending_user_transfer_start', 'completed']);
  });

  it('treats an error terminal status (expired) as terminal', async () => {
    const { impl, count } = scriptedFetch(['expired']);
    const result = await pollTransferStatus(base(impl));
    expect(result.info).toMatchObject({ kind: 'error', terminal: true });
    expect(count()).toBe(1);
  });

  it('keeps polling on an unknown/future status (never falsely terminal)', async () => {
    const { impl } = scriptedFetch(['some_future_status', 'some_future_status', 'refunded']);
    const result = await pollTransferStatus(base(impl));
    // Unknown maps to the safe non-terminal fallback, so it polls through to the
    // real terminal 'refunded'.
    expect(result.transaction.status).toBe('refunded');
    expect(result.info.terminal).toBe(true);
  });

  it('throws if the very first fetch fails (nothing to report yet)', async () => {
    const { impl } = scriptedFetch([null]);
    await expect(pollTransferStatus(base(impl))).rejects.toThrow(/network blip/i);
  });

  it('retries a transient failure on a later poll instead of aborting', async () => {
    const { impl } = scriptedFetch(['pending_anchor', null, 'completed']);
    const result = await pollTransferStatus(base(impl));
    expect(result.transaction.status).toBe('completed');
  });

  it('stops early when isCancelled() flips, returning the last status seen', async () => {
    let polls = 0;
    const { impl } = scriptedFetch(['pending_anchor']); // never terminal on its own
    const result = await pollTransferStatus(
      base(impl, {
        isCancelled: () => polls >= 2,
        onUpdate: () => {
          polls += 1;
        },
      }),
    );
    expect(result.transaction.status).toBe('pending_anchor');
  });

  it('gives up after maxAttempts without a terminal status, returning the last', async () => {
    const { impl, count } = scriptedFetch(['pending_external']);
    const wait = vi.fn(noWait);
    const result = await pollTransferStatus(base(impl, { wait, maxAttempts: 4 }));
    expect(result.transaction.status).toBe('pending_external');
    expect(result.info.terminal).toBe(false);
    expect(count()).toBe(4); // exactly maxAttempts reads
  });
});
