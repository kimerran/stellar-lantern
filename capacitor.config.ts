import type { CapacitorConfig } from '@capacitor/cli';
import { ANDROID_HOSTNAME } from './src/shared/origin';

const config: CapacitorConfig = {
  appId: 'com.lantern.wallet',
  appName: 'Lantern',
  webDir: 'dist-mobile',
  // Lantern's own origin, https://android.golantern.xyz, instead of Capacitor's
  // shared default https://localhost (#259). See src/shared/origin.ts.
  server: {
    hostname: ANDROID_HOSTNAME,
    androidScheme: 'https',
  },
};

export default config;
