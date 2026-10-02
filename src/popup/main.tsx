import '@shared/polyfills'; // must be first — sets Buffer/process/global before Stellar loads
import React from 'react';
import { createRoot } from 'react-dom/client';
import { isNativePlatform } from '@shared/kv';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { OpenInAnotherTab } from './screens/OpenInAnotherTab';
import { holdWalletTab } from '@shared/tab-lock';
import '../styles/tailwind.css';

// On Android (Capacitor) fill the whole device viewport + respect safe areas,
// instead of the fixed 360×600 extension popup box (see tailwind.css html.native).
if (isNativePlatform()) {
  document.documentElement.classList.add('native');
  // Draw the WebView edge-to-edge under the status bar so env(safe-area-inset-*)
  // resolves on Android < 15 too (it's enforced on 15+). Dynamically imported so
  // the extension popup bundle never pulls in the native plugin. Light icons over
  // the navy theme. Failures are non-fatal (e.g. status bar unavailable).
  void (async () => {
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setOverlaysWebView({ overlay: true });
      await StatusBar.setStyle({ style: Style.Dark });
    } catch {
      /* status bar plugin not present / unsupported — safe-area padding is still applied */
    }
  })();
}

// Expanded ("open in full tab") mode — same wallet rendered as a centered card.
if (new URLSearchParams(window.location.search).has('expanded')) {
  document.documentElement.classList.add('expanded');
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
const root = createRoot(rootEl);

const renderWallet = () =>
  root.render(
    <React.StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </React.StrictMode>,
  );

if (__WEB_BUILD__) {
  // The web app (#237): full viewport like Android, a cache-only service
  // worker for the offline shell, and one wallet per browser profile.
  document.documentElement.classList.add('web');
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* no offline shell; the app still works online */
    });
  }
  void holdWalletTab(navigator.locks, () => root.render(<OpenInAnotherTab />)).then(renderWallet);
} else {
  renderWallet();
}
