import { useCallback, useEffect, useState } from 'react';
import { sendMessage, type WalletStatus } from '@shared/messages';
import { isNativePlatform } from '@shared/kv';

// Tracks the wallet's lifecycle (initialized / locked / address) by talking to
// the background worker. The popup NEVER holds the decrypted secret.
export function useWallet() {
  const [status, setStatus] = useState<WalletStatus | null>(null);

  const refresh = useCallback(async () => {
    const res = await sendMessage({ type: 'GET_STATUS' });
    if (res.ok) setStatus(res.data);
    return res;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const lock = useCallback(async () => {
    await sendMessage({ type: 'LOCK' });
    await refresh();
  }, [refresh]);

  // Keep the worker's auto-lock timer fresh while the popup is open & active.
  useEffect(() => {
    const ping = () => {
      void sendMessage({ type: 'PING' });
    };
    window.addEventListener('pointerdown', ping);
    window.addEventListener('keydown', ping);
    return () => {
      window.removeEventListener('pointerdown', ping);
      window.removeEventListener('keydown', ping);
    };
  }, []);

  // On native (Capacitor), lock the moment the app is backgrounded instead of
  // waiting for the idle timer — the OS can keep the process (and the in-memory
  // session) alive indefinitely while backgrounded, so the idle window alone
  // leaves the wallet unlocked behind the app switcher / lock screen.
  useEffect(() => {
    if (!isNativePlatform()) return;
    let cancelled = false;
    let removeListener: (() => void) | undefined;
    void (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('pause', () => {
          void lock();
        });
        if (cancelled) void handle.remove();
        else removeListener = () => void handle.remove();
      } catch {
        /* @capacitor/app unavailable — the idle auto-lock timer still applies */
      }
    })();
    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [lock]);

  return { status, refresh, lock, setStatus };
}
