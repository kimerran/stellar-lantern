import { useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles/tailwind.css';

import { AppBar } from '@popup/components/AppBar';
import { BottomNav, type Tab } from '@popup/components/BottomNav';
import { ToastProvider } from '@popup/components/Toast';
import { Assets } from '@popup/screens/Assets';
import { Activity } from '@popup/screens/Activity';
import { Earn } from '@popup/screens/Earn';
import { Settings } from '@popup/screens/Settings';
import { ADDRESS, NETWORK, SETTINGS } from './fixtures';

const noop = () => {};

// The real popup shell (App.tsx): AppBar + a padded, faded scroll area + BottomNav.
function Shell({ navActive, children }: { navActive: Tab; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-background">
      <AppBar address={ADDRESS} network={NETWORK.id} onCopyAddress={noop} />
      <main className="no-scrollbar relative flex-1 overflow-y-auto">
        <div className="pointer-events-none sticky top-0 z-10 h-3 bg-gradient-to-b from-background to-transparent" />
        <div className="px-4 pb-4">{children}</div>
      </main>
      <BottomNav active={navActive} onChange={noop} />
    </div>
  );
}

// A 360×600 popup rendered in a rounded device frame with a caption, for the grid.
function Phone({ caption, sub, navActive, children }: {
  caption: string; sub: string; navActive: Tab; children: ReactNode;
}) {
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div
        style={{
          width: 360, height: 600, overflow: 'hidden', borderRadius: 28,
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)', outline: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <Shell navActive={navActive}>{children}</Shell>
      </div>
      <figcaption style={{ textAlign: 'center', color: '#e8eaed', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ fontWeight: 600, fontSize: 18 }}>{caption}</div>
        <div style={{ fontSize: 13, color: '#9aa0a6', marginTop: 2 }}>{sub}</div>
      </figcaption>
    </figure>
  );
}

const assetsProps = { address: ADDRESS, network: NETWORK, onSend: noop, onReceive: noop, onSwap: noop, onEarn: noop };
const settingsProps = {
  address: ADDRESS, settings: SETTINGS,
  onCopyAddress: noop, onOpenReceive: noop, onOpenGuardians: noop, onOpenScan: noop,
  onOpenCashInOut: noop, onLock: noop, setNetwork: noop, setAutoLock: noop,
  setHorizonOverrides: noop, setRpcOverrides: noop,
};

function Overview() {
  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, max-content)', gap: '40px 48px',
        padding: 48, background: '#070b14', width: 'max-content',
      }}
    >
      <Phone caption="Home" sub="Send · Receive · Swap · Earn" navActive="assets">
        <Assets {...assetsProps} />
      </Phone>
      <Phone caption="Settings hub" sub="Account · Security · Cash · Network · About" navActive="settings">
        <Settings {...settingsProps} embedded />
      </Phone>
      <Phone caption="Activity" sub="Grouped transaction history" navActive="activity">
        <Activity address={ADDRESS} network={NETWORK} embedded />
      </Phone>
      <Phone caption="Earn" sub="Lantern's own pool, branded first" navActive="assets">
        <Earn address={ADDRESS} network={NETWORK} embedded />
      </Phone>
    </div>
  );
}

// Full Settings surface at natural height, Advanced disclosure opened on mount.
function SettingsAdvanced() {
  useEffect(() => {
    const t = setTimeout(() => {
      const toggle = document.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
      toggle?.click();
    }, 150);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{ background: '#070b14', padding: 48, width: 'max-content' }}>
      <div style={{ width: 360, borderRadius: 28, overflow: 'hidden', outline: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex flex-col bg-background">
          <AppBar address={ADDRESS} network={NETWORK.id} onCopyAddress={noop} />
          <div className="px-4 pb-6 pt-1">
            <Settings {...settingsProps} embedded />
          </div>
        </div>
      </div>
    </div>
  );
}

const view = new URLSearchParams(window.location.search).get('view') ?? 'overview';
const root = createRoot(document.getElementById('root')!);
root.render(
  <ToastProvider>{view === 'settings-advanced' ? <SettingsAdvanced /> : <Overview />}</ToastProvider>,
);
