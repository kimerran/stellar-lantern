// Android only (#263): feed `lantern://open` links into the in-memory inbox,
// both the one that launched the app (cold start) and any that arrive while it
// runs (`appUrlOpen`). main.tsx calls this behind `__NATIVE_BUILD__`, and
// @capacitor/app is imported dynamically, so the extension and web bundles
// carry neither.

import { receiveDeepLink } from './inbox';

export async function listenForDeepLinks(): Promise<void> {
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('appUrlOpen', (e) => receiveDeepLink(e.url));
    const launch = await App.getLaunchUrl();
    receiveDeepLink(launch?.url);
  } catch {
    /* @capacitor/app unavailable — links just won't open anything */
  }
}
