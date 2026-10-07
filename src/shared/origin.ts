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

/**
 * The Chrome extension's public key (#284): `key` in manifest.config.ts. Chrome
 * derives an extension's id from it, so every install, unpacked from any folder,
 * gets the same id and origin. Without it an unpacked extension's id comes from
 * its folder path, so it differs per install and a dApp can't allowlist it. The
 * matching private key is only needed to pack a .crx or match a Chrome Web
 * Store listing; it is never committed. The id is EXTENSION_ID (a test checks).
 */
export const EXTENSION_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmJ2DRXSMkONOtzTNergtBmfIRbyxdMdAXt2QF6BCrwMCFJ7/sMIyIevup4yHYgdfCs1PCJ/ZPbzV53aSUK4GVNTlgeHKqdE8pntWToCFKNgNp87X057ibmdlS+5pLFpnjCKs9XNVZsMRq1/rBJ6r/b2qrmGW/bbogtnKUVUxSYP2m4lZar4MLzX/FIDv36kUJOne86vYEgc550m7KDC6yiwsP/7FKZPw/4vWuNGGwAZn1uqJM2IXuDzT6syiIxTiuUrte7oAlSg9vtKPNKOglB+Wk9qV1q+C6rpkHqW1dzpTaggGz/6IUgYcEs4D+B92SFUuD/ZEZwambMtk5j/3KQIDAQAB';

/** The extension's id, derived from EXTENSION_PUBLIC_KEY. */
export const EXTENSION_ID = 'iflpkjgolcbleombhldiibhojohjpnmd';

/** The extension's `window.location.origin`: what a framed dApp sees as `event.origin`. */
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

/**
 * Lantern's fixed web origins. The extension's is EXTENSION_ORIGIN (not a URL
 * origin, so it isn't in this list; isLanternOrigin treats every
 * `chrome-extension://` origin as Lantern's anyway).
 */
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
