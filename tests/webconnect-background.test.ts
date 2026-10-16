import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { addGrant, listGrants, revokeAll } from '@core/webconnect/grants';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

// Web connect's background service end to end (#249–#251), against a fake
// chrome: a page connects over the port, asks for access, Lantern's approval
// window opens, the user decides through WC_* messages from a Lantern page.

const ADDRESS = 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK';
const status = { address: ADDRESS as string | null };
vi.mock('@core/session/handler', () => ({
  handle: vi.fn(async (req: { type: string }) =>
    req.type === 'GET_STATUS'
      ? { ok: true, data: { initialized: true, locked: true, address: status.address } }
      : { ok: true, data: {} },
  ),
  lock: vi.fn(),
}));
vi.mock('@core/telemetry', () => ({ bootTelemetry: vi.fn(async () => undefined) }));

const EXT_ID = 'iflpkjgolcbleombhldiibhojohjpnmd';
const BASE = `chrome-extension://${EXT_ID}/`;
const SITE = 'https://beta.app.paiflow.xyz';

type Cb<T extends unknown[] = unknown[]> = (...a: T) => void;
const hooks: {
  onMessage?: (req: unknown, sender: unknown, send: (r: unknown) => void) => boolean | void;
  onConnect?: Cb<[FakePort]>;
  windowRemoved?: Cb<[number]>;
  tabRemoved?: Cb<[number]>;
} = {};
const windowsCreated: Array<{ url: string; type: string }> = [];
let nextWindowId = 100;

interface FakePort {
  name: string;
  sender: unknown;
  posted: unknown[];
  msg?: Cb<[unknown]>;
  disc?: Cb;
  onMessage: { addListener: (cb: Cb<[unknown]>) => void };
  onDisconnect: { addListener: (cb: Cb) => void };
  postMessage: (m: unknown) => void;
}

function port(origin = SITE, tabId = 1): FakePort {
  const p: FakePort = {
    name: 'lantern-webconnect',
    sender: { id: EXT_ID, origin, url: `${origin}/`, frameId: 0, tab: { id: tabId } },
    posted: [],
    onMessage: { addListener: (cb) => (p.msg = cb) },
    onDisconnect: { addListener: (cb) => (p.disc = cb) },
    postMessage: (m) => p.posted.push(m),
  };
  hooks.onConnect!(p);
  return p;
}

const lanternPage = { id: EXT_ID, url: `${BASE}index.html?approve=1`, tab: { id: 77 } };
function page(req: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return new Promise((resolve) =>
    hooks.onMessage!(req, lanternPage, resolve as (r: unknown) => void),
  );
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function memKV(): KV {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      id: EXT_ID,
      getURL: (p: string) => BASE + p,
      onMessage: { addListener: (cb: typeof hooks.onMessage) => (hooks.onMessage = cb) },
      onConnect: { addListener: (cb: Cb<[FakePort]>) => (hooks.onConnect = cb) },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    windows: {
      create: vi.fn(async (o: { url: string; type: string }) => {
        windowsCreated.push(o);
        return { id: nextWindowId++ };
      }),
      update: vi.fn(async () => ({})),
      onRemoved: { addListener: (cb: Cb<[number]>) => (hooks.windowRemoved = cb) },
    },
    tabs: { onRemoved: { addListener: (cb: Cb<[number]>) => (hooks.tabRemoved = cb) } },
    storage: { onChanged: { addListener: () => {} } },
  };
  __setKV(memKV());
  await import('../src/background/index');
});

beforeEach(async () => {
  const { __resetWebConnect } = await import('../src/background/webconnect');
  __resetWebConnect();
  __setKV(memKV());
  windowsCreated.length = 0;
  nextWindowId = 100;
  status.address = ADDRESS;
});

