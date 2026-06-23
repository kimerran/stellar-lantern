import { useCallback, useEffect, useState } from 'react';
import { sendMessage, type WalletStatus } from '@shared/messages';

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

  return { status, refresh, lock, setStatus };
}
