import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Account,
  Asset,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { __setKV, type KV } from '@shared/kv';
import {
  addGrant,
  findGrant,
  listGrants,
  revokeAll,
  revokeOrigin,
  touchGrant,
  GRANTS_KEY,
} from '@core/webconnect/grants';
import {
  ApprovalQueue,
  MAX_PENDING_PER_ORIGIN,
  type PendingApproval,
} from '@core/webconnect/queue';
import {
  answerWebConnect,
  routeWebConnect,
  TESTNET_ONLY_MESSAGE,
  type WebConnectDeps,
} from '@core/webconnect/router';
import type { WebConnectRequest } from '@core/webconnect/protocol';

const A = 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK';
const B = 'GCDF6TFSMWXBK7DGO4AQ4WYBSTS5OHM6S4OJRG7MZ7V34AT2LYSOJNWZ';
const SITE = 'https://beta.app.paiflow.xyz';
const OTHER = 'https://evil.example';

function memKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

let kv: ReturnType<typeof memKV>;
beforeEach(() => {
  kv = memKV();
  __setKV(kv);
});

describe('grants (#250)', () => {
  it('match on origin, account AND network', async () => {
    await addGrant(SITE, A, 'TESTNET', 1);
    expect(await findGrant(SITE, A, 'TESTNET')).toMatchObject({
      origin: SITE,
      address: A,
      network: 'TESTNET',
    });
    expect(await findGrant(SITE, A, 'PUBLIC')).toBeNull();
    expect(await findGrant(SITE, B, 'TESTNET')).toBeNull();
    expect(await findGrant(OTHER, A, 'TESTNET')).toBeNull();
  });

  it('re-granting keeps grantedAt and refreshes lastUsedAt; touch updates it', async () => {
    await addGrant(SITE, A, 'TESTNET', 1);
    await addGrant(SITE, A, 'TESTNET', 5);
    expect(await listGrants()).toEqual([
      { origin: SITE, address: A, network: 'TESTNET', grantedAt: 1, lastUsedAt: 5 },
    ]);
    await touchGrant(SITE, A, 'TESTNET', 9);
    expect((await findGrant(SITE, A, 'TESTNET'))?.lastUsedAt).toBe(9);
    await touchGrant(OTHER, A, 'TESTNET', 9); // no grant: no-op
    expect(await listGrants()).toHaveLength(1);
  });

  it('lists newest use first, and revokes one origin or all', async () => {
    await addGrant(SITE, A, 'TESTNET', 1);
    await addGrant(OTHER, A, 'TESTNET', 2);
    await addGrant(SITE, B, 'TESTNET', 3);
    expect((await listGrants()).map((g) => [g.origin, g.address])).toEqual([
      [SITE, B],
      [OTHER, A],
      [SITE, A],
    ]);
    await revokeOrigin(SITE);
    expect((await listGrants()).map((g) => g.origin)).toEqual([OTHER]);
    await revokeAll();
    expect(await listGrants()).toEqual([]);
    expect(kv.data.has(GRANTS_KEY)).toBe(false);
  });

  it('reads a corrupt store as empty', async () => {
    kv.data.set(GRANTS_KEY, '{nope');
    expect(await listGrants()).toEqual([]);
    kv.data.set(
      GRANTS_KEY,
      JSON.stringify([
        { origin: SITE },
        { origin: SITE, address: A, network: 'TESTNET', grantedAt: 1, lastUsedAt: 1 },
      ]),
    );
    expect(await listGrants()).toHaveLength(1);
  });
});

describe('ApprovalQueue (#249)', () => {
  const entry = (n: number, origin = SITE, portId = 1, tabId = 10): PendingApproval => ({
    entryId: `e${n}`,
    kind: 'connect',
    origin,
    portId,
    tabId,
    request: { id: `r${n}`, method: 'requestAccess', params: {} },
    createdAt: n,
  });

  it('shows the oldest first, one at a time', () => {
    const q = new ApprovalQueue();
    q.add(entry(1));
    q.add(entry(2, OTHER));
    expect(q.head()?.entryId).toBe('e1');
    expect(q.take('e1')?.entryId).toBe('e1');
    expect(q.head()?.entryId).toBe('e2');
    expect(q.take('e1')).toBeNull();
  });

  it(`caps each origin at ${MAX_PENDING_PER_ORIGIN} waiting requests`, () => {
    const q = new ApprovalQueue();
    for (let i = 0; i < MAX_PENDING_PER_ORIGIN; i++) expect(q.add(entry(i))).toBe(true);
    expect(q.add(entry(9))).toBe(false);
    expect(q.add(entry(10, OTHER))).toBe(true);
  });

  it('drops a closed tab’s or a gone port’s requests', () => {
    const q = new ApprovalQueue();
    q.add(entry(1, SITE, 1, 10));
    q.add(entry(2, SITE, 2, 11));
    q.add(entry(3, OTHER, 3, 10));
    expect(q.dropTab(10).map((e) => e.entryId)).toEqual(['e1', 'e3']);
    expect(q.dropPort(2).map((e) => e.entryId)).toEqual(['e2']);
    expect(q.size).toBe(0);
  });
});