describe('connect through the approval window', () => {
  it('queues requestAccess, opens the window, and answers with the address once approved', async () => {
    const p = port();
    p.msg!({ id: 'r1', method: 'requestAccess', params: {} });
    await flush();
    expect(windowsCreated).toEqual([
      expect.objectContaining({ url: `${BASE}index.html?approve=1`, type: 'popup' }),
    ]);
    expect(p.posted).toEqual([]);

    const next = await page({ type: 'WC_NEXT' });
    expect(next).toMatchObject({
      ok: true,
      data: {
        kind: 'connect',
        origin: SITE,
        method: 'requestAccess',
        pending: 1,
        address: ADDRESS,
        network: 'TESTNET',
      },
    });
    const entryId = (next.data as { entryId: string }).entryId;

    expect(await page({ type: 'WC_DECIDE', entryId, approve: true })).toEqual({
      ok: true,
      data: { remaining: 0 },
    });
    await flush();
    expect(p.posted).toEqual([{ id: 'r1', ok: true, result: { address: ADDRESS } }]);
    expect(await listGrants()).toEqual([
      expect.objectContaining({ origin: SITE, address: ADDRESS, network: 'TESTNET' }),
    ]);

    // Now connected: getAddress answers without a prompt.
    p.msg!({ id: 'r2', method: 'getAddress', params: {} });
    await flush();
    expect(p.posted.at(-1)).toEqual({ id: 'r2', ok: true, result: { address: ADDRESS } });
    expect(windowsCreated).toHaveLength(1);
  });

  it('a rejection answers user_rejected and stores nothing', async () => {
    const p = port();
    p.msg!({ id: 'r1', method: 'requestAccess' });
    await flush();
    const { data } = await page({ type: 'WC_NEXT' });
    await page({
      type: 'WC_DECIDE',
      entryId: (data as { entryId: string }).entryId,
      approve: false,
    });
    await flush();
    expect(p.posted).toEqual([
      {
        id: 'r1',
        ok: false,
        error: { code: 'user_rejected', message: 'User rejected the request' },
      },
    ]);
    expect(await listGrants()).toEqual([]);
  });

  it('closing the window rejects the request on screen and reopens for the next', async () => {
    const p = port();
    p.msg!({ id: 'r1', method: 'requestAccess' });
    p.msg!({ id: 'r2', method: 'requestAccess' });
    await flush();
    await page({ type: 'WC_NEXT' }); // r1 is on screen
    hooks.windowRemoved!(100);
    await flush();
    expect(p.posted).toEqual([
      {
        id: 'r1',
        ok: false,
        error: { code: 'user_rejected', message: 'User rejected the request' },
      },
    ]);
    expect(windowsCreated).toHaveLength(2);
    expect((await page({ type: 'WC_NEXT' })).data).toMatchObject({ pending: 1 });
  });

  it('a request that arrives after the window found the queue empty keeps its place', async () => {
    const p = port();
    p.msg!({ id: 'r0', method: 'requestAccess' });
    await flush();
    const first = await page({ type: 'WC_NEXT' });
    await page({
      type: 'WC_DECIDE',
      entryId: (first.data as { entryId: string }).entryId,
      approve: false,
    });
    // The window asks again, finds nothing, and closes itself…
    expect((await page({ type: 'WC_NEXT' })).data).toBeNull();
    // …and a new request lands before the close is reported.
    p.msg!({ id: 'r1', method: 'requestAccess' });
    await flush();
    hooks.windowRemoved!(100);
    await flush();
    expect(p.posted).toEqual([
      {
        id: 'r0',
        ok: false,
        error: { code: 'user_rejected', message: 'User rejected the request' },
      },
    ]);
    expect(windowsCreated).toHaveLength(2);
    expect((await page({ type: 'WC_NEXT' })).data).toMatchObject({ pending: 1 });
  });

  it('closing the window from the Unlock screen (nothing fetched yet) rejects the request', async () => {
    const p = port();
    p.msg!({ id: 'r1', method: 'requestAccess' });
    await flush();
    hooks.windowRemoved!(100); // locked: the window showed Unlock and never asked WC_NEXT
    await flush();
    expect(p.posted).toEqual([
      {
        id: 'r1',
        ok: false,
        error: { code: 'user_rejected', message: 'User rejected the request' },
      },
    ]);
    expect(windowsCreated).toHaveLength(1);
  });

  it('Reset Wallet tells only the sites that were connected', async () => {
    const connected = port(SITE, 1);
    const stranger = port('https://other.example', 2);
    connected.msg!({ id: 'r1', method: 'requestAccess' });
    await flush();
    const { data } = await page({ type: 'WC_NEXT' });
    await page({
      type: 'WC_DECIDE',
      entryId: (data as { entryId: string }).entryId,
      approve: true,
    });
    await flush();
    await page({ type: 'RESET_WALLET' });
    await flush();
    expect(connected.posted.at(-1)).toEqual({ event: 'change', data: { reason: 'account' } });
    expect(stranger.posted).toEqual([]);
  });

  it('a fourth waiting request from one site is answered busy', async () => {
    const p = port();
    for (const id of ['a', 'b', 'c', 'd']) p.msg!({ id, method: 'requestAccess' });
    await flush();
    expect(p.posted).toEqual([
      {
        id: 'd',
        ok: false,
        error: { code: 'busy', message: 'Too many pending requests from this site' },
      },
    ]);
  });

  it('closing the tab or navigating away drops its requests', async () => {
    const p1 = port(SITE, 1);
    const p2 = port('https://other.example', 2);
    p1.msg!({ id: 'r1', method: 'requestAccess' });
    p2.msg!({ id: 'r2', method: 'requestAccess' });
    await flush();
    hooks.tabRemoved!(1);
    expect((await page({ type: 'WC_NEXT' })).data).toMatchObject({
      origin: 'https://other.example',
      pending: 1,
    });
    p2.disc!();
    expect((await page({ type: 'WC_NEXT' })).data).toBeNull();
  });

  it('revoking a site tells its open tabs and it must ask again', async () => {
    const p = port();
    p.msg!({ id: 'r1', method: 'requestAccess' });
    await flush();
    const { data } = await page({ type: 'WC_NEXT' });
    await page({
      type: 'WC_DECIDE',
      entryId: (data as { entryId: string }).entryId,
      approve: true,
    });
    await flush();
    expect((await page({ type: 'WC_GRANTS' })).data).toHaveLength(1);
    expect(await page({ type: 'WC_REVOKE', origin: SITE })).toEqual({
      ok: true,
      data: { ok: true },
    });
    expect(p.posted.at(-1)).toEqual({ event: 'change', data: { reason: 'revoke' } });
    p.msg!({ id: 'r2', method: 'getAddress' });
    await flush();
    expect(p.posted.at(-1)).toMatchObject({ id: 'r2', ok: false, error: { code: 'not_allowed' } });
  });

  it('a decision for a request that already went away fails cleanly', async () => {
    expect(await page({ type: 'WC_DECIDE', entryId: 'nope', approve: true })).toMatchObject({
      ok: false,
    });
  });

  it('WC_* messages from a content script are refused like any other', async () => {
    const res = await new Promise((resolve) =>
      hooks.onMessage!(
        { type: 'WC_GRANTS' },
        { id: EXT_ID, url: `${SITE}/`, tab: { id: 1 }, frameId: 0 },
        resolve,
      ),
    );
    expect(res).toEqual({ ok: false, error: 'Not allowed', code: 'VALIDATION' });
  });
});

