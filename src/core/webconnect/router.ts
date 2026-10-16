import type { NetworkId } from '@shared/constants';
import {
  WEB_CONNECT_API_VERSION,
  parseRequest,
  webConnectError,
  type WebConnectRequest,
  type WebConnectResponse,
} from './protocol';
import type { ApprovalKind } from './queue';
import type { Grant } from './grants';
import { validateSignXdr } from '@core/dapp/sign-xdr';

// Web connect (#246): what the background answers on the web-connect port.
//
// `origin` is the page's origin as the browser reported it on the port
// (webConnectOrigin), never a value from the message. Every method except
// isConnected and requestAccess needs a grant for the CURRENT account and
// network (#250); a site without one learns nothing, not even whether a wallet
// exists or is locked. Anything that needs the user goes to `approve`, which
// queues it for Lantern's approval window (#249) and resolves with the answer.

export interface WebConnectContext {
  origin: string;
}

export interface NetworkView {
  id: NetworkId;
  passphrase: string;
  horizonUrl: string;
  sorobanRpcUrl?: string;
}

export interface WebConnectDeps {
  /** The vault's public address (known while locked too), or null with no wallet. */
  address(): Promise<string | null>;
  network(): Promise<NetworkView>;
  findGrant(origin: string, address: string, network: NetworkId): Promise<Grant | null>;
  touchGrant(origin: string, address: string, network: NetworkId): Promise<void>;
  approve(
    kind: ApprovalKind,
    req: WebConnectRequest,
    ctx: WebConnectContext,
  ): Promise<WebConnectResponse>;
}

/** The first release is testnet only (#247): mainnet needs its own sign-off. */
export const TESTNET_ONLY_MESSAGE = 'Lantern connects to websites on Testnet only in this version.';

const fail = (
  req: WebConnectRequest,
  code: Parameters<typeof webConnectError>[0],
  message?: string,
) => ({ id: req.id, ok: false, error: webConnectError(code, message) }) as const;
const done = (req: WebConnectRequest, result: unknown): WebConnectResponse => ({
  id: req.id,
  ok: true,
  result,
});

export async function routeWebConnect(
  req: WebConnectRequest,
  ctx: WebConnectContext,
  deps: WebConnectDeps,
): Promise<WebConnectResponse> {
  if (req.method === 'isConnected') {
    // Freighter-compatible: "installed and answering". Whether this SITE may
    // read the address is requestAccess/getAddress's business.
    return done(req, { isConnected: true, apiVersion: WEB_CONNECT_API_VERSION });
  }
  if (req.method === 'signAuthEntry' || req.method === 'signMessage') {
    // Not in the first release (#253, #254): each needs its own review.
    return fail(req, 'unsupported');
  }

  const net = await deps.network();
  if (net.id !== 'TESTNET') return fail(req, 'not_allowed', TESTNET_ONLY_MESSAGE);
  const address = await deps.address();
  const grant = address ? await deps.findGrant(ctx.origin, address, net.id) : null;

  if (req.method === 'requestAccess') {
    if (grant && address) {
      await deps.touchGrant(ctx.origin, address, net.id);
      return done(req, { address });
    }
    return deps.approve('connect', req, ctx);
  }

  if (!grant || !address) return fail(req, 'not_allowed');
  await deps.touchGrant(ctx.origin, address, net.id);
  if (req.method === 'signTransaction') return signTransaction(req, ctx, deps, address, net);
  switch (req.method) {
    case 'getAddress':
      return done(req, { address });
    case 'getNetwork':
      return done(req, { network: net.id, networkPassphrase: net.passphrase });
    case 'getNetworkDetails':
      return done(req, {
        network: net.id,
        networkPassphrase: net.passphrase,
        networkUrl: net.horizonUrl,
        ...(net.sorobanRpcUrl ? { sorobanRpcUrl: net.sorobanRpcUrl } : {}),
      });
    default:
      return fail(req, 'unsupported');
  }
}

/**
 * signTransaction (#252): checked before any window opens, so a request for
 * the wrong network or account, or one that isn't a transaction this account
 * signs, never reaches the user. What reaches the approval window is the
 * request with its network passphrase filled in: a dApp that leaves it out
 * (as Freighter allows) means "the network Lantern is on".
 */
async function signTransaction(
  req: WebConnectRequest,
  ctx: WebConnectContext,
  deps: WebConnectDeps,
  address: string,
  net: NetworkView,
): Promise<WebConnectResponse> {
  const { xdr, networkPassphrase, address: asked } = req.params;
  if (asked !== undefined && asked !== address) return fail(req, 'account_mismatch');
  const passphrase = networkPassphrase === undefined ? net.passphrase : networkPassphrase;
  const v = validateSignXdr(
    { xdr, networkPassphrase: passphrase },
    { networkPassphrase: net.passphrase, address },
  );
  if (!v.ok)
    return fail(
      req,
      v.code === 'network_mismatch' ? 'network_mismatch' : 'invalid_request',
      v.error,
    );
  return deps.approve(
    'sign',
    { ...req, params: { xdr: v.value.xdr, networkPassphrase: v.value.networkPassphrase } },
    ctx,
  );
}

/**
 * One raw message off the port → its response. An invalid message with no
 * usable id gets no answer (there is nothing to address it to); the page's
 * own timeout covers it.
 */
export async function answerWebConnect(
  raw: unknown,
  ctx: WebConnectContext,
  deps: WebConnectDeps,
): Promise<WebConnectResponse | null> {
  const parsed = parseRequest(raw);
  if (!parsed.ok)
    return parsed.id === null ? null : { id: parsed.id, ok: false, error: parsed.error };
  try {
    return await routeWebConnect(parsed.value, ctx, deps);
  } catch {
    return { id: parsed.value.id, ok: false, error: webConnectError('internal') };
  }
}
