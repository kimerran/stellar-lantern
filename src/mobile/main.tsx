import '@shared/polyfills'; // must be first — sets Buffer/process/global before Stellar loads
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App as CapacitorApp } from '@capacitor/app';
import { setKvStore } from '@shared/storage';
import { setMessageTransport } from '@shared/messages';
import { dispatch, lockSession } from '@core/session/handler';
import { capacitorKvStore } from './storage.capacitor';
import { App } from '@popup/App';
import '../styles/tailwind.css';

// Android (Capacitor) entry. Wires the SAME React UI and core logic to the
// mobile host: storage → Capacitor Preferences; messaging → in-process dispatch
// (no service worker on mobile). Everything below the seam is shared, untouched.

// 1. Storage backend.
setKvStore(capacitorKvStore());

// 2. Messaging: route the popup's sendMessage() straight to the shared handler.
setMessageTransport((req) => dispatch(req));

// 3. Lock the in-memory session whenever the app leaves the foreground, so a
//    backgrounded wallet always requires re-unlock (parity with the extension's
//    onStartup lock; auto-lock timing still applies while active).
void CapacitorApp.addListener('pause', () => lockSession());

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
