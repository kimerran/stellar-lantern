// One wallet per browser profile (#237). The web build runs the wallet in the
// page, so a second tab would be a second wallet instance writing the same
// IndexedDB vault. The first tab holds a Web Lock for as long as it's open;
// a later tab reports that it's blocked, waits, and starts only once the lock
// is released (the other tab closed).
//
// Web Locks ship in every current browser (Safari 15.4+). Where they're
// missing the wallet starts anyway: refusing to run would be worse.

export const WALLET_TAB_LOCK = 'lantern.wallet';

/** Resolves when this tab may run the wallet. */
export function holdWalletTab(
  locks: LockManager | undefined,
  onBlocked: () => void,
): Promise<void> {
  if (!locks) return Promise.resolve();
  return new Promise((resolve) => {
    // The lock is held until the page goes away.
    const hold = () => {
      resolve();
      return new Promise<void>(() => {});
    };
    void locks.request(WALLET_TAB_LOCK, { ifAvailable: true }, (lock) => {
      if (lock) return hold();
      onBlocked();
      void locks.request(WALLET_TAB_LOCK, hold);
      return undefined;
    });
  });
}
