// Web connect (#246): the protocol between a web page and the Lantern extension.
//
// Three hops, each validated on arrival (spec:
// docs/superpowers/specs/2026-10-16-web-connect-threat-model.md):
//
//   page (window.lantern, MAIN world)
//     → window.postMessage({ source: PAGE_SOURCE, id, method, params })
//   relay (content script, ISOLATED world)
//     → chrome.runtime port PORT_NAME: { id, method, params }
//   background (service worker)
//     ← { id, ok: true, result } | { id, ok: false, error: { code, message } }
//
// The background never trusts anything the page says about itself: the origin
// comes from the port's `sender`, not from the message. Nothing on this port
// reaches the wallet's privileged message handler directly.
//
// Pure, no chrome APIs: unit-tested in tests/webconnect-protocol.test.ts and
// shared by the page script, the relay and the background.

/** Bumped when a method or a response shape changes incompatibly. */
export const WEB_CONNECT_API_VERSION = 1;

export const PAGE_SOURCE = 'lantern-webconnect-page';
export const RELAY_SOURCE = 'lantern-webconnect-relay';
export const PORT_NAME = 'lantern-webconnect';

/** Every method the page API exposes. Ones not built yet answer `unsupported`. */
export const WEB_CONNECT_METHODS = [
  'isConnected',
  'requestAccess',
  'getAddress',
  'getNetwork',
  'getNetworkDetails',
  'signTransaction',
  'signAuthEntry',
  'signMessage',
] as const;
export type WebConnectMethod = (typeof WEB_CONNECT_METHODS)[number];

/**
 * Stable error codes. dApps (and the Stellar Wallets Kit module, #255) branch
 * on `code`; `message` is for people and may change.
 */
export type WebConnectErrorCode =
  | 'user_rejected' // the user said no, or closed the approval window
  | 'locked' // reserved: a request never fails locked while a person can unlock (#249)
  | 'not_allowed' // the site isn't connected, or the origin isn't allowed at all
  | 'network_mismatch' // the request's network isn't Lantern's active network
  | 'account_mismatch' // the request names an account the site wasn't granted
  | 'invalid_request' // malformed method, params or envelope
  | 'unsupported' // a method this build doesn't implement yet
  | 'busy' // too many pending requests from this origin
  | 'timeout' // no answer in time
  | 'connection_lost' // the extension went away (reloaded, updated, disabled)
  | 'internal'; // a bug on Lantern's side

export interface WebConnectError {
  code: WebConnectErrorCode;
  message: string;
}

/** The fixed "rejected" text, so a dApp can match on it if it can't read `code`. */
export const USER_REJECTED_MESSAGE = 'User rejected the request';

export const ERROR_MESSAGES: Record<WebConnectErrorCode, string> = {
  user_rejected: USER_REJECTED_MESSAGE,
  locked: 'Lantern is locked',
  not_allowed: 'This site is not connected to Lantern',
  network_mismatch: "The request's network is not Lantern's active network",
  account_mismatch: 'The request names an account this site is not connected to',
  invalid_request: 'Invalid request',
  unsupported: 'This version of Lantern does not support that request yet',
  busy: 'Too many pending requests from this site',
  timeout: 'Lantern did not answer in time',
  connection_lost: 'Lost the connection to Lantern',
  internal: 'Something went wrong in Lantern',
};

export function webConnectError(code: WebConnectErrorCode, message?: string): WebConnectError {
  return { code, message: message ?? ERROR_MESSAGES[code] };
}

export interface WebConnectRequest {
  id: string;
  method: WebConnectMethod;
  params: Record<string, unknown>;
}

export type WebConnectResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: WebConnectError };

/**
 * A request's serialized size cap. The largest envelope Lantern signs is
 * MAX_SIGN_XDR_LENGTH (200 000 chars, src/core/dapp/sign-xdr.ts); this leaves
 * room for the other params without letting a page push megabytes through.
 */
export const MAX_REQUEST_BYTES = 256 * 1024;

/** Request ids: what crypto.randomUUID() gives, or any short token. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const isRequestId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isMethod = (v: unknown): v is WebConnectMethod =>
  typeof v === 'string' && (WEB_CONNECT_METHODS as readonly string[]).includes(v);

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; id: string | null; error: WebConnectError };

function serializedLength(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return Infinity; // cycles, BigInt: not something a page may send
  }
}

/**
 * Validate a request as the relay or the background receives it: `{ id,
 * method, params }`. `params` may be omitted (treated as `{}`). An invalid
 * request keeps its `id` when it had a usable one, so the page can be told
 * which call failed.
 */
