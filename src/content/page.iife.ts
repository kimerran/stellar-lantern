import {
  PAGE_SOURCE,
  WEB_CONNECT_API_VERSION,
  parsePageEvent,
  parseResponse,
  requestTimeoutMs,
  webConnectError,
  type WebConnectError,
  type WebConnectErrorCode,
  type WebConnectEventName,
  type WebConnectMethod,
} from '@core/webconnect/protocol';

// Web connect (#248): `window.lantern`, defined in the page's own JS world
// (a MAIN-world content script). Every call is a postMessage to Lantern's
// relay content script (src/content/relay.iife.ts), which passes it to the
// background; approvals happen in Lantern's own window, never in the page.
//
// Kept self-contained (only the pure protocol module), so the bundle needs no
// further imports at runtime that a page's CSP could block.

class LanternError extends Error {
  readonly code: WebConnectErrorCode;
  constructor(err: WebConnectError) {
    super(err.message);
    this.name = 'LanternError';
    this.code = err.code;
  }
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};
const pending = new Map<string, Pending>();
const listeners = new Map<WebConnectEventName, Set<(data: Record<string, unknown>) => void>>();

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const ev = parsePageEvent(event.data);
  if (ev) {
    for (const cb of listeners.get(ev.event) ?? []) {
      try {
        cb(ev.data);
      } catch {
        // A dApp's listener throwing must not stop the others.
      }
    }
    return;
  }
  const res = parseResponse(event.data);
  if (!res) return;
  const p = pending.get(res.id);
  if (!p) return;
  pending.delete(res.id);
  clearTimeout(p.timer);
  if (res.ok) p.resolve(res.result);
  else p.reject(new LanternError(res.error));
});

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function call(method: WebConnectMethod, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = newId();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new LanternError(webConnectError('timeout')));
    }, requestTimeoutMs(method));
    pending.set(id, { resolve, reject, timer });
    window.postMessage({ source: PAGE_SOURCE, id, method, params }, window.location.origin);
  });
}

const api = Object.freeze({
  isLantern: true as const,
  apiVersion: WEB_CONNECT_API_VERSION,
  isConnected: () => call('isConnected'),
  requestAccess: () => call('requestAccess'),
  getAddress: () => call('getAddress'),
  getNetwork: () => call('getNetwork'),
  getNetworkDetails: () => call('getNetworkDetails'),
  signTransaction: (xdr: string, opts: { networkPassphrase?: string; address?: string } = {}) =>
    call('signTransaction', { xdr, ...opts }),
  signAuthEntry: (authEntry: string, opts: { networkPassphrase?: string; address?: string } = {}) =>
    call('signAuthEntry', { authEntry, ...opts }),
  signMessage: (message: string, opts: { networkPassphrase?: string; address?: string } = {}) =>
    call('signMessage', { message, ...opts }),
  on(event: WebConnectEventName, cb: (data: Record<string, unknown>) => void): void {
    if (typeof cb !== 'function') return;
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(cb);
  },
  off(event: WebConnectEventName, cb: (data: Record<string, unknown>) => void): void {
    listeners.get(event)?.delete(cb);
  },
});

try {
  // Not writable or configurable: a script on the page can't swap Lantern's
  // API for a lookalike after we define it.
  Object.defineProperty(window, 'lantern', {
    value: api,
    writable: false,
    configurable: false,
    enumerable: true,
  });
  window.dispatchEvent(new Event('lantern#initialized'));
} catch {
  // Something on the page already took `window.lantern`; stay out of its way.
}
