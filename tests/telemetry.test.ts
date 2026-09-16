import { describe, it, expect, beforeEach, expectTypeOf } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { getSettings, setSettings } from '@shared/storage';
import {
  createSink,
  validateEnvelope,
  validateEvent,
  getInstallId,
  peekInstallId,
  clearInstallId,
  INSTALL_ID_KEY,
  startTelemetry,
  emit,
  grantConsent,
  revokeConsentAndDelete,
  __resetTelemetry,
  type TelemetryEvent,
  type Envelope,
} from '@core/telemetry';

// Telemetry core (#81). Offline: fetch is a stub, the clock is a function,
// the KV is in memory.

function memKV(): KV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
}
const ADDRESS = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
// Key-shaped for the validator's regex, built at runtime so no scanner flags it;
// cannot be a real seed.
const SECRET = 'S' + 'B'.repeat(55);
const UUID = '5f3d2f1e-9c2b-4a1d-8e7f-0123456789ab';

function sinkWith(over: Partial<Parameters<typeof createSink>[0]> = {}) {
  const posts: Array<{ url: string; method: string; body: Envelope | { installId: string } }> = [];
  let consent = true;
  let t = 1_000_000;
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const sink = createSink({
    ingestUrl: 'https://ingest.lantern.invalid/v1/telemetry',
    platform: 'extension',
    appVersion: '0.1.0',
    network: () => 'testnet',
    installId: async () => UUID,
    hasConsent: () => consent,
    fetchImpl: async (url, init) => {
      posts.push({
        url: String(url),
        method: init?.method ?? 'GET',
        body: JSON.parse(String(init?.body)),
      });
      return new Response('', { status: 204 });
    },
    now: () => t,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
    ...over,
  });
  return {
    sink,
    posts,
    timers,
    setConsent: (c: boolean) => void (consent = c),
    tick: (ms: number) => void (t += ms),
  };
}

// ── Type level: PII has no slot ──────────────────────────────────────────────
describe('events: type level', () => {
  it('every prop is enum-valued; free text, addresses and amounts cannot be expressed', () => {
    expectTypeOf<TelemetryEvent['props']>().not.toMatchTypeOf<{ text: string }>();
    expectTypeOf<Extract<TelemetryEvent, { name: 'message_scanned' }>['props']>().toEqualTypeOf<{
      risk: 'low' | 'medium' | 'high';
    }>();
    const a: TelemetryEvent = {
      name: 'tx_signed',
      // @ts-expect-error — no event carries an address
      props: { kind: 'sign_only', ok: true, to: ADDRESS },
    };
    const b: TelemetryEvent = {
      name: 'swap_executed',
      // @ts-expect-error — no event carries an amount
      props: { engine: 'sdex', amount: '25' },
    };
    const c: TelemetryEvent = {
      name: 'message_scanned',
      // @ts-expect-error — the scan flow only carries the derived risk, never the text
      props: { risk: 'high', text: 'send me seed' },
    };
    // @ts-expect-error — unknown event names do not exist
    const d: TelemetryEvent = { name: 'custom', props: {} };
    void [a, b, c, d];
  });
});

// ── Runtime: the envelope validator ──────────────────────────────────────────
describe('validate', () => {
  const ok = (over: Partial<Envelope> = {}): Envelope => ({
    installId: UUID,
    platform: 'extension',
    appVersion: '0.1.0',
    network: 'testnet',
    events: [{ name: 'wallet_created', props: { mode: 'create' }, ts: 1 }],
    ...over,
  });

  it('accepts a well-formed envelope', () => {
    expect(validateEnvelope(ok())).toBe(true);
  });

  it('rejects an address, a secret, an amount, raw text, unknown props and unknown events', () => {
    const bad = (props: unknown, name = 'message_scanned') => validateEvent({ name, props, ts: 1 });
    expect(bad({ risk: 'high', text: 'ignore previous' })).toBe(false);
    expect(bad({ risk: ADDRESS })).toBe(false);
    expect(bad({ risk: 'high', to: ADDRESS })).toBe(false);
    expect(bad({ risk: 'high', amount: '25.0000000' })).toBe(false);
    expect(bad({ risk: 'critical' })).toBe(false);
    expect(bad({})).toBe(false); // partial event
    expect(bad({}, 'custom')).toBe(false);
    expect(
      validateEvent({ name: 'tx_signed', props: { kind: 'sign_only', ok: 'yes' }, ts: 1 }),
    ).toBe(false);
    expect(validateEvent({ name: 'app_first_open', props: {}, ts: 1, extra: 1 })).toBe(false);
  });

  it('returns false, not a throw, for prototype-named props', () => {
    expect(
      validateEvent({ name: 'message_scanned', props: { constructor: 'x', risk: 'low' }, ts: 1 }),
    ).toBe(false);
    const parsed = JSON.parse(
      '{"name":"message_scanned","props":{"__proto__":"x","risk":"low"},"ts":1}',
    );
    expect(validateEvent(parsed)).toBe(false);
    expect(
      validateEvent({ name: 'app_first_open', props: JSON.parse('{"constructor":"x"}'), ts: 1 }),
    ).toBe(false);
  });

  it('rejects an envelope that smuggles a key anywhere, or a non-UUID install id', () => {
    expect(validateEnvelope(ok({ installId: ADDRESS }))).toBe(false);
    expect(validateEnvelope(ok({ installId: 'user-1' }))).toBe(false);
    expect(validateEnvelope(ok({ appVersion: SECRET }))).toBe(false);
    expect(validateEnvelope({ ...ok(), note: 'hello' })).toBe(false);
    expect(validateEnvelope(ok({ platform: 'ios' as never }))).toBe(false);
    expect(validateEnvelope(ok({ events: Array(501).fill(ok().events[0]) }))).toBe(false);
  });
});

