import { useState } from 'react';
import { useWallet } from './hooks/useWallet';
import { useSettings } from './hooks/useSettings';
import { NETWORKS } from '@shared/constants';
import { AppBar } from './components/AppBar';
import { BottomNav, type Tab } from './components/BottomNav';
import { Icon } from './components/Icon';
import { Onboarding } from './screens/Onboarding';
import { Unlock } from './screens/Unlock';
import { Assets } from './screens/Assets';
import { Activity } from './screens/Activity';
import { Send } from './screens/Send';
import { Scan } from './screens/Scan';

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
    void navigator.clipboard.writeText(address);
  };

  // Full-screen Security overlay (paste-to-check + warning previews).
  if (scanOpen) {
    return <Scan onBack={() => setScanOpen(false)} />;
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <AppBar
        address={address}
        network={settings.network}
        onToggleNetwork={toggleNetwork}
        onLock={lock}
        onCopyAddress={copyAddress}
        onOpenScan={() => setScanOpen(true)}
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
        </div>
      </main>

      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}
