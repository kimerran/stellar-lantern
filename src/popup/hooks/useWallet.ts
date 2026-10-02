import { useCallback, useEffect, useState } from 'react';
import { sendMessage, type WalletStatus } from '@shared/messages';
import { isNativePlatform } from '@shared/kv';
import { onAppPause } from '@core/session/foreground';

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
  // The web app (#238) does the same when its page is hidden: another app or
  // tab in front, the phone locked, or the Home Screen app backgrounded. The
  // wallet holds its unlocked session in this page, like Android.
  useEffect(() => {
    if (!__WEB_BUILD__) return;
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void lock();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHidden);
    };
  }, [lock]);

  useEffect(() => {
    if (!isNativePlatform()) return;
    let cancelled = false;
    let removeListener: (() => void) | undefined;
    void (async () => {
      try {
        const { App } = await import('@capacitor/app');
        // Except while a screen we opened is up, e.g. the QR scanner (#226).
        const handle = await App.addListener('pause', () => {
          onAppPause(() => void lock());
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