// ── The sink ─────────────────────────────────────────────────────────────────
describe('sink', () => {
  it('is a hard no-op without consent: buffers nothing, sends nothing', async () => {
    const { sink, posts, setConsent, timers } = sinkWith();
    setConsent(false);
    for (let i = 0; i < 50; i += 1) sink.emit({ name: 'session_start', props: {} });
    await sink.flush();
    expect(sink.size()).toBe(0);
    expect(posts).toHaveLength(0);
    expect(timers).toHaveLength(0);
  });

  it('batches: flushes at the size threshold with the envelope shape, and on the timer', async () => {
    const { sink, posts, timers } = sinkWith({ flushAt: 3, flushAfterMs: 30_000 });
    sink.emit({ name: 'app_first_open', props: {} });
    sink.emit({ name: 'wallet_created', props: { mode: 'create' } });
    expect(posts).toHaveLength(0);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(30_000);
    sink.emit({ name: 'tx_scanned', props: { risk: 'low', action: 'allow' } });
    await sink.flush();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.method).toBe('POST');
    expect(posts[0]?.body).toMatchObject({
      installId: UUID,
      platform: 'extension',
      appVersion: '0.1.0',
      network: 'testnet',
    });
    expect((posts[0]?.body as Envelope).events.map((e) => e.name)).toEqual([
      'app_first_open',
      'wallet_created',
      'tx_scanned',
    ]);
    expect(sink.size()).toBe(0);
    // Timer path.
    sink.emit({ name: 'session_start', props: {} });
    expect(timers).toHaveLength(2);
    timers[1]!.fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(posts).toHaveLength(2);
  });

  it('is bounded: an offline session keeps only the newest maxBuffer events', async () => {
    const { sink, posts } = sinkWith({
      flushAt: 1_000,
      maxBuffer: 5,
      fetchImpl: async () => {
        throw new TypeError('offline');
      },
    });
    for (let i = 0; i < 20; i += 1) sink.emit({ name: 'session_start', props: {} });
    expect(sink.size()).toBe(5);
    await sink.flush();
    expect(sink.size()).toBe(0);
    expect(posts).toHaveLength(0);
  });

  it('swallows every failure — analytics never breaks the wallet', async () => {
    const throws = sinkWith({
      flushAt: 1,
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    throws.sink.emit({ name: 'session_start', props: {} });
    await expect(throws.sink.flush()).resolves.toBeUndefined();
    const five = sinkWith({ flushAt: 1, fetchImpl: async () => new Response('', { status: 500 }) });
    five.sink.emit({ name: 'session_start', props: {} });
    await expect(five.sink.flush()).resolves.toBeUndefined();
    const noId = sinkWith({
      flushAt: 1,
      installId: async () => {
        throw new Error('kv down');
      },
    });
    noId.sink.emit({ name: 'session_start', props: {} });
    await expect(noId.sink.flush()).resolves.toBeUndefined();
    expect(noId.posts).toHaveLength(0);
  });

  it('drops an event that fails the runtime guard even if it slipped past the types', async () => {
    const { sink, posts } = sinkWith({ flushAt: 1 });
    sink.emit({
      name: 'message_scanned',
      props: { risk: 'high', text: 'my seed is …' },
    } as unknown as TelemetryEvent);
    sink.emit({
      name: 'tx_signed',
      props: { kind: 'sign_only', ok: true, to: ADDRESS },
    } as unknown as TelemetryEvent);
    await sink.flush();
    expect(posts).toHaveLength(0);
    expect(sink.size()).toBe(0);
  });

  it('the wire never carries a key or free text', async () => {
    const { sink, posts } = sinkWith({ flushAt: 1 });
    sink.emit({ name: 'tx_signed', props: { kind: 'sign_and_submit', ok: true } });
    await sink.flush();
    const wire = JSON.stringify(posts[0]?.body);
    expect(wire).not.toMatch(/[GSCM][A-Z2-7]{55}/);
    expect(wire).not.toMatch(/seed|memo|amount/i);
  });

  it('requestDeletion posts the install id to the delete endpoint and clears the buffer', async () => {
    const { sink, posts } = sinkWith({
      flushAt: 100,
      deleteUrl: 'https://ingest.lantern.invalid/v1/telemetry/install',
    });
    sink.emit({ name: 'session_start', props: {} });
    await sink.requestDeletion();
    expect(sink.size()).toBe(0);
    expect(posts).toEqual([
      {
        url: 'https://ingest.lantern.invalid/v1/telemetry/install',
        method: 'DELETE',
        body: { installId: UUID },
      },
    ]);
  });
});

// ── Install id ───────────────────────────────────────────────────────────────
describe('install id', () => {
  beforeEach(() => __setKV(memKV()));

  it('is a random UUID, persisted, and regenerated after clearing', async () => {
    const a = await getInstallId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getInstallId()).toBe(a);
    await clearInstallId();
    const b = await getInstallId();
    expect(b).not.toBe(a);
  });

  it('peekInstallId reads without minting (#98)', async () => {
    expect(await peekInstallId()).toBeNull();
    expect(await peekInstallId()).toBeNull(); // still nothing: peeking never creates one
    const a = await getInstallId();
    expect(await peekInstallId()).toBe(a);
    await clearInstallId();
    expect(await peekInstallId()).toBeNull();
  });

  it('is never derived from an address or the vault', async () => {
    const kv = memKV();
    __setKV(kv);
    kv.store.set('lantern.vault', JSON.stringify({ publicKey: ADDRESS }));
    const id = await getInstallId();
    expect(id).not.toContain(ADDRESS.slice(0, 8));
    expect(kv.store.get(INSTALL_ID_KEY)).toBe(id);
  });
});

