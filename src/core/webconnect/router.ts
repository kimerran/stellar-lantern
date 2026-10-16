import {
  WEB_CONNECT_API_VERSION,
  parseRequest,
  webConnectError,
  type WebConnectRequest,
  type WebConnectResponse,
} from './protocol';

// Web connect (#246): what the background answers on the web-connect port.
// Each slice adds methods here. This one (#248) only answers isConnected; the
// rest reply `unsupported` until their slice lands, so a dApp can tell "this
// Lantern can't do that yet" from "the user said no".
//
// `origin` is the page's origin as the browser reported it on the port
// (webConnectOrigin), never a value from the message.

export interface WebConnectContext {
  origin: string;
}

export async function routeWebConnect(
  req: WebConnectRequest,
  _ctx: WebConnectContext,
): Promise<WebConnectResponse> {
  switch (req.method) {
    case 'isConnected':
      // Freighter-compatible shape. "Connected" here means "Lantern is
      // installed and answering", as Freighter's isConnected does; whether this
      // SITE may read the address is requestAccess/getAddress's business (#251).
      return {
        id: req.id,
        ok: true,
        result: { isConnected: true, apiVersion: WEB_CONNECT_API_VERSION },
      };
    default:
      return { id: req.id, ok: false, error: webConnectError('unsupported') };
  }
}

/**
 * One raw message off the port → its response. An invalid message with no
 * usable id gets no answer (there is nothing to address it to); the page's
 * own timeout covers it.
 */
export async function answerWebConnect(
  raw: unknown,
  ctx: WebConnectContext,
): Promise<WebConnectResponse | null> {
  const parsed = parseRequest(raw);
  if (!parsed.ok)
    return parsed.id === null ? null : { id: parsed.id, ok: false, error: parsed.error };
  try {
    return await routeWebConnect(parsed.value, ctx);
  } catch {
    return { id: parsed.value.id, ok: false, error: webConnectError('internal') };
  }
}
