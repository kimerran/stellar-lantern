import { lazy, Suspense, useState } from 'react';
import { useWallet } from './hooks/useWallet';
import { useSettings } from './hooks/useSettings';
import { resolveNetworkConfig } from '@shared/network';
import { isNativePlatform } from '@shared/kv';
import { AppBar } from './components/AppBar';
import { BottomNav, type Tab } from './components/BottomNav';
import { Icon } from './components/Icon';
import { useToast } from './components/Toast';
import { usePasskeyAccount } from './hooks/usePasskeyAccount';
// First-paint path stays eager: splash → unlock/onboarding → home (assets),
// plus Settings which shares the home shell. (#127)
import { Onboarding } from './screens/Onboarding';
import { Unlock } from './screens/Unlock';
import { Assets } from './screens/Assets';
import { Settings } from './screens/Settings';

// Heavier secondary screens are code-split so first paint doesn't pay for
// features the user may never open. Named exports → mapped to `default`. (#127)
const SmartAccount = lazy(() => import('./screens/SmartAccount').then((m) => ({ default: m.SmartAccount })));
const Activity = lazy(() => import('./screens/Activity').then((m) => ({ default: m.Activity })));
const Send = lazy(() => import('./screens/Send').then((m) => ({ default: m.Send })));
const Swap = lazy(() => import('./screens/Swap').then((m) => ({ default: m.Swap })));
const Scan = lazy(() => import('./screens/Scan').then((m) => ({ default: m.Scan })));
const Apps = lazy(() => import('./screens/Apps').then((m) => ({ default: m.Apps })));
const Guardians = lazy(() => import('./screens/Guardians').then((m) => ({ default: m.Guardians })));
const CashInOut = lazy(() => import('./screens/CashInOut').then((m) => ({ default: m.CashInOut })));
const Earn = lazy(() => import('./screens/Earn').then((m) => ({ default: m.Earn })));
const Receive = lazy(() => import('./screens/Receive').then((m) => ({ default: m.Receive })));

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
      return (
        <Suspense fallback={<Splash />}>
          <SmartAccount account={passkeyAccount} onForget={refreshPasskey} />
        </Suspense>
      );
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
    return (
      <Suspense fallback={<Splash />}>
        <Scan onBack={() => setScanOpen(false)} />
      </Suspense>
    );
  }

  // Full-screen Guardians & Recovery overlay.
  if (guardiansOpen) {
    return (
      <Suspense fallback={<Splash />}>
        <Guardians address={address} network={network} onBack={() => setGuardiansOpen(false)} />
      </Suspense>
    );
  }

  // Full-screen Cash in / Cash out (anchor deposit/withdraw) overlay.
  if (cashOpen) {
    return (
      <Suspense fallback={<Splash />}>
        <CashInOut address={address} network={network} onBack={() => setCashOpen(false)} />
      </Suspense>
    );
  }

  // Full-screen Swap (SDEX path-payment) overlay.
  if (swapOpen) {
    return (
      <Suspense fallback={<Splash />}>
        <Swap address={address} network={network} onBack={() => setSwapOpen(false)} />
      </Suspense>
    );
  }

  // Full-screen Receive (address QR code) overlay.
  if (receiveOpen) {
    return (
      <Suspense fallback={<Splash />}>
        <Receive address={address} onBack={() => setReceiveOpen(false)} />
      </Suspense>
    );
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
        <Suspense fallback={<Splash />}>
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
        </Suspense>
      </main>

      {/* Send/Earn are Home sub-views, so keep Home highlighted while they're open. */}
      <BottomNav active={tab === 'send' || tab === 'earn' ? 'assets' : tab} onChange={setTab} />
    </div>
  );
}
