import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { readEnv } from '../src/env';
import { memoryStore } from '../src/telemetry/store';
import { purgeOnce, DAY_MS } from '../src/telemetry/retention';
import { EXPORT_PAGE } from '../src/routes/telemetry';

// Telemetry ingest (#85). Offline: the in-memory store; the Postgres
// implementation is exercised by test/pg-store.test.ts when DATABASE_URL is
// set (never in CI).

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const TOKEN = 'admin-test-token';
const UUID_A = '5f3d2f1e-9c2b-4a1d-8e7f-0123456789ab';
const UUID_B = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const ADDRESS = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const env = (over: Record<string, string> = {}) =>
  readEnv({
    ANTHROPIC_API_KEY: 'sk-test',
    ALLOWED_ORIGINS: ORIGIN,
    TELEMETRY_ADMIN_TOKEN: TOKEN,
    RATE_LIMIT_PER_MIN: '1000',
    TELEMETRY_DAILY_CAP: '100000',
    ...over,
  });
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const envelope = (
  installId = UUID_A,
  events: unknown[] = [{ name: 'wallet_created', props: { mode: 'create' }, ts: Date.now() }],
) => ({
  installId,
  platform: 'extension',
  appVersion: '0.1.0',
  network: 'testnet',
  events,
});
function harness(over: Record<string, string> = {}, nowDate?: () => Date) {
  const store = memoryStore();
  const lines: Array<Record<string, string | number>> = [];
  const app = createApp({
    env: env(over),
    store,
    log: (l) => lines.push(l),
    ...(nowDate ? { nowDate } : {}),
  });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/v1/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const del = (body: unknown) =>
    app.request('/v1/telemetry/install', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(body),
    });
  const exp = (qs = '', token: string | null = TOKEN) =>
    app.request(`/v1/telemetry/export${qs}`, {
      headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  return { app, store, lines, post, del, exp };
}

describe('POST /v1/telemetry', () => {
  it('inserts one row per event from a valid envelope and returns 204', async () => {
    const h = harness();
    const T1 = Date.now() + 1000;
    const res = await h.post(
      envelope(UUID_A, [
        { name: 'wallet_created', props: { mode: 'create' }, ts: Date.now() },
        { name: 'tx_scanned', props: { risk: 'low', action: 'allow' }, ts: T1 },
      ]),
    );
    expect(res.status).toBe(204);
    expect(h.store.rows).toHaveLength(2);
    expect(h.store.rows[1]).toMatchObject({
      installId: UUID_A,
      platform: 'extension',
      appVersion: '0.1.0',
      network: 'testnet',
      event: 'tx_scanned',
      props: { risk: 'low', action: 'allow' },
    });
    expect(h.store.rows[1]?.ts.getTime()).toBe(T1);
  });

  it('rejects with 400 and inserts nothing: address, amount, raw text, unknown event, extra field, bad id', async () => {
    const h = harness();
    const bad = [
      envelope(UUID_A, [
        { name: 'tx_signed', props: { kind: 'sign_only', ok: true, to: ADDRESS }, ts: 1 },
      ]),
      envelope(UUID_A, [{ name: 'swap_executed', props: { engine: 'sdex', amount: '25' }, ts: 1 }]),
      envelope(UUID_A, [
        { name: 'message_scanned', props: { risk: 'high', text: 'my seed' }, ts: 1 },
      ]),
      envelope(UUID_A, [{ name: 'custom', props: {}, ts: 1 }]),
      { ...envelope(), note: 'hi' },
      envelope('user-1'),
      envelope(ADDRESS),
      { ...envelope(), appVersion: ADDRESS },
      '{not json',
    ];
    for (const b of bad) {
      const res = await h.post(b);
      expect(res.status, JSON.stringify(b).slice(0, 60)).toBe(400);
    }
    expect(h.store.rows).toHaveLength(0);
  });

  it('rejects an out-of-range timestamp with 400, inserting nothing — never a 503', async () => {
    const h = harness({}, () => new Date(Date.UTC(2026, 8, 16)));
    for (const ts of [1e300, -1e300, Date.UTC(2026, 8, 16) + 10 * 60_000, Date.UTC(2025, 0, 1)]) {
      const res = await h.post(envelope(UUID_A, [{ name: 'session_start', props: {}, ts }]));
      expect(res.status, String(ts)).toBe(400);
      expect(await json(res), String(ts)).toMatchObject({
        error: 'bad_input',
        field: 'events.ts: out of range',
      });
    }
    expect(h.store.rows).toHaveLength(0);
    // Within the window (89 days old, 1 minute ahead) is fine.
    const ok = await h.post(
      envelope(UUID_A, [
        { name: 'session_start', props: {}, ts: Date.UTC(2026, 8, 16) - 89 * 86_400_000 },
        { name: 'session_start', props: {}, ts: Date.UTC(2026, 8, 16) + 60_000 },
      ]),
    );
    expect(ok.status).toBe(204);
    expect(h.store.rows).toHaveLength(2);
  });

  it('answers 503 when no store is configured, and on a store failure', async () => {
    const noStore = createApp({ env: env(), store: null, log: () => {} });
    const res = await noStore.request('/v1/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(envelope()),
    });
    expect(res.status).toBe(503);
    const broken = memoryStore();
    broken.insert = async () => {
      throw new Error('db down');
    };
    const app = createApp({ env: env(), store: broken, log: () => {} });
    const res2 = await app.request('/v1/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(envelope()),
    });
    expect(res2.status).toBe(503);
  });

  it('is origin-gated and has its own daily cap, separate from the explainer', async () => {
    const h = harness({ TELEMETRY_DAILY_CAP: '2', DAILY_CAP: '1000' });
    expect((await h.post(envelope(), { Origin: 'https://evil.invalid' })).status).toBe(403);
    expect((await h.post(envelope())).status).toBe(204);
    expect((await h.post(envelope())).status).toBe(204);
    const capped = await h.post(envelope());
    expect(capped.status).toBe(429);
    expect(await json(capped)).toEqual({ error: 'daily_cap' });
  });

  it('logs status, latency and a row count — never an event body', async () => {
    const h = harness();
    await h.post(envelope());
    expect(h.lines[0]).toMatchObject({ route: 'telemetry', status: 204, code: 'ok', rows: 1 });
    const text = JSON.stringify(h.lines);
    expect(text).not.toContain(UUID_A);
    expect(text).not.toContain('wallet_created');
  });
});

