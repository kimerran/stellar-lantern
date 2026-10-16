import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PAGE_SOURCE, RELAY_SOURCE } from '@core/webconnect/protocol';

// The two web-connect content scripts (#248) against a fake window: the page
// API (MAIN world) and the relay (ISOLATED world). Both scripts run on import,
// so each test gets a fresh window and fresh modules.

type Msg = { data: unknown; target: string };
interface FakeWindow extends EventTarget {
  location: { origin: string };
  posted: Msg[];
  postMessage: (data: unknown, target: string) => void;
  lantern?: Record<string, unknown> & {
    isConnected: () => Promise<unknown>;
    signTransaction: (xdr: string, o?: Record<string, unknown>) => Promise<unknown>;
    on: (e: 'change', cb: (d: Record<string, unknown>) => void) => void;
    off: (e: 'change', cb: (d: Record<string, unknown>) => void) => void;
  };
}

function makeWindow(): FakeWindow {
  const w = new EventTarget() as FakeWindow;
  w.location = { origin: 'https://app.paiflow.xyz' };
  w.posted = [];
  w.postMessage = (data, target) => {
    w.posted.push({ data, target });
  };
  return w;
}

/** A message event as the browser would deliver it to `w`. */
function deliver(w: FakeWindow, data: unknown, source: unknown = w): void {
  const ev = new Event('message');
  Object.defineProperty(ev, 'data', { value: data });
  Object.defineProperty(ev, 'source', { value: source });
  w.dispatchEvent(ev);
}

let win: FakeWindow;
beforeEach(() => {
  vi.resetModules();
  win = makeWindow();
  (globalThis as Record<string, unknown>).window = win;
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).chrome;
});

describe('window.lantern (page script)', () => {
  it('is defined, frozen and not replaceable, and announces itself', async () => {
    const seen = vi.fn();
    win.addEventListener('lantern#initialized', seen);
    await import('../src/content/page.iife');
    expect(win.lantern?.isLantern).toBe(true);
    expect(win.lantern?.apiVersion).toBe(1);
    expect(Object.isFrozen(win.lantern)).toBe(true);
    expect(() => {
      (win as unknown as Record<string, unknown>).lantern = { fake: true };
    }).toThrow();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('posts a namespaced request to its own origin and resolves on the reply', async () => {
    await import('../src/content/page.iife');
    const p = win.lantern!.signTransaction('AAAA', {
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    expect(win.posted).toHaveLength(1);
    const { data, target } = win.posted[0]!;
    expect(target).toBe('https://app.paiflow.xyz');
    const req = data as { source: string; id: string; method: string; params: unknown };
    expect(req).toMatchObject({
      source: PAGE_SOURCE,
      method: 'signTransaction',
      params: { xdr: 'AAAA', networkPassphrase: 'Test SDF Network ; September 2015' },
    });
    deliver(win, { source: RELAY_SOURCE, id: req.id, ok: true, result: { signedTxXdr: 'BBBB' } });
    await expect(p).resolves.toEqual({ signedTxXdr: 'BBBB' });
  });

  it('rejects with a LanternError carrying the stable code', async () => {
    await import('../src/content/page.iife');
    const p = win.lantern!.isConnected();
    const id = (win.posted[0]!.data as { id: string }).id;
    deliver(win, {
      source: RELAY_SOURCE,
      id,
      ok: false,
      error: { code: 'user_rejected', message: 'User rejected the request' },
    });
    await expect(p).rejects.toMatchObject({
      name: 'LanternError',
      code: 'user_rejected',
      message: 'User rejected the request',
    });
  });

  it('ignores replies from another frame, and forged ids', async () => {
    await import('../src/content/page.iife');
    vi.useFakeTimers();
    const p = win.lantern!.isConnected();
    const id = (win.posted[0]!.data as { id: string }).id;
    deliver(
      win,
      { source: RELAY_SOURCE, id, ok: true, result: 'from a frame' },
      { other: 'window' },
    );
    deliver(win, { source: RELAY_SOURCE, id: 'not-the-id', ok: true, result: 'forged' });
    vi.advanceTimersByTime(15_000);
    await expect(p).rejects.toMatchObject({ code: 'timeout' });
  });

  it('delivers change events to listeners until they unsubscribe', async () => {
    await import('../src/content/page.iife');
    const cb = vi.fn();
    win.lantern!.on('change', cb);
    deliver(win, { source: RELAY_SOURCE, event: 'change', data: { network: 'TESTNET' } });
    win.lantern!.off('change', cb);
    deliver(win, { source: RELAY_SOURCE, event: 'change', data: { network: 'PUBLIC' } });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ network: 'TESTNET' });
  });
});

interface FakePort {
  posted: unknown[];
  msg?: (m: unknown) => void;
  disc?: () => void;
}

function fakeChrome(opts: { throwOnPost?: boolean } = {}): { ports: FakePort[] } {
  const ports: FakePort[] = [];
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      connect: ({ name }: { name: string }) => {
        expect(name).toBe('lantern-webconnect');
        const p: FakePort = { posted: [] };
        ports.push(p);
        return {
          postMessage: (m: unknown) => {
            if (opts.throwOnPost) throw new Error('Extension context invalidated.');
            p.posted.push(m);
          },
          onMessage: { addListener: (cb: (m: unknown) => void) => (p.msg = cb) },
          onDisconnect: { addListener: (cb: () => void) => (p.disc = cb) },
        };
      },
    },
  };
  return { ports };
}

