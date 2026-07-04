import { useState } from 'react';
import { useWallet } from './hooks/useWallet';
import { useSettings } from './hooks/useSettings';
import { NETWORKS } from '@shared/constants';
import { isNativePlatform } from '@shared/kv';
import { AppBar } from './components/AppBar';
import { BottomNav, type Tab } from './components/BottomNav';
import { Icon } from './components/Icon';
import { useToast } from './components/Toast';
import { Onboarding } from './screens/Onboarding';
import { Unlock } from './screens/Unlock';
import { Assets } from './screens/Assets';
import { Activity } from './screens/Activity';
import { Send } from './screens/Send';
import { Scan } from './screens/Scan';
import { Apps } from './screens/Apps';
import { Guardians } from './screens/Guardians';
import { CashInOut } from './screens/CashInOut';
import { Receive } from './screens/Receive';

function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <Icon name="lightbulb" filled size={48} className="animate-subtle-glow text-primary-container" />
    </div>
  );
}

export function App() {
  const { status, refresh, lock } = useWallet();
  const { settings, toggleNetwork } = useSettings();
  const [tab, setTab] = useState<Tab>('assets');
  const [scanOpen, setScanOpen] = useState(false);
  const [guardiansOpen, setGuardiansOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const showToast = useToast();

  if (!status || !settings) return <Splash />;

  const network = NETWORKS[settings.network];

  // Onboarding — no wallet yet.
  if (!status.initialized) {
    return <Onboarding onDone={refresh} />;
  }

  // Locked — vault exists but no unlocked session in the worker.
  if (status.locked || !status.address) {
    return <Unlock onUnlocked={refresh} onReset={refresh} />;
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

  // Full-screen Receive (address QR code) overlay.
  if (receiveOpen) {
    return <Receive address={address} onBack={() => setReceiveOpen(false)} />;
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <AppBar
        address={address}
        network={settings.network}
        onToggleNetwork={toggleNetwork}
        onLock={lock}
        onCopyAddress={copyAddress}
        onOpenReceive={() => setReceiveOpen(true)}
        onOpenScan={() => setScanOpen(true)}
        onOpenGuardians={() => setGuardiansOpen(true)}
        onOpenCashInOut={() => setCashOpen(true)}
        onExpand={isExpanded || isNativePlatform() ? undefined : openExpanded}
      />

      <main className="no-scrollbar relative flex-1 overflow-y-auto">
        {/* top/bottom fade overlays (BRAND §4.3) */}
        <div className="pointer-events-none sticky top-0 z-10 h-3 bg-gradient-to-b from-background to-transparent" />
        <div className="px-4 pb-4">
          {tab === 'assets' && (
            <Assets address={address} network={network} onSend={() => setTab('send')} />
          )}
          {tab === 'activity' && <Activity address={address} network={network} />}
          {tab === 'send' && (
            <Send address={address} network={network} onDone={() => setTab('activity')} />
          )}
          {tab === 'apps' && <Apps address={address} network={settings.network} />}
        </div>
      </main>

      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}