describe('DELETE /v1/telemetry/install', () => {
  it('removes exactly that install’s rows and is 204 whether or not any existed', async () => {
    const h = harness();
    await h.post(envelope(UUID_A));
    await h.post(envelope(UUID_B));
    await h.post(envelope(UUID_A));
    expect(h.store.rows).toHaveLength(3);
    expect((await h.del({ installId: UUID_A })).status).toBe(204);
    expect(h.store.rows.map((r) => r.installId)).toEqual([UUID_B]);
    expect((await h.del({ installId: UUID_A })).status).toBe(204);
    expect((await h.del({ installId: 'nope' })).status).toBe(400);
    expect((await h.del({ installId: ADDRESS })).status).toBe(400);
  });
});

describe('GET /v1/telemetry/export', () => {
  it('requires the admin token', async () => {
    const h = harness();
    expect((await h.exp('', null)).status).toBe(401);
    expect((await h.exp('', 'wrong')).status).toBe(401);
    expect((await h.exp('', TOKEN.slice(0, -1))).status).toBe(401); // length mismatch
    expect((await h.exp('', TOKEN + 'x')).status).toBe(401);
    expect((await h.exp('', TOKEN)).status).toBe(200);
    const noToken = createApp({
      env: env({ TELEMETRY_ADMIN_TOKEN: '' }),
      store: memoryStore(),
      log: () => {},
    });
    const res = await noToken.request('/v1/telemetry/export', {
      headers: { Origin: ORIGIN, Authorization: 'Bearer ' },
    });
    expect(res.status).toBe(401);
  });

  it('returns raw rows, respects since/until, and pages by id', async () => {
    let t = Date.UTC(2026, 8, 1);
    const h = harness({}, () => new Date(t));
    for (let day = 0; day < 3; day += 1) {
      t = Date.UTC(2026, 8, 1 + day);
      await h.post(envelope(UUID_A, [{ name: 'session_start', props: {}, ts: t }]));
    }
    const all = await json(await h.exp());
    expect((all.rows as unknown[]).length).toBe(3);
    expect(all.next).toBeNull();
    const mid = await json(await h.exp('?since=2026-09-02T00:00:00Z&until=2026-09-03T00:00:00Z'));
    expect((mid.rows as Array<{ receivedAt: string }>).map((r) => r.receivedAt)).toEqual([
      '2026-09-02T00:00:00.000Z',
    ]);
    const after = await json(await h.exp('?after=1'));
    expect((after.rows as Array<{ id: number }>).map((r) => r.id)).toEqual([2, 3]);
    expect((await h.exp('?since=not-a-date')).status).toBe(400);
    // The row shape is the columns and nothing else.
    expect(Object.keys((all.rows as object[])[0]!).sort()).toEqual([
      'appVersion',
      'event',
      'id',
      'installId',
      'network',
      'platform',
      'props',
      'receivedAt',
      'ts',
    ]);
  });

  it('signals a next page at the page size', async () => {
    const h = harness();
    const events = Array.from({ length: EXPORT_PAGE + 1 }, (_, i) => ({
      name: 'session_start',
      props: {},
      ts: Date.now() + i,
    }));
    // Envelopes are capped at 500 events; send three.
    await h.post(envelope(UUID_A, events.slice(0, 500)));
    await h.post(envelope(UUID_A, events.slice(500, 1000)));
    await h.post(envelope(UUID_A, events.slice(1000)));
    const first = await json(await h.exp());
    expect((first.rows as unknown[]).length).toBe(EXPORT_PAGE);
    expect(first.next).toBe(EXPORT_PAGE);
    const second = await json(await h.exp(`?after=${first.next}`));
    expect((second.rows as unknown[]).length).toBe(1);
    expect(second.next).toBeNull();
  });
});

