// The sandbox and postMessage rules for a remote page framed in the Apps tab
// (#260, epic #258). Pure functions so the security decisions are unit-tested
// (tests/miniapp-frame.test.ts) rather than buried in Apps.tsx.
//
// Two kinds of remote frame:
//   • Opaque (the default): anything typed in the URL bar, and directory apps
//     without `session`. `allow-same-origin` is withheld, so the page runs with
//     an opaque origin: no cookies, no storage, no same-origin API calls.
//   • Session: a directory app marked `session: true` (MiniApp in directory.ts)
//     also gets `allow-same-origin`, so it runs at its real origin and can keep
//     a (partitioned) login cookie and call its own API. It gets nothing more
//     from Lantern: the wallet is still reached only through the postMessage
//     bridge.
//
// `allow-same-origin` is NEVER granted to a page on Lantern's own origin
// (isLanternOrigin: the Android origin, the web app, any chrome-extension://,
// the running page). With `allow-scripts` too, a page on our origin could reach
// into its parent and remove its own sandbox. The check is on the frame's src;
// a session app that later navigates its frame to Lantern's origin only loads
// Lantern's own bundle there (Capacitor serves it, and the web app refuses to
// start in a frame), never the app's script.
import { isLanternOrigin } from '@shared/origin';

/** The sandbox every remote frame gets. Never includes `allow-same-origin`. */
export const OPAQUE_SANDBOX = 'allow-scripts allow-forms allow-popups';

/** The sandbox a session directory app gets: the opaque set + `allow-same-origin`. */
export const SESSION_SANDBOX = `${OPAQUE_SANDBOX} allow-same-origin`;

/**
 * The `sandbox` attribute for a remote frame. `session` is the directory app's
 * trust flag (always false for the URL bar). `allow-same-origin` is added only
 * when `session` is true, `src` is an https URL, and it isn't Lantern's own
 * origin (`self` = the running page's origin, defaulting to location.origin).
 */
export function remoteFrameSandbox(src: string, session: boolean, self?: string): string {
  return grantsSameOrigin(src, session, self) ? SESSION_SANDBOX : OPAQUE_SANDBOX;
}

function grantsSameOrigin(src: string, session: boolean, self?: string): boolean {
  if (session !== true) return false;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  // Pass `self` only when given, so isLanternOrigin keeps its location.origin default.
  return !(self === undefined ? isLanternOrigin(src) : isLanternOrigin(src, self));
}

/**
 * The postMessage target for replies to a framed app, given its sandbox.
 * A session frame runs at its real origin, so replies go to that origin only:
 * if the frame has navigated elsewhere, the browser drops them.
 * An opaque frame's origin is the string 'null', which isn't a valid
 * targetOrigin, so the only way to reach it is '*'. That's safe because the
 * message is posted to that frame's own contentWindow, and the frame can't
 * leave the opaque sandbox: whatever it navigates to is still opaque, and still
 * only reached through the same scan-gated bridge.
 */
export function replyTargetOrigin(src: string, sandbox: string): string {
  if (!sandbox.split(/\s+/).includes('allow-same-origin')) return '*';
  try {
    return new URL(src).origin;
  } catch {
    return '*'; // unreachable: SESSION_SANDBOX is only granted to a parseable https URL
  }
}

/**
 * Whether an incoming message came from the framed app: the sender must be the
 * frame's window (event.source), and its origin must be the one we reply to
 * (the app's origin for a session frame, 'null' for an opaque one).
 */
export function isFromFramedApp(
  event: { source: unknown; origin: string },
  frameWindow: unknown,
  targetOrigin: string,
): boolean {
  if (!frameWindow || event.source !== frameWindow) return false;
  return event.origin === (targetOrigin === '*' ? 'null' : targetOrigin);
}
