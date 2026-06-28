import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor config for the Android app (issue #4). The web assets come from the
// mobile build (`npm run build:mobile` → dist-mobile).
const config: CapacitorConfig = {
  appId: 'xyz.artisam.lantern',
  appName: 'Lantern',
  webDir: 'dist-mobile',
  android: {
    // Keep the WebView opaque on the wallet's dark navy background.
    backgroundColor: '#0b1326',
  },
};

export default config;
