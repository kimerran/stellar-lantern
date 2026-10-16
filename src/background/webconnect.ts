import type { NetworkId } from '@shared/constants';
import type { Request, Result } from '@shared/messages';
import { getSettings, onSettingsChanged } from '@shared/storage';
import { resolveNetworkConfig } from '@shared/network';
import { handle } from '@core/session/handler';
import {
  PORT_NAME,
  webConnectError,
  webConnectOrigin,
  type WebConnectResponse,
} from '@core/webconnect/protocol';
import { answerWebConnect, type WebConnectDeps } from '@core/webconnect/router';
import { checkSigned, validateSignXdr } from '@core/dapp/sign-xdr';
import { ApprovalQueue, type PendingApproval } from '@core/webconnect/queue';
import {
  addGrant,
  findGrant,
  listGrants,
  revokeAll,
  revokeOrigin,
  touchGrant,
} from '@core/webconnect/grants';

// Web connect (#248–#251): the background end of the web-connect port, the
// queue of requests waiting for the user, and Lantern's approval window.
//
// A content script on a web page opens the port (src/content/relay.iife.ts).
// Nothing on it reaches the wallet's privileged handler: a request that needs
// the user is queued, Lantern's own approval window (index.html?approve=1)
// shows it, and only that window's decision, sent as a WC_DECIDE message from
// a Lantern page, answers it. One request is on screen at a time.
//
// The origin is taken from the port's sender once, when it connects; every
// request on that port is answered for that origin.

const APPROVAL_URL = 'index.html?approve=1';

interface PortEntry {
  port: chrome.runtime.Port;
  origin: string | null;
  tabId: number;
}

const ports = new Map<number, PortEntry>();
let nextPortId = 1;
const queue = new ApprovalQueue();
const waiters = new Map<string, (res: WebConnectResponse) => void>();
let approvalWindowId: number | null = null;
let opening: Promise<void> | null = null;
// When the approval window last found the queue empty (WC_NEXT → null), and
// so closed itself. A request queued after that and never shown is the only
// one that survives the window closing.
let emptyAt: number | null = null;

async function walletAddress(): Promise<string | null> {
  const res = (await handle({ type: 'GET_STATUS' })) as Result<{ address: string | null }>;
  return res.ok ? res.data.address : null;
}

async function activeNetwork() {
  const cfg = resolveNetworkConfig(await getSettings());
  return {
    id: cfg.id,
    passphrase: cfg.passphrase,
    horizonUrl: cfg.horizonUrl,
    sorobanRpcUrl: cfg.sorobanRpcUrl,
  };
}

async function openApprovalWindow(): Promise<void> {
  if (approvalWindowId !== null) {
    await chrome.windows.update(approvalWindowId, { focused: true }).catch(() => {
      approvalWindowId = null;
    });
    if (approvalWindowId !== null) return;
  }
  if (opening) return opening;
  opening = (async () => {
    try {
      const win = await chrome.windows.create({
        url: chrome.runtime.getURL(APPROVAL_URL),
        type: 'popup',
        width: 376, // the 360-px wallet plus window chrome
        height: 640,
        focused: true,
      });
      approvalWindowId = win?.id ?? null;
    } finally {
      opening = null;
    }
  })();
  return opening;
}

function answer(entry: PendingApproval, res: WebConnectResponse): void {
  const resolve = waiters.get(entry.entryId);
  waiters.delete(entry.entryId);
  resolve?.(res);
}

function rejectEntry(entry: PendingApproval): void {
  answer(entry, { id: entry.request.id, ok: false, error: webConnectError('user_rejected') });
}

