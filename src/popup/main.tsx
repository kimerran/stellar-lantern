import '@shared/polyfills'; // must be first — sets Buffer/process/global before Stellar loads
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../styles/tailwind.css';

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
