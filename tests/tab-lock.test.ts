import { describe, expect, it, vi } from 'vitest';
import { holdWalletTab, WALLET_TAB_LOCK } from '@shared/tab-lock';

// The web build runs the wallet in the page (#237), so two open tabs would be
// two wallet instances writing one IndexedDB. The first tab holds a Web Lock
// for its lifetime; a later tab shows "open in another tab" and only starts
// once the first tab closes.

type Grant = (lock: { name: string } | null) => unknown;

// A minimal LockManager: one exclusive lock name, `ifAvailable`, and a queue.
function fakeLocks() {
  let held = false;
  const queue: Array<() => void> = [];
  const run = async (name: string, cb: Grant) => {
    held = true;
    try {
      return await cb({ name });
    } finally {
      held = false;
      queue.shift()?.();
    }
  };
  const locks = {
    request(name: string, a: unknown, b?: unknown) {
      const opts = (typeof a === 'function' ? {} : a) as { ifAvailable?: boolean };
      const cb = (typeof a === 'function' ? a : b) as Grant;
      if (!held) return run(name, cb);
      if (opts.ifAvailable) return Promise.resolve(cb(null));
      return new Promise((resolve) => queue.push(() => resolve(run(name, cb))));
    },
  };
  return locks as unknown as LockManager;
}

describe('holdWalletTab', () => {
  it('starts straight away in the first tab, and never reports another tab', async () => {
    const onBlocked = vi.fn();
    await holdWalletTab(fakeLocks(), onBlocked);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('blocks a second tab while the first one is open', async () => {
    const locks = fakeLocks();
    await holdWalletTab(locks, vi.fn());

    const onBlocked = vi.fn();
    let started = false;
    void holdWalletTab(locks, onBlocked).then(() => (started = true));
    await new Promise((r) => setTimeout(r, 0));

    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(started).toBe(false);
  });

  it('starts the waiting tab once the first one lets go', async () => {
    const locks = fakeLocks();
    // A first tab that closes when we say so.
    let close!: () => void;
    void locks.request(WALLET_TAB_LOCK, () => new Promise<void>((r) => (close = r)));

    const onBlocked = vi.fn();
    const started = holdWalletTab(locks, onBlocked);
    await new Promise((r) => setTimeout(r, 0));
    expect(onBlocked).toHaveBeenCalledTimes(1);

    close();
    await expect(started).resolves.toBeUndefined();
  });

  it('starts anyway where the browser has no Web Locks', async () => {
    const onBlocked = vi.fn();
    await holdWalletTab(undefined, onBlocked);
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
