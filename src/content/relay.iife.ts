import {
  PORT_NAME,
  isRequestId,
  parseEvent,
  toPageMessage,
  unwrapPageMessage,
  webConnectError,
  type WebConnectResponse,
} from '@core/webconnect/protocol';

// Web connect (#248): the content script in the ISOLATED world. A pipe between
// the page's window.lantern (src/content/page.iife.ts) and the background
// (src/background/webconnect.ts). It never reads the page's DOM, cookies or
// storage; it only forwards our own namespaced messages, and the background
// validates every request again.

// A page can't queue more than this many unanswered requests through us.
const MAX_IN_FLIGHT = 32;

let port: chrome.runtime.Port | null = null;
const inFlight = new Set<string>();

function toPage(res: WebConnectResponse): void {
  window.postMessage(toPageMessage(res), window.location.origin);
}

function connect(): chrome.runtime.Port {
  if (port) return port;
  const p = chrome.runtime.connect({ name: PORT_NAME });
  p.onMessage.addListener((msg: unknown) => {
    const event = parseEvent(msg);
    if (event) {
      window.postMessage(toPageMessage(event), window.location.origin);
      return;
    }
    const res = msg as WebConnectResponse;
    if (!res || typeof res.id !== 'string' || !inFlight.delete(res.id)) return;
    toPage(res);
  });
  p.onDisconnect.addListener(() => {
    port = null;
    // The extension restarted, updated or was disabled: every open call fails
    // now rather than hanging until the page's timeout.
    for (const id of inFlight) toPage({ id, ok: false, error: webConnectError('connection_lost') });
    inFlight.clear();
  });
  port = p;
  return p;
}

window.addEventListener('message', (event: MessageEvent) => {
  // Only this window's own scripts: not another frame, not another tab.
  if (event.source !== window) return;
  const req = unwrapPageMessage(event.data) as { id?: unknown } | null;
  if (!req) return;
  // A request the background would drop unanswered (no usable id) must not
  // take an in-flight slot; the page's own timeout covers it.
  if (!isRequestId(req.id) || inFlight.has(req.id)) return;
  if (inFlight.size >= MAX_IN_FLIGHT) {
    toPage({ id: req.id, ok: false, error: webConnectError('busy') });
    return;
  }
  inFlight.add(req.id);
  try {
    connect().postMessage(req);
  } catch {
    // "Extension context invalidated": Lantern was reloaded under this page.
    inFlight.delete(req.id);
    port = null;
    toPage({ id: req.id, ok: false, error: webConnectError('connection_lost') });
  }
});
