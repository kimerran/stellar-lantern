import { useState } from 'react';
import { useWallet } from './hooks/useWallet';
import { useSettings } from './hooks/useSettings';
import { resolveNetworkConfig } from '@shared/network';
import { isNativePlatform } from '@shared/kv';
import { AppBar } from './components/AppBar';
import { BottomNav, type Tab } from './components/BottomNav';
import { Icon } from './components/Icon';
import { useToast } from './components/Toast';
import { Onboarding } from './screens/Onboarding';
import { SmartAccount } from './screens/SmartAccount';
import { usePasskeyAccount } from './hooks/usePasskeyAccount';
import { Unlock } from './screens/Unlock';
import { Assets } from './screens/Assets';
import { Activity } from './screens/Activity';
import { Send } from './screens/Send';
import { Swap } from './screens/Swap';
import { Scan } from './screens/Scan';
import { Apps } from './screens/Apps';
import { Guardians } from './screens/Guardians';
import { CashInOut } from './screens/CashInOut';
import { Earn } from './screens/Earn';
import { Receive } from './screens/Receive';
import { Settings } from './screens/Settings';

function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <Icon name="lightbulb" filled size={48} className="animate-subtle-glow text-primary-container" />
    </div>
  );
}

export function App() {
  const { status, refresh, lock } = useWallet();
  const { settings, setNetwork, setAutoLock, setHorizonOverrides, setRpcOverrides } = useSettings();
  const { passkeyAccount, refresh: refreshPasskey } = usePasskeyAccount();
  const [tab, setTab] = useState<Tab>('assets');
  const [scanOpen, setScanOpen] = useState(false);
  const [guardiansOpen, setGuardiansOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const showToast = useToast();

  if (!status || !settings) return <Splash />;

  // Passkey smart account (#53) — a parallel, seed-phrase-free account mode.
  // It takes over the whole surface (no vault, no unlock — the passkey is the
  // signer). Flag-gated so store builds carry none of this.
  if (__FEATURE_PASSKEY__) {
    if (passkeyAccount === undefined) return <Splash />;
    if (passkeyAccount) {
      return <SmartAccount account={passkeyAccount} onForget={refreshPasskey} />;
    }
  }

  const network = resolveNetworkConfig(settings);

  // Onboarding — no wallet yet.
  if (!status.initialized) {
    return <Onboarding onDone={refresh} onPasskeyDone={refreshPasskey} />;
  }

  // Locked — vault exists but no unlocked session in the worker.
  if (status.locked || !status.address) {
    return (
      <Unlock
        onUnlocked={refresh}
        onReset={refresh}
        biometricEnabled={status.biometricEnabled}
        biometricAvailable={status.biometricAvailable}
      />
    );
  }

  const address = status.address;

  const copyAddress = () => {
    navigator.clipboard.writeText(address).then(
      () => showToast('Address copied'),
      () => showToast('Couldn’t copy address', 'error'),
    );
  };

  // Already in a full tab? Then don't offer "expand" again.
  const isExpanded = new URLSearchParams(window.location.search).has('expanded');
  const openExpanded = () => {
    const url = chrome.runtime.getURL('index.html?expanded=1');
    if (chrome.tabs?.create) {
      void chrome.tabs.create({ url });
      window.close(); // close the popup once the tab opens
    } else {
      window.open(url, '_blank', 'noopener');
    }
  };

  // Full-screen Security overlay (paste-to-check + warning previews).
  if (scanOpen) {
    return <Scan onBack={() => setScanOpen(false)} />;
  }

  // Full-screen Guardians & Recovery overlay.
  if (guardiansOpen) {
    return <Guardians address={address} network={network} onBack={() => setGuardiansOpen(false)} />;
  }

  // Full-screen Cash in / Cash out (anchor deposit/withdraw) overlay.
  if (cashOpen) {
    return <CashInOut address={address} network={network} onBack={() => setCashOpen(false)} />;
  }

  // Full-screen Swap (SDEX path-payment) overlay.
  if (swapOpen) {
    return <Swap address={address} network={network} onBack={() => setSwapOpen(false)} />;
  }

  // Full-screen Receive (address QR code) overlay.
  if (receiveOpen) {
    return <Receive address={address} onBack={() => setReceiveOpen(false)} />;
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <AppBar
        address={address}
        network={settings.network}
        onCopyAddress={copyAddress}
        onExpand={isExpanded || isNativePlatform() ? undefined : openExpanded}
      />

      <main className="no-scrollbar relative flex-1 overflow-y-auto">
        {/* top/bottom fade overlays (BRAND §4.3) */}
        <div className="pointer-events-none sticky top-0 z-10 h-3 bg-gradient-to-b from-background to-transparent" />
        <div className="px-4 pb-4">
          {tab === 'assets' && (
            <Assets
              address={address}
              network={network}
              onSend={() => setTab('send')}
              onReceive={() => setReceiveOpen(true)}
              onSwap={() => setSwapOpen(true)}
              onEarn={() => setTab('earn')}
            />
          )}
          {tab === 'earn' && <Earn address={address} network={network} embedded />}
          {tab === 'send' && (
            <Send
              address={address}
              network={network}
              onDone={() => setTab('activity')}
            />
          )}
          {tab === 'apps' && <Apps address={address} network={settings.network} />}
          {tab === 'activity' && <Activity address={address} network={network} embedded />}
          {tab === 'settings' && (
            <Settings
              address={address}
              settings={settings}
              embedded
              onCopyAddress={copyAddress}
              onOpenReceive={() => setReceiveOpen(true)}
              onOpenGuardians={() => setGuardiansOpen(true)}
              onOpenScan={() => setScanOpen(true)}
              onOpenCashInOut={() => setCashOpen(true)}
              onLock={lock}
              setNetwork={setNetwork}
              setAutoLock={setAutoLock}
              setHorizonOverrides={setHorizonOverrides}
              setRpcOverrides={setRpcOverrides}
            />
          )}
        </div>
      </main>

      {/* Send/Earn are Home sub-views, so keep Home highlighted while they're open. */}
      <BottomNav active={tab === 'send' || tab === 'earn' ? 'assets' : tab} onChange={setTab} />
    </div>
  );
}
