import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { Request } from '@shared/messages';

// The background worker's privileged listener (#247/#248): once web connect
// adds content scripts, a web page's script can call chrome.runtime.sendMessage
// with our extension id. Every existing message type must refuse it, without
// reaching the wallet handler. Lantern's own pages (popup, a tab, the approval
// window) must still get through.

const handle = vi.fn(async () => ({ ok: true, data: {} }));
vi.mock('@core/session/handler', () => ({ handle, lock: vi.fn() }));
vi.mock('@core/telemetry', () => ({ bootTelemetry: vi.fn(async () => undefined) }));

const EXT_ID = 'iflpkjgolcbleombhldiibhojohjpnmd';
const BASE = `chrome-extension://${EXT_ID}/`;

type Listener = (req: unknown, sender: unknown, send: (r: unknown) => void) => boolean | void;
type PortListener = (port: FakePort) => void;
interface FakePort {
  name: string;
  sender: unknown;
  posted: unknown[];
  onMessage: { addListener: (cb: (m: unknown) => void) => void };
  postMessage: (m: unknown) => void;
  deliver: (m: unknown) => void;
}

let onMessage: Listener;
let onConnect: PortListener;

beforeAll(async () => {
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      id: EXT_ID,
      getURL: (p: string) => BASE + p,
      onMessage: { addListener: (cb: Listener) => (onMessage = cb) },
      onConnect: { addListener: (cb: PortListener) => (onConnect = cb) },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
  };
  await import('../src/background/index');
});

const ALL_TYPES: Request[] = [
  { type: 'GET_STATUS' },
  { type: 'GENERATE_MNEMONIC', strength: 128 },
  { type: 'CREATE_WALLET', mnemonic: 'm', password: 'p' },
  { type: 'IMPORT_WALLET', input: 'i', password: 'p' },
  { type: 'UNLOCK', password: 'p' },
  { type: 'ENABLE_BIOMETRIC', password: 'p' },
  { type: 'BIOMETRIC_UNLOCK' },
  { type: 'DISABLE_BIOMETRIC' },
  { type: 'LOCK' },
  { type: 'PING' },
  { type: 'SIGN_AND_SUBMIT', xdr: 'x', networkPassphrase: 'n', horizonUrl: 'h' },
  { type: 'SIGN_ONLY', xdr: 'x', networkPassphrase: 'n' },
  { type: 'SUBMIT_ONLY', xdr: 'x', networkPassphrase: 'n', horizonUrl: 'h' },
  { type: 'SIGN_MESSAGE', message: 'm' },
  { type: 'RESET_WALLET' },
];

function send(req: unknown, sender: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    onMessage(req, sender, resolve);
  });
}

describe('background onMessage: Lantern pages only', () => {
  it('refuses every message type from a content script, before the handler', async () => {
    const contentScript = {
      id: EXT_ID,
      url: 'https://evil.example/page',
      origin: 'https://evil.example',
      tab: { id: 9 },
      frameId: 0,
    };
    for (const req of ALL_TYPES) {
      expect(await send(req, contentScript)).toEqual({
        ok: false,
        error: 'Not allowed',
        code: 'VALIDATION',
      });
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it('refuses another extension', async () => {
    expect(
      await send(
        { type: 'GET_STATUS' },
        { id: 'someone-else', url: 'chrome-extension://someone-else/x.html' },
      ),
    ).toMatchObject({
      ok: false,
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('serves the popup and an extension page in a tab (the approval window)', async () => {
    await send({ type: 'GET_STATUS' }, { id: EXT_ID, url: `${BASE}index.html` });
    await send(
      { type: 'GET_STATUS' },
      { id: EXT_ID, url: `${BASE}index.html#/approve`, tab: { id: 4 } },
    );
    expect(handle).toHaveBeenCalledTimes(2);
  });
});

function fakePort(sender: unknown, name = 'lantern-webconnect'): FakePort {
  let cb: (m: unknown) => void = () => {};
  const port: FakePort = {
    name,
    sender,
    posted: [],
    onMessage: { addListener: (f) => (cb = f) },
    postMessage: (m) => port.posted.push(m),
    deliver: (m) => cb(m),
  };
  return port;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('background web-connect port', () => {
  it('answers isConnected for an https top frame', async () => {
    const port = fakePort({
      id: EXT_ID,
      origin: 'https://app.paiflow.xyz',
      url: 'https://app.paiflow.xyz/',
      frameId: 0,
      tab: { id: 1 },
    });
    onConnect(port);
    port.deliver({ id: 'r1', method: 'isConnected', params: {} });
    await flush();
    expect(port.posted).toEqual([
      { id: 'r1', ok: true, result: { isConnected: true, apiVersion: 1 } },
    ]);
  });

  it('answers not_allowed to a frame or a non-https page, for every call', async () => {
    for (const sender of [
      { id: EXT_ID, origin: 'https://a.example', frameId: 3, tab: { id: 1 } },
      { id: EXT_ID, origin: 'http://a.example', frameId: 0, tab: { id: 1 } },
    ]) {
      const port = fakePort(sender);
      onConnect(port);
      port.deliver({ id: 'r1', method: 'isConnected' });
      await flush();
      expect(port.posted).toEqual([
        {
          id: 'r1',
          ok: false,
          error: { code: 'not_allowed', message: 'This site is not connected to Lantern' },
        },
      ]);
    }
  });

  it('ignores ports with another name, and never calls the wallet handler', async () => {
    const port = fakePort(
      { id: EXT_ID, origin: 'https://a.example', frameId: 0, tab: { id: 1 } },
      'something-else',
    );
    onConnect(port);
    port.deliver({ id: 'r1', method: 'isConnected' });
    await flush();
    expect(port.posted).toEqual([]);
    expect(handle).toHaveBeenCalledTimes(2); // only the two Lantern-page calls above
  });
});
