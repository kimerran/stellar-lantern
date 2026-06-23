import { defineManifest } from '@crxjs/vite-plugin';

// MV3 manifest. Minimal permissions per SPEC §8 / AGENT §5:
// only `storage`, and host access limited to the Horizon + friendbot endpoints.
export default defineManifest({
  manifest_version: 3,
  name: 'Lantern — Stellar Wallet',
  description: 'Securely light your path to the decentralized web. A non-custodial Stellar wallet.',
  version: '0.1.0',
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
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self';",
  },
});