describe('relay (content script)', () => {
  it('forwards only this window’s namespaced requests to the background port', async () => {
    const { ports } = fakeChrome();
    await import('../src/content/relay.iife');
    deliver(win, { source: PAGE_SOURCE, id: 'r1', method: 'isConnected', params: {} });
    deliver(win, { source: PAGE_SOURCE, id: 'r2', method: 'isConnected' }, { other: 'frame' });
    deliver(win, { source: 'someone-else', id: 'r3', method: 'isConnected' });
    deliver(win, { source: PAGE_SOURCE, id: 'bad id!', method: 'isConnected' });
    expect(ports).toHaveLength(1);
    expect(ports[0]!.posted).toEqual([{ id: 'r1', method: 'isConnected', params: {} }]);
  });

  it('posts the background’s answer back to the page, to the page’s own origin', async () => {
    const { ports } = fakeChrome();
    await import('../src/content/relay.iife');
    deliver(win, { source: PAGE_SOURCE, id: 'r1', method: 'isConnected', params: {} });
    win.posted = [];
    ports[0]!.msg!({ id: 'r1', ok: true, result: { isConnected: true } });
    ports[0]!.msg!({ id: 'unknown', ok: true, result: 'not asked for' });
    expect(win.posted).toEqual([
      {
        data: { source: RELAY_SOURCE, id: 'r1', ok: true, result: { isConnected: true } },
        target: 'https://app.paiflow.xyz',
      },
    ]);
  });

  it('passes background events through', async () => {
    const { ports } = fakeChrome();
    await import('../src/content/relay.iife');
    deliver(win, { source: PAGE_SOURCE, id: 'r1', method: 'isConnected', params: {} });
    win.posted = [];
    ports[0]!.msg!({ event: 'change', data: { locked: true } });
    expect(win.posted).toEqual([
      {
        data: { source: RELAY_SOURCE, event: 'change', data: { locked: true } },
        target: 'https://app.paiflow.xyz',
      },
    ]);
  });

  it('fails open calls with connection_lost when the extension goes away, then reconnects', async () => {
    const { ports } = fakeChrome();
    await import('../src/content/relay.iife');
    deliver(win, { source: PAGE_SOURCE, id: 'r1', method: 'signTransaction', params: {} });
    win.posted = [];
    ports[0]!.disc!();
    expect(win.posted).toEqual([
      {
        data: {
          source: RELAY_SOURCE,
          id: 'r1',
          ok: false,
          error: { code: 'connection_lost', message: 'Lost the connection to Lantern' },
        },
        target: 'https://app.paiflow.xyz',
      },
    ]);
    deliver(win, { source: PAGE_SOURCE, id: 'r2', method: 'isConnected', params: {} });
    expect(ports).toHaveLength(2);
  });

  it('answers connection_lost at once when the extension context is gone', async () => {
    fakeChrome({ throwOnPost: true });
    await import('../src/content/relay.iife');
    deliver(win, { source: PAGE_SOURCE, id: 'r1', method: 'isConnected', params: {} });
    expect(win.posted.at(-1)?.data).toMatchObject({
      id: 'r1',
      ok: false,
      error: { code: 'connection_lost' },
    });
  });

  it('caps unanswered requests per page and answers the excess busy', async () => {
    const { ports } = fakeChrome();
    await import('../src/content/relay.iife');
    for (let i = 0; i < 33; i++)
      deliver(win, { source: PAGE_SOURCE, id: `r${i}`, method: 'isConnected', params: {} });
    expect(ports[0]!.posted).toHaveLength(32);
    expect(win.posted.at(-1)?.data).toMatchObject({
      id: 'r32',
      ok: false,
      error: { code: 'busy' },
    });
  });
});