describe('signTransaction through the approval window (#252)', () => {
  const user = Keypair.random();
  const payment = () =>
    new TransactionBuilder(new Account(user.publicKey(), '1'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({ destination: ADDRESS, asset: Asset.native(), amount: '1' }))
      .setTimeout(0)
      .build();

  async function queued(xdr: string) {
    status.address = user.publicKey();
    await addGrant(SITE, user.publicKey(), 'TESTNET');
    const p = port();
    p.msg!({
      id: 's1',
      method: 'signTransaction',
      params: { xdr, networkPassphrase: Networks.TESTNET },
    });
    await flush();
    const next = await page({ type: 'WC_NEXT' });
    expect(next.data).toMatchObject({ kind: 'sign', method: 'signTransaction', params: { xdr } });
    return { p, entryId: (next.data as { entryId: string }).entryId };
  }

  it('hands the site the envelope the window signed, after checking it', async () => {
    const tx = payment();
    const { p, entryId } = await queued(tx.toXDR());
    tx.sign(user);
    expect(
      await page({ type: 'WC_DECIDE', entryId, approve: true, result: { signedXdr: tx.toXDR() } }),
    ).toEqual({
      ok: true,
      data: { remaining: 0 },
    });
    await flush();
    expect(p.posted).toEqual([
      { id: 's1', ok: true, result: { signedTxXdr: tx.toXDR(), signerAddress: user.publicKey() } },
    ]);
  });

  it('refuses a signature by another key, and a changed transaction', async () => {
    const tx = payment();
    const { p, entryId } = await queued(tx.toXDR());
    tx.sign(Keypair.random());
    expect(
      await page({ type: 'WC_DECIDE', entryId, approve: true, result: { signedXdr: tx.toXDR() } }),
    ).toMatchObject({ ok: false });
    await flush();
    expect(p.posted).toEqual([
      {
        id: 's1',
        ok: false,
        error: { code: 'internal', message: 'Something went wrong in Lantern' },
      },
    ]);

    const other = payment();
    const second = await queued(other.toXDR());
    const changed = new TransactionBuilder(new Account(user.publicKey(), '5'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({ destination: ADDRESS, asset: Asset.native(), amount: '999' }),
      )
      .setTimeout(0)
      .build();
    changed.sign(user);
    expect(
      await page({
        type: 'WC_DECIDE',
        entryId: second.entryId,
        approve: true,
        result: { signedXdr: changed.toXDR() },
      }),
    ).toMatchObject({
      ok: false,
      error: 'The signed transaction does not match the one reviewed.',
    });
  });

  it('refuses when the site was disconnected while the user was reading', async () => {
    const tx = payment();
    const { p, entryId } = await queued(tx.toXDR());
    await revokeAll();
    tx.sign(user);
    expect(
      await page({ type: 'WC_DECIDE', entryId, approve: true, result: { signedXdr: tx.toXDR() } }),
    ).toMatchObject({ ok: false });
    await flush();
    expect(p.posted).toEqual([
      {
        id: 's1',
        ok: false,
        error: { code: 'not_allowed', message: 'This site is not connected to Lantern' },
      },
    ]);
  });

  it('a rejection answers user_rejected', async () => {
    const { p, entryId } = await queued(payment().toXDR());
    await page({ type: 'WC_DECIDE', entryId, approve: false });
    await flush();
    expect(p.posted).toEqual([
      {
        id: 's1',
        ok: false,
        error: { code: 'user_rejected', message: 'User rejected the request' },
      },
    ]);
  });
});