describe('routeWebConnect (#251)', () => {
  const testnet = {
    id: 'TESTNET' as const,
    passphrase: Networks.TESTNET,
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  };
  const req = (method: WebConnectRequest['method'], params = {}): WebConnectRequest => ({
    id: 'q1',
    method,
    params,
  });
  const ctx = { origin: SITE };

  function deps(
    over: Partial<WebConnectDeps> = {},
  ): WebConnectDeps & { approve: ReturnType<typeof vi.fn> } {
    return {
      address: async () => A,
      network: async () => testnet,
      findGrant,
      touchGrant,
      approve: vi.fn(async (_k, r) => ({ id: r.id, ok: true as const, result: { address: A } })),
      ...over,
    } as WebConnectDeps & { approve: ReturnType<typeof vi.fn> };
  }

  it('isConnected answers anyone, with the API version', async () => {
    expect(await routeWebConnect(req('isConnected'), { origin: OTHER }, deps())).toEqual({
      id: 'q1',
      ok: true,
      result: { isConnected: true, apiVersion: 1 },
    });
  });

  it('requestAccess asks the user when the site has no grant', async () => {
    const d = deps();
    expect(await routeWebConnect(req('requestAccess'), ctx, d)).toEqual({
      id: 'q1',
      ok: true,
      result: { address: A },
    });
    expect(d.approve).toHaveBeenCalledWith('connect', req('requestAccess'), ctx);
  });

  it('requestAccess answers at once when the site is already connected for this account and network', async () => {
    await addGrant(SITE, A, 'TESTNET', 1);
    const d = deps();
    expect(await routeWebConnect(req('requestAccess'), ctx, d)).toEqual({
      id: 'q1',
      ok: true,
      result: { address: A },
    });
    expect(d.approve).not.toHaveBeenCalled();
  });

  it('a grant for another account does not carry over', async () => {
    await addGrant(SITE, B, 'TESTNET', 1);
    const d = deps();
    await routeWebConnect(req('requestAccess'), ctx, d);
    expect(d.approve).toHaveBeenCalled();
    expect(await routeWebConnect(req('getAddress'), ctx, d)).toMatchObject({
      ok: false,
      error: { code: 'not_allowed' },
    });
  });

  it('an unconnected site learns nothing: the same not_allowed with or without a wallet', async () => {
    for (const address of [A, null]) {
      const d = deps({ address: async () => address });
      for (const m of ['getAddress', 'getNetwork', 'getNetworkDetails'] as const) {
        expect(await routeWebConnect(req(m), ctx, d)).toEqual({
          id: 'q1',
          ok: false,
          error: { code: 'not_allowed', message: 'This site is not connected to Lantern' },
        });
      }
    }
  });

  it('a connected site reads the address and the resolved network', async () => {
    await addGrant(SITE, A, 'TESTNET', 1);
    const d = deps();
    expect(await routeWebConnect(req('getAddress'), ctx, d)).toMatchObject({
      ok: true,
      result: { address: A },
    });
    expect(await routeWebConnect(req('getNetwork'), ctx, d)).toMatchObject({
      ok: true,
      result: { network: 'TESTNET', networkPassphrase: Networks.TESTNET },
    });
    const custom = deps({
      network: async () => ({ ...testnet, horizonUrl: 'https://my-horizon.example' }),
    });
    expect(await routeWebConnect(req('getNetworkDetails'), ctx, custom)).toMatchObject({
      ok: true,
      result: {
        networkUrl: 'https://my-horizon.example',
        sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      },
    });
  });

  it('refuses everything but isConnected on mainnet (testnet-only first release)', async () => {
    await addGrant(SITE, A, 'PUBLIC', 1);
    const d = deps({
      network: async () => ({
        id: 'PUBLIC' as const,
        passphrase: Networks.PUBLIC,
        horizonUrl: 'https://horizon.stellar.org',
      }),
    });
    for (const m of ['requestAccess', 'getAddress', 'getNetwork'] as const) {
      expect(await routeWebConnect(req(m), ctx, d)).toMatchObject({
        ok: false,
        error: { code: 'not_allowed', message: TESTNET_ONLY_MESSAGE },
      });
    }
    expect(d.approve).not.toHaveBeenCalled();
  });

  it('signAuthEntry and signMessage stay unsupported (#253, #254)', async () => {
    for (const m of ['signAuthEntry', 'signMessage'] as const) {
      expect(await routeWebConnect(req(m), ctx, deps())).toMatchObject({
        ok: false,
        error: { code: 'unsupported' },
      });
    }
  });

  it('answers an invalid request with its id, drops one with no id, and maps a throw to internal', async () => {
    expect(await answerWebConnect({ id: 'a', method: 'nope' }, ctx, deps())).toMatchObject({
      id: 'a',
      error: { code: 'invalid_request' },
    });
    expect(await answerWebConnect({ method: 'isConnected' }, ctx, deps())).toBeNull();
    const broken = deps({ network: async () => Promise.reject(new Error('boom')) });
    expect(await answerWebConnect({ id: 'b', method: 'getAddress' }, ctx, broken)).toMatchObject({
      id: 'b',
      error: { code: 'internal' },
    });
  });
});