export function parseRequest(raw: unknown): Parsed<WebConnectRequest> {
  if (!isRecord(raw)) return { ok: false, id: null, error: webConnectError('invalid_request') };
  const id = isRequestId(raw.id) ? raw.id : null;
  if (id === null)
    return {
      ok: false,
      id: null,
      error: webConnectError('invalid_request', 'Missing or invalid id'),
    };
  if (serializedLength(raw) > MAX_REQUEST_BYTES)
    return { ok: false, id, error: webConnectError('invalid_request', 'Request too large') };
  if (!isMethod(raw.method))
    return { ok: false, id, error: webConnectError('invalid_request', 'Unknown method') };
  const params = raw.params === undefined ? {} : raw.params;
  if (!isRecord(params))
    return { ok: false, id, error: webConnectError('invalid_request', 'params must be an object') };
  return { ok: true, value: { id, method: raw.method, params } };
}

/**
 * The page → relay envelope. Returns the inner request (still unvalidated:
 * the background validates it again, since the relay is just a pipe), or null
 * for anything that isn't ours. The caller has already checked
 * `event.source === window`.
 */
export function unwrapPageMessage(data: unknown): unknown | null {
  if (!isRecord(data) || data.source !== PAGE_SOURCE) return null;
  return { id: data.id, method: data.method, params: data.params };
}

/** A background → page response, as the page receives it from the relay. */
export function parseResponse(data: unknown): WebConnectResponse | null {
  if (!isRecord(data) || data.source !== RELAY_SOURCE) return null;
  if (!isRequestId(data.id)) return null;
  if (data.ok === true) return { id: data.id, ok: true, result: data.result };
  if (data.ok === false && isRecord(data.error) && typeof data.error.code === 'string') {
    const code = data.error.code as WebConnectErrorCode;
    const message =
      typeof data.error.message === 'string' ? data.error.message : (ERROR_MESSAGES[code] ?? '');
    return { id: data.id, ok: false, error: { code, message } };
  }
  return null;
}

/**
 * Something the background tells every page on a connected origin without
 * being asked: today only `change` (account, network, lock or revoke, #251).
 */
export const WEB_CONNECT_EVENTS = ['change'] as const;
export type WebConnectEventName = (typeof WEB_CONNECT_EVENTS)[number];
export interface WebConnectEvent {
  event: WebConnectEventName;
  data: Record<string, unknown>;
}

const isEventName = (v: unknown): v is WebConnectEventName =>
  typeof v === 'string' && (WEB_CONNECT_EVENTS as readonly string[]).includes(v);

/** A background → relay event, or null. */
export function parseEvent(data: unknown): WebConnectEvent | null {
  if (!isRecord(data) || !isEventName(data.event)) return null;
  return { event: data.event, data: isRecord(data.data) ? data.data : {} };
}

/** An event as the page receives it from the relay, or null. */
export function parsePageEvent(data: unknown): WebConnectEvent | null {
  if (!isRecord(data) || data.source !== RELAY_SOURCE) return null;
  return parseEvent(data);
}

/** Wraps a background response for `window.postMessage` back to the page. */
export function toPageMessage(res: WebConnectResponse | WebConnectEvent): Record<string, unknown> {
  return { source: RELAY_SOURCE, ...res };
}

/**
 * How long the page waits before giving up. Calls that need a person (an
 * approval window) get long enough to read a review; the rest are instant.
 */
export function requestTimeoutMs(method: WebConnectMethod): number {
  switch (method) {
    case 'requestAccess':
    case 'signTransaction':
    case 'signAuthEntry':
    case 'signMessage':
      return 10 * 60_000;
    default:
      return 15_000;
  }
}

// ---------------------------------------------------------------------------
// Who may talk to Lantern
// ---------------------------------------------------------------------------

/** The parts of a chrome.runtime.MessageSender this module reads. */
export interface SenderLike {
  id?: string;
  url?: string;
  origin?: string;
  frameId?: number;
  tab?: { id?: number };
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * True only for Lantern's own pages: the popup, a Lantern tab, the approval
 * window. A content script shares `sender.id` with them but reports the WEB
 * PAGE's url, so it fails the url check. `sender.tab` is not the test: an
 * extension page opened in a tab or window has one too.
 *
 * `extensionBaseUrl` is `chrome.runtime.getURL('')` ("chrome-extension://<id>/",
 * with the trailing slash, so a prefix match can't be fooled by a longer host).
 * Compared as a string: `URL.origin` is "null" for this scheme outside Chrome.
 */
export function isExtensionSender(
  sender: SenderLike,
  runtimeId: string,
  extensionBaseUrl: string,
): boolean {
  if (sender.id !== runtimeId || !extensionBaseUrl.endsWith('/')) return false;
  return typeof sender.url === 'string' && sender.url.startsWith(extensionBaseUrl);
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The web origin a web-connect port speaks for, or null to refuse it. Top
 * frame of a tab only; https only, plus http://localhost when `allowLocalhost`
 * (development builds). The origin comes from the browser (`sender.origin`,
 * falling back to `sender.url`), never from a message.
 */
export function webConnectOrigin(sender: SenderLike, allowLocalhost = false): string | null {
  if (sender.frameId !== 0 || sender.tab?.id === undefined) return null;
  const origin = sender.origin ?? originOf(sender.url);
  if (!origin || origin === 'null') return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return url.origin;
  if (allowLocalhost && url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))
    return url.origin;
  return null;
}
