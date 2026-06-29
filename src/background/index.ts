import '@shared/polyfills'; // must be first — sets Buffer/process/global before Stellar loads
import type { Request } from '@shared/messages';
import { handle, lock } from '@core/session/handler';

// The service worker is now a thin transport: it routes chrome messages to the
// shared in-process handler (which holds the unlocked session in worker memory).
chrome.runtime.onMessage.addListener((req: Request, _sender, sendResponse) => {
  handle(req).then(sendResponse);
  return true; // keep the message channel open for the async response
});

// Lock on install/startup so a fresh browser session always requires unlock.
chrome.runtime.onStartup.addListener(() => lock());
chrome.runtime.onInstalled.addListener(() => lock());
