import { defineManifest } from '@crxjs/vite-plugin';
import { version } from './package.json';

// MV3 manifest. Minimal permissions per SPEC §8 / AGENT §5: only `storage`,
// and host access limited to the Stellar endpoints (Horizon, friendbot and the
// testnet Soroban RPC the scanner simulates and screens against) plus ONE
// origin of our own — the Lantern API on Railway, which the opt-in telemetry
// sink posts to (#81 / #88) and which serves the scanner's explainer proxy
// (#84). Nothing else.
export default defineManifest({
  manifest_version: 3,
  name: 'Lantern — Stellar Wallet',
  description: 'Securely light your path to the decentralized web. A non-custodial Stellar wallet.',
  // From package.json, the single version source (#141) — never hardcode it.
  version,
  action: {
    default_popup: 'index.html',
    default_title: 'Lantern',
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  permissions: ['storage'],
  host_permissions: [
    'https://horizon-testnet.stellar.org/*',
    'https://horizon.stellar.org/*',
    'https://friendbot.stellar.org/*',
    // Soroban testnet RPC (#84): the scanner's simulateTransaction and the
    // registry's getLedgerEntries hot read run from the popup on every review.
    // Was relying on the RPC's permissive CORS before; granted explicitly so a
    // CORS policy change upstream can't silently turn every scan `unknown`.
    'https://soroban-testnet.stellar.org/*',
    // The Lantern API (services/lantern-api): telemetry ingest (#88) and the
    // explainer proxy (#84, /v1/explain). Keep in sync with
    // VITE_TELEMETRY_INGEST_URL / VITE_LANTERN_API_URL in release.yml / android.yml.
    'https://lantern-api-production-3fad.up.railway.app/*',
  ],
  content_security_policy: {
    // frame-src 'self' allows the bundled mini-apps (Apps tab); `https:` is a
    // DEMO-ONLY concession so the in-app browser's URL bar can embed remote
    // dApps. The real build should drop `https:` and broker dApps through a
    // vetted directory instead of allowing arbitrary framing.
    extension_pages: "script-src 'self'; object-src 'self'; frame-src 'self' https:;",
  },
});
