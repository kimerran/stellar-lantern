// Lantern's own web origins (#259, epic #258).
//
// The Android app is a Capacitor WebView. Left at Capacitor's default it runs at
// `https://localhost`, an origin every Capacitor/Ionic app on the phone shares,
// so a dApp that trusts "Lantern's origin" would trust all of them. Instead it
// is served at `https://android.golantern.xyz`:
//   • golantern.xyz is our domain, so no one else can claim the name;
//   • it is NOT `app.golantern.xyz` (the hosted web app, #237): a WebView that
//     claimed a real hosted origin would make origin checks unable to tell the
//     two apart;
//   • nothing is ever fetched from it: Capacitor intercepts every request to
//     this host and serves the bundled assets. Don't host anything there.
//
// capacitor.config.ts imports ANDROID_HOSTNAME from here, so the config and the
// code that compares origins can't drift. A dApp allowlist (Centient's
// NEXT_PUBLIC_LANTERN_ORIGINS, slice 8 / #266) lists ANDROID_ORIGIN.

/** The Android WebView's hostname (`server.hostname` in capacitor.config.ts). */
export const ANDROID_HOSTNAME = 'android.golantern.xyz';

/** The Android app's `window.location.origin` (`androidScheme: 'https'`). */
export const ANDROID_ORIGIN = `https://${ANDROID_HOSTNAME}`;

/** The hosted web app's origin (#237). */
export const WEB_APP_ORIGIN = 'https://app.golantern.xyz';

/** Capacitor's default, used by Android builds up to 0.5.x. Never trust it. */
export const LEGACY_ANDROID_ORIGIN = 'https://localhost';

/** Lantern's fixed origins. The extension's `chrome-extension://<id>` varies per install. */
export const LANTERN_ORIGINS: readonly string[] = [ANDROID_ORIGIN, WEB_APP_ORIGIN];

/**
 * True when `urlOrOrigin` is Lantern itself: one of LANTERN_ORIGINS, any
 * `chrome-extension://` origin, or `self` (the running page's own origin,
 * defaulting to `location.origin`). A frame on one of these must never get
 * `allow-same-origin` (#260): with `allow-scripts` it could lift its sandbox.
 * Unparseable or opaque (`null`-origin) input counts as Lantern's, so a
 * caller fails closed.
 */
export function isLanternOrigin(
  urlOrOrigin: string,
  self: string | undefined = (globalThis as { location?: { origin?: string } }).location?.origin,
): boolean {
  let url: URL;
  try {
    url = new URL(urlOrOrigin);
  } catch {
    return true;
  }
  if (url.protocol === 'chrome-extension:') return true;
  const origin = url.origin;
  if (origin === 'null') return true;
  if (LANTERN_ORIGINS.includes(origin)) return true;
  return self !== undefined && self !== 'null' && origin === self;
}
