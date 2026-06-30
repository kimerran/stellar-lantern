import '@shared/polyfills'; // must be first — sets Buffer/process/global before Stellar loads
import React from 'react';
import { createRoot } from 'react-dom/client';
import { isNativePlatform } from '@shared/kv';
import { App } from './App';
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

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