function depsFor(portId: number, tabId: number): WebConnectDeps {
  return {
    address: walletAddress,
    network: activeNetwork,
    findGrant,
    touchGrant: (o, a, n) => touchGrant(o, a, n),
    approve: (kind, request, ctx) =>
      new Promise<WebConnectResponse>((resolve) => {
        const entry: PendingApproval = {
          entryId: crypto.randomUUID(),
          kind,
          origin: ctx.origin,
          portId,
          tabId,
          request,
          createdAt: Date.now(),
        };
        if (!queue.add(entry)) {
          resolve({ id: request.id, ok: false, error: webConnectError('busy') });
          return;
        }
        waiters.set(entry.entryId, resolve);
        void openApprovalWindow().catch(() => {
          // No window, no way to ask: refuse rather than hang.
          queue.take(entry.entryId);
          answer(entry, { id: request.id, ok: false, error: webConnectError('internal') });
        });
      }),
  };
}

/** Tell every page on these origins that something changed; they re-query. */
function emitChange(reason: 'account' | 'network' | 'revoke', origins?: Set<string>): void {
  for (const { port, origin } of ports.values()) {
    if (!origin || (origins && !origins.has(origin))) continue;
    try {
      port.postMessage({ event: 'change', data: { reason } });
    } catch {
      // The tab is going away.
    }
  }
}

export async function connectedOrigins(): Promise<Set<string>> {
  return new Set((await listGrants()).map((g) => g.origin));
}

// --- Messages from Lantern's own pages (the approval window, Settings) ------

export type WebConnectPageRequest = Extract<Request, { type: `WC_${string}` }>;

export function isWebConnectPageRequest(req: Request): req is WebConnectPageRequest {
  return typeof req?.type === 'string' && req.type.startsWith('WC_');
}

/** Answer a WC_* message. The caller has already checked it came from a Lantern page. */
export async function handleWebConnectPage(req: WebConnectPageRequest): Promise<Result<unknown>> {
  switch (req.type) {
    case 'WC_NEXT': {
      const head = queue.head();
      if (!head) {
        emptyAt = Date.now();
        return { ok: true, data: null };
      }
      head.shown = true;
      const net = await activeNetwork();
      return {
        ok: true,
        data: {
          entryId: head.entryId,
          kind: head.kind,
          origin: head.origin,
          method: head.request.method,
          params: head.request.params,
          pending: queue.size,
          address: await walletAddress(),
          network: net.id as NetworkId,
        },
      };
    }
    case 'WC_DECIDE': {
      const entry = queue.take(req.entryId);
      if (!entry) return { ok: false, error: 'That request is no longer waiting.' };
      if (!req.approve) {
        rejectEntry(entry);
        return { ok: true, data: { remaining: queue.size } };
      }
      if (entry.kind === 'connect') {
        const [address, net] = await Promise.all([walletAddress(), activeNetwork()]);
        if (!address || net.id !== 'TESTNET') {
          rejectEntry(entry);
          return { ok: false, error: 'Lantern can’t connect this site right now.' };
        }
        await addGrant(entry.origin, address, net.id);
        answer(entry, { id: entry.request.id, ok: true, result: { address } });
        return { ok: true, data: { remaining: queue.size } };
      }
      return decideSign(entry, req.result);
    }
    case 'WC_GRANTS':
      return { ok: true, data: await listGrants() };
    case 'WC_REVOKE': {
      if (req.origin) await revokeOrigin(req.origin);
      else await revokeAll();
      emitChange('revoke', req.origin ? new Set([req.origin]) : undefined);
      return { ok: true, data: { ok: true } };
    }
  }
}

/**
 * The approval window signed (#252): check what it hands back before the page
 * gets it. The site must still be connected for this account and network, the
 * transaction body must be the one requested (same hash), every signature it
 * already had must still be there, and this account's signature must be on it.
 * Anything else answers `internal` and nothing signed leaves Lantern.
 */