describe('retention', () => {
  it('purges rows older than the window and nothing newer', async () => {
    const store = memoryStore();
    const now = new Date(Date.UTC(2026, 8, 16));
    await store.insert(
      [
        {
          installId: UUID_A,
          platform: 'extension',
          appVersion: '0.1.0',
          network: 'testnet',
          event: 'session_start',
          props: {},
          ts: now,
        },
      ],
      new Date(now.getTime() - 91 * DAY_MS),
    );
    await store.insert(
      [
        {
          installId: UUID_A,
          platform: 'extension',
          appVersion: '0.1.0',
          network: 'testnet',
          event: 'session_start',
          props: {},
          ts: now,
        },
      ],
      new Date(now.getTime() - 89 * DAY_MS),
    );
    await store.insert(
      [
        {
          installId: UUID_A,
          platform: 'extension',
          appVersion: '0.1.0',
          network: 'testnet',
          event: 'session_start',
          props: {},
          ts: now,
        },
      ],
      now,
    );
    const lines: Array<Record<string, string | number>> = [];
    const purged = await purgeOnce({
      store,
      retentionDays: 90,
      now: () => now,
      log: (l) => lines.push(l),
    });
    expect(purged).toBe(1);
    expect(store.rows).toHaveLength(2);
    expect(lines[0]).toMatchObject({ route: 'retention', code: 'ok', rows: 1 });
    // A failing store is logged, not thrown.
    store.purgeBefore = async () => {
      throw new Error('db down');
    };
    expect(
      await purgeOnce({ store, retentionDays: 90, now: () => now, log: (l) => lines.push(l) }),
    ).toBe(0);
    expect(lines[1]).toMatchObject({ route: 'retention', code: 'store_error' });
  });
});

describe('healthz', () => {
  it('reports the store', async () => {
    const withStore = createApp({ env: env(), store: memoryStore(), log: () => {} });
    expect(await json(await withStore.request('/healthz'))).toMatchObject({ ok: true, db: true });
    const without = createApp({ env: env(), store: null, log: () => {} });
    expect(await json(await without.request('/healthz'))).toMatchObject({ ok: true, db: null });
  });
});
