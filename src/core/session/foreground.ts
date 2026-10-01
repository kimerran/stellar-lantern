// On Android the wallet locks the moment the app is paused (useWallet), so it
// never sits unlocked behind the app switcher. But some screens we open on
// purpose pause the app too: Google's QR scanner (#226) is a Play services
// activity drawn over ours. Locking then unmounts the screen that asked for the
// scan, and its result lands nowhere.
//
// `whileSystemScreen` marks that window. A pause inside it doesn't lock, unless
// the screen stays open past SYSTEM_SCREEN_GRACE_MS (someone left the phone on
// the scanner, or went home from it): then the wallet locks as soon as the
// screen returns. The idle auto-lock timer applies throughout.

export const SYSTEM_SCREEN_GRACE_MS = 2 * 60_000;

let depth = 0;
let skipped: { at: number; lock: () => void } | null = null;

export function onAppPause(lock: () => void, now: number = Date.now()): void {
  if (depth === 0) {
    lock();
    return;
  }
  skipped ??= { at: now, lock };
}

export async function whileSystemScreen<T>(
  fn: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  depth++;
  try {
    return await fn();
  } finally {
    depth--;
    if (depth === 0 && skipped) {
      const { at, lock } = skipped;
      skipped = null;
      if (now() - at > SYSTEM_SCREEN_GRACE_MS) lock();
    }
  }
}
