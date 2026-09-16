import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '@shared/types';
import type { NetworkId } from '@shared/constants';
import { getSettings, setSettings, onSettingsChanged } from '@shared/storage';
import {
  grantConsent,
  revokeConsentAndDelete,
  markConsentPromptSeen,
  deleteAnalyticsData,
} from '@core/telemetry';

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

  const setHorizonOverrides = useCallback(
    async (horizonOverrides: Settings['horizonOverrides']) => {
      setLocal(await setSettings({ horizonOverrides }));
    },
    [],
  );

  const setRpcOverrides = useCallback(async (rpcOverrides: Settings['rpcOverrides']) => {
    setLocal(await setSettings({ rpcOverrides }));
  }, []);

  // Analytics consent (#86). Only meaningful under __FEATURE_TELEMETRY__; the
  // telemetry module is tiny and its import is what the flag guards at the
  // call sites in App / Settings.
  const setAnalyticsConsent = useCallback(async (on: boolean) => {
    if (!__FEATURE_TELEMETRY__) return;
    if (on) await grantConsent();
    else await revokeConsentAndDelete();
    setLocal(await getSettings());
  }, []);

  // Explicit "delete my data": independent of the current consent state.
  const deleteAnalytics = useCallback(async () => {
    if (!__FEATURE_TELEMETRY__) return;
    await deleteAnalyticsData();
    setLocal(await getSettings());
  }, []);

  const dismissAnalyticsPrompt = useCallback(async () => {
    if (!__FEATURE_TELEMETRY__) return;
    await markConsentPromptSeen();
    setLocal(await getSettings());
  }, []);

  return {
    settings,
    setNetwork,
    toggleNetwork,
    setAutoLock,
    setHorizonOverrides,
    setRpcOverrides,
    setAnalyticsConsent,
    deleteAnalytics,
    dismissAnalyticsPrompt,
  };
}
