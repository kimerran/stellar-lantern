import '@shared/polyfills'; // must be first — sets Buffer/process/global before Stellar loads
import type { Request } from '@shared/messages';
import { dispatch, lockSession } from '@core/session/handler';

// MV3 service worker. Owns the unlocked session via the shared, host-agnostic
// handler (src/core/session) and bridges it to chrome.runtime messaging. The
// Android host (src/mobile) wires the same dispatch() in-process instead.

chrome.runtime.onMessage.addListener((req: Request, _sender, sendResponse) => {
  dispatch(req).then(sendResponse);
  return true; // keep the message channel open for the async response
});

// Lock on install/startup so a fresh browser session always requires unlock.
chrome.runtime.onStartup.addListener(() => lockSession());
chrome.runtime.onInstalled.addListener(() => lockSession());
