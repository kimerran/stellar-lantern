import { PORT_NAME, webConnectError, webConnectOrigin } from '@core/webconnect/protocol';
import { answerWebConnect } from '@core/webconnect/router';

// Web connect (#248): the background end of the web-connect port. A content
// script on a web page opens it (src/content/relay.iife.ts); nothing on it reaches
// the wallet's privileged handler (src/core/session/handler.ts). Requests that
// need the user go through Lantern's own approval window (#249).
//
// The origin is taken from the port's sender once, when it connects, and every
// request on that port is answered for that origin. A port the browser didn't
// open from the top frame of an https tab gets `not_allowed` for everything.
export function listenForWebConnect(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    const origin = webConnectOrigin(port.sender ?? {}, import.meta.env.DEV);
    port.onMessage.addListener((raw: unknown) => {
      void (async () => {
        if (origin === null) {
          const id =
            typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : null;
          if (id) port.postMessage({ id, ok: false, error: webConnectError('not_allowed') });
          return;
        }
        const res = await answerWebConnect(raw, { origin });
        if (res) {
          try {
            port.postMessage(res);
          } catch {
            // The tab went away while we were answering.
          }
        }
      })();
    });
  });
}
