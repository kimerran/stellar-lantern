import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '@shared/types';
import type { NetworkId } from '@shared/constants';
import { getSettings, setSettings, onSettingsChanged } from '@shared/storage';

export function useSettings() {
  const [settings, setLocal] = useState<Settings | null>(null);

  useEffect(() => {
    getSettings().then(setLocal);
    return onSettingsChanged(setLocal);
  }, []);

  const setNetwork = useCallback(async (network: NetworkId) => {
    setLocal(await setSettings({ network }));
  }, []);

  const toggleNetwork = useCallback(async () => {
    const current = await getSettings();
    setLocal(await setSettings({ network: current.network === 'TESTNET' ? 'PUBLIC' : 'TESTNET' }));
  }, []);

  const setAutoLock = useCallback(async (autoLockMinutes: number) => {
    setLocal(await setSettings({ autoLockMinutes }));
  }, []);

  const setHorizonOverrides = useCallback(async (horizonOverrides: Settings['horizonOverrides']) => {
    setLocal(await setSettings({ horizonOverrides }));
  }, []);

  const setRpcOverrides = useCallback(async (rpcOverrides: Settings['rpcOverrides']) => {
    setLocal(await setSettings({ rpcOverrides }));
  }, []);

  return { settings, setNetwork, toggleNetwork, setAutoLock, setHorizonOverrides, setRpcOverrides };
}