async function decideSign(entry: PendingApproval, result: unknown): Promise<Result<unknown>> {
  const [address, net] = await Promise.all([walletAddress(), activeNetwork()]);
  const fail = (code: 'not_allowed' | 'internal', error: string): Result<unknown> => {
    answer(entry, { id: entry.request.id, ok: false, error: webConnectError(code) });
    return { ok: false, error };
  };
  if (!address || net.id !== 'TESTNET' || !(await findGrant(entry.origin, address, net.id))) {
    return fail('not_allowed', 'This site is no longer connected for this account and network.');
  }
  const v = validateSignXdr(entry.request.params, { networkPassphrase: net.passphrase, address });
  const signedXdr = (result as { signedXdr?: unknown } | undefined)?.signedXdr;
  if (!v.ok || typeof signedXdr !== 'string')
    return fail('internal', 'The signed transaction is missing.');
  const problem = checkSigned(v.value.xdr, signedXdr, v.value.networkPassphrase, address);
  if (problem) return fail('internal', problem);
  answer(entry, {
    id: entry.request.id,
    ok: true,
    result: { signedTxXdr: signedXdr, signerAddress: address },
  });
  return { ok: true, data: { remaining: queue.size } };
}

/**
 * After a privileged wallet message: tell connected sites when the account
 * changed. A reset deletes every grant, so the caller reads the connected
 * origins before it runs and passes them in; a site that never connected
 * learns nothing.
 */
export async function afterWalletMessage(
  req: Request,
  connectedBefore?: Set<string>,
): Promise<void> {
  if (req.type === 'CREATE_WALLET' || req.type === 'IMPORT_WALLET')
    emitChange('account', await connectedOrigins());
  if (req.type === 'RESET_WALLET') emitChange('account', connectedBefore ?? new Set());
}

// --- The port --------------------------------------------------------------

export function listenForWebConnect(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    const origin = webConnectOrigin(port.sender ?? {}, import.meta.env.DEV);
    const tabId = port.sender?.tab?.id ?? -1;
    const portId = nextPortId++;
    ports.set(portId, { port, origin, tabId });
    const deps = depsFor(portId, tabId);

    port.onDisconnect.addListener(() => {
      ports.delete(portId);
      // The page navigated or closed: its waiting requests have no one to answer.
      for (const e of queue.dropPort(portId)) waiters.delete(e.entryId);
    });

    port.onMessage.addListener((raw: unknown) => {
      void (async () => {
        if (origin === null) {
          const id =
            typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : null;
          if (id) port.postMessage({ id, ok: false, error: webConnectError('not_allowed') });
          return;
        }
        const res = await answerWebConnect(raw, { origin }, deps);
        if (res && ports.has(portId)) {
          try {
            port.postMessage(res);
          } catch {
            // The tab went away while we were answering.
          }
        }
      })();
    });
  });

  // Closing the approval window rejects the request at its head, including
  // one the user dismissed from the Unlock screen (never fetched, so never
  // `shown`). The one exception: a request that arrived after the window
  // found the queue empty and closed itself was never in front of the user,
  // so it keeps its place. Anything still queued gets the window back.
  chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId !== approvalWindowId) return;
    approvalWindowId = null;
    const head = queue.head();
    const arrivedAfterClose =
      !!head && !head.shown && emptyAt !== null && head.createdAt >= emptyAt;
    emptyAt = null;
    if (head && !arrivedAfterClose) {
      queue.take(head.entryId);
      rejectEntry(head);
    }
    if (queue.size > 0) void openApprovalWindow();
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const e of queue.dropTab(tabId)) waiters.delete(e.entryId);
  });

  let lastNetwork: NetworkId | null = null;
  void getSettings().then((s) => (lastNetwork = s.network));
  onSettingsChanged((s) => {
    if (s.network === lastNetwork) return;
    lastNetwork = s.network;
    void connectedOrigins().then((o) => emitChange('network', o));
  });
}

/** Test hook: forget all state between tests. */
export function __resetWebConnect(): void {
  ports.clear();
  waiters.clear();
  while (queue.head()) queue.take(queue.head()!.entryId);
  approvalWindowId = null;
  opening = null;
  emptyAt = null;
  nextPortId = 1;
}
