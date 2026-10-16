import '@shared/polyfills'; // must be first — sets Buffer/process/global before Stellar loads
import type { Request } from '@shared/messages';
import { handle, lock } from '@core/session/handler';
import { bootTelemetry } from '@core/telemetry';
import { APP_VERSION } from '@shared/version';
import { isExtensionSender } from '@core/webconnect/protocol';
import {
  afterWalletMessage,
  handleWebConnectPage,
  isWebConnectPageRequest,
  listenForWebConnect,
} from './webconnect';

// Telemetry (#87): the service worker signs and submits (tx_signed), so it
// needs its own consent-gated sink. No session_start here — the popup owns
// that. flushAt: 1 sends each event immediately: Chrome ends an idle MV3
// worker after ~30 s and a pending timer does not keep it alive, so a
// buffered event would be lost; a started keepalive fetch survives.
// The boot is awaited before any request is handled, so a SIGN_AND_SUBMIT
// that arrives while settings are still loading cannot outrun the sink and
// drop its tx_signed. It never rejects: a telemetry failure must not block
// the wallet.
const telemetryReady: Promise<void> = __FEATURE_TELEMETRY__
  ? bootTelemetry({ appVersion: APP_VERSION, session: false, flushAt: 1 }).catch(() => undefined)
  : Promise.resolve();

// Lantern's own pages only (#247/#248). A content script shares our extension
// id but reports the web page's url, so it is refused here: web pages reach
// Lantern through the web-connect port below, never this handler.
const EXTENSION_BASE_URL = chrome.runtime.getURL('');

// The service worker is now a thin transport: it routes chrome messages to the
// shared in-process handler (which holds the unlocked session in worker memory).
chrome.runtime.onMessage.addListener((req: Request, sender, sendResponse) => {
  if (!isExtensionSender(sender, chrome.runtime.id, EXTENSION_BASE_URL)) {
    sendResponse({ ok: false, error: 'Not allowed', code: 'VALIDATION' });
    return false;
  }
  if (__FEATURE_WEB_CONNECT__ && isWebConnectPageRequest(req)) {
    void handleWebConnectPage(req).then(sendResponse);
    return true;
  }
  const handled = telemetryReady.then(() => handle(req));
  handled.then(sendResponse);
  // Tell connected sites when the account changed (#251).
  if (__FEATURE_WEB_CONNECT__) {
    void handled.then((res) => {
      if (res.ok) void afterWalletMessage(req);
    });
  }
  return true; // keep the message channel open for the async response
});

if (__FEATURE_WEB_CONNECT__) listenForWebConnect();

// Lock on install/startup so a fresh browser session always requires unlock.
chrome.runtime.onStartup.addListener(() => lock());
chrome.runtime.onInstalled.addListener(() => lock());