describe('Reset Wallet (#250)', () => {
  it('clears every connected site with the wallet', async () => {
    const { handle } = await import('@core/session/handler');
    await addGrant(SITE, A, 'TESTNET', 1);
    expect(await handle({ type: 'RESET_WALLET' })).toMatchObject({ ok: true });
    expect(await listGrants()).toEqual([]);
  });
});

describe('signTransaction (#252): checked before any window', () => {
  const user = Keypair.random();
  const testnet = {
    id: 'TESTNET' as const,
    passphrase: Networks.TESTNET,
    horizonUrl: 'https://horizon-testnet.stellar.org',
  };
  const ctx = { origin: SITE };
  const payment = (source = user.publicKey(), passphrase = Networks.TESTNET) =>
    new TransactionBuilder(new Account(source, '1'), { fee: '100', networkPassphrase: passphrase })
      .addOperation(Operation.payment({ destination: B, asset: Asset.native(), amount: '1' }))
      .setTimeout(0)
      .build();
  function deps() {
    return {
      address: async () => user.publicKey(),
      network: async () => testnet,
      findGrant,
      touchGrant,
      approve: vi.fn(async (_k: unknown, r: WebConnectRequest) => ({
        id: r.id,
        ok: true as const,
        result: 'queued',
      })),
    };
  }
  const sign = (params: Record<string, unknown>): WebConnectRequest => ({
    id: 's1',
    method: 'signTransaction',
    params,
  });

  beforeEach(async () => {
    await addGrant(SITE, user.publicKey(), 'TESTNET', 1);
  });

  it('queues a valid request, filling in the active network when the dApp leaves it out', async () => {
    const d = deps();
    const xdr = payment().toXDR();
    expect(await routeWebConnect(sign({ xdr }), ctx, d)).toMatchObject({ ok: true });
    expect(d.approve).toHaveBeenCalledWith(
      'sign',
      sign({ xdr, networkPassphrase: Networks.TESTNET }),
      ctx,
    );
  });

  it('needs a grant for this account', async () => {
    await revokeAll();
    const d = deps();
    expect(await routeWebConnect(sign({ xdr: payment().toXDR() }), ctx, d)).toMatchObject({
      error: { code: 'not_allowed' },
    });
    expect(d.approve).not.toHaveBeenCalled();
  });

  it('refuses another account, another network, bad XDR, a fee bump, and a tx this account doesn’t sign, with no window', async () => {
    const d = deps();
    const inner = payment();
    inner.sign(user);
    const bump = TransactionBuilder.buildFeeBumpTransaction(user, '200', inner, Networks.TESTNET);
    expect(bump).toBeInstanceOf(FeeBumpTransaction);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ xdr: payment().toXDR(), address: B }, 'account_mismatch'],
      [
        {
          xdr: payment(user.publicKey(), Networks.PUBLIC).toXDR(),
          networkPassphrase: Networks.PUBLIC,
        },
        'network_mismatch',
      ],
      [{ xdr: 'not-xdr', networkPassphrase: Networks.TESTNET }, 'invalid_request'],
      [{ networkPassphrase: Networks.TESTNET }, 'invalid_request'],
      [{ xdr: bump.toXDR(), networkPassphrase: Networks.TESTNET }, 'invalid_request'],
      [{ xdr: payment(B).toXDR(), networkPassphrase: Networks.TESTNET }, 'invalid_request'],
    ];
    for (const [params, code] of cases) {
      expect(await routeWebConnect(sign(params), ctx, d), code).toMatchObject({
        ok: false,
        error: { code },
      });
    }
    expect(d.approve).not.toHaveBeenCalled();
  });
});