// ── Wire-up through the real Settings record ─────────────────────────────────
describe('startTelemetry', () => {
  beforeEach(() => {
    __setKV(memKV());
    __resetTelemetry();
    // The extension branch of onSettingsChanged subscribes to chrome.storage;
    // the in-memory KV never fires it, so a stub listener is enough here.
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { onChanged: { addListener: () => {}, removeListener: () => {} } },
    };
  });

  it('revoking without ever consenting makes no request and stores no install id', async () => {
    const kv = memKV();
    __setKV(kv);
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response('', { status: 204 });
    }) as typeof fetch;
    try {
      await startTelemetry({
        ingestUrl: 'https://ingest.lantern.invalid/v1/telemetry',
        appVersion: '0.1.0',
      });
      await revokeConsentAndDelete();
      expect(calls).toBe(0);
      expect(kv.store.has(INSTALL_ID_KEY)).toBe(false);
      expect((await getSettings()).analyticsConsent).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('consent defaults to off, lives in Settings, and gates emission end to end', async () => {
    const calls: Array<{ method: string; body: string }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: String(init?.body) });
      return new Response('', { status: 204 });
    }) as typeof fetch;
    try {
      await startTelemetry({
        ingestUrl: 'https://ingest.lantern.invalid/v1/telemetry',
        appVersion: '0.1.0',
      });
      expect((await getSettings()).analyticsConsent).toBeUndefined();
      emit({ name: 'app_first_open', props: {} });
      expect(calls).toHaveLength(0);
      await grantConsent();
      expect((await getSettings()).analyticsConsent).toBe(true);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]?.body).toContain('consent_granted');
      expect(calls[0]?.body).not.toContain('app_first_open'); // emitted before consent: never buffered
      await revokeConsentAndDelete();
      expect((await getSettings()).analyticsConsent).toBe(false);
      const del = calls.find((c) => c.method === 'DELETE');
      expect(del).toBeDefined();
      const n = calls.length;
      emit({ name: 'session_start', props: {} });
      expect(calls).toHaveLength(n);
      await setSettings({ analyticsConsent: true }); // toggled elsewhere: onSettingsChanged is the native path
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
