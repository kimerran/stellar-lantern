import { describe, it, expect } from 'vitest';
import { validateEnvelope } from '../src/core/telemetry/validate';
import { buildReport, renderHtml, type Row } from '../src/core/telemetry/report';
import { createDemoTelemetry, DEMO_INGEST_URL } from '../src/demo/telemetry';

// Playground telemetry (#188): a random id per page load, one enum-only
// event, kept apart from the wallet everywhere it is counted.

const LOAD = '0b6f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
const ADDRESS = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const scan = (origin: string, extra: Record<string, unknown> = {}) => ({
  name: 'demo_scanned',
  props: { risk: 'high', action: 'block_confirm', origin, ...extra },
  ts: 1_790_000_000_000,
});
const demoEnvelope = (over: Record<string, unknown> = {}) => ({
  installId: LOAD,
  platform: 'demo',
  appVersion: 'demo',
  network: 'testnet',
  events: [scan('pasted'), scan('composed'), scan('seeded')],
  ...over,
});

describe('the validator on playground envelopes', () => {
  it('accepts a demo scan of each origin', () => {
    expect(validateEnvelope(demoEnvelope())).toBe(true);
  });

  it.each([
    ['an address as a prop', { events: [scan('pasted', { to: ADDRESS })] }],
    ['an address in place of an enum', { events: [scan(ADDRESS)] }],
    ['free text as the origin', { events: [scan('I pasted my own tx')] }],
    ['free text as an extra prop', { events: [scan('pasted', { note: 'hello' })] }],
    ['a wallet address on the envelope', { account: ADDRESS }],
    ['mainnet', { network: 'public' }],
    [
      'a wallet event',
      { events: [{ name: 'tx_scanned', props: { risk: 'low', action: 'allow' }, ts: 1 }] },
    ],
    [
      'a missing origin',
      { events: [{ name: 'demo_scanned', props: { risk: 'low', action: 'allow' }, ts: 1 }] },
    ],
  ])('rejects a demo envelope carrying %s', (_label, over) => {
    expect(validateEnvelope(demoEnvelope(over))).toBe(false);
  });

  it('a wallet can’t send a playground scan', () => {
    expect(validateEnvelope(demoEnvelope({ platform: 'extension' }))).toBe(false);
    expect(validateEnvelope(demoEnvelope({ platform: 'android' }))).toBe(false);
  });

  it('wallet envelopes are unchanged: tx_scanned still takes exactly risk and action', () => {
    const wallet = {
      installId: LOAD,
      platform: 'extension',
      appVersion: '0.3.0',
      network: 'testnet',
      events: [{ name: 'tx_scanned', props: { risk: 'low', action: 'allow' }, ts: 1 }],
    };
    expect(validateEnvelope(wallet)).toBe(true);
  });
});

describe('createDemoTelemetry', () => {
  function harness(id = LOAD) {
    const sent: Array<{ url: string; init: RequestInit }> = [];
    const timers: Array<() => void> = [];
    const t = createDemoTelemetry({
      fetchImpl: (async (url: string, init: RequestInit) => {
        sent.push({ url, init });
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch,
      now: () => 1_790_000_000_000,
      newId: () => id,
      schedule: (fn) => void timers.push(fn),
    });
    return { t, sent, timers };
  }

  it('batches scans into one envelope under the page load’s id, with nothing else', async () => {
    const { t, sent, timers } = harness();
    t.scanned({ risk: 'high', action: 'block_confirm', origin: 'pasted' });
    t.scanned({ risk: 'low', action: 'allow', origin: 'seeded' });
    expect(timers).toHaveLength(1); // one flush scheduled, not one per scan
    await t.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(DEMO_INGEST_URL);
    expect(sent[0]!.init.credentials).toBe('omit');
    expect(sent[0]!.init.keepalive).toBe(true);
    const body = JSON.parse(String(sent[0]!.init.body));
    expect(body).toEqual({
      installId: LOAD,
      platform: 'demo',
      appVersion: 'demo',
      network: 'testnet',
      events: [
        {
          name: 'demo_scanned',
          props: { risk: 'high', action: 'block_confirm', origin: 'pasted' },
          ts: 1_790_000_000_000,
        },
        {
          name: 'demo_scanned',
          props: { risk: 'low', action: 'allow', origin: 'seeded' },
          ts: 1_790_000_000_000,
        },
      ],
    });
    expect(validateEnvelope(body)).toBe(true);
    await t.flush();
    expect(sent).toHaveLength(1); // nothing left to send
  });

  it('two page loads share no id', async () => {
    const a = harness('11111111-1111-4111-8111-111111111111');
    const b = harness('22222222-2222-4222-8222-222222222222');
    a.t.scanned({ risk: 'low', action: 'allow', origin: 'composed' });
    b.t.scanned({ risk: 'low', action: 'allow', origin: 'composed' });
    await a.t.flush();
    await b.t.flush();
    const ids = [a, b].map((h) => JSON.parse(String(h.sent[0]!.init.body)).installId);
    expect(new Set(ids).size).toBe(2);
  });

  it('a failed send is dropped quietly', async () => {
    const t = createDemoTelemetry({
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
      newId: () => LOAD,
      schedule: () => undefined,
    });
    t.scanned({ risk: 'low', action: 'allow', origin: 'pasted' });
    await expect(t.flush()).resolves.toBeUndefined();
  });
});

describe('the activity report', () => {
  const row = (id: number, over: Partial<Row>): Row => ({
    id,
    installId: LOAD,
    platform: 'extension',
    appVersion: '0.3.0',
    network: 'testnet',
    event: 'tx_scanned',
    props: { risk: 'low', action: 'allow' },
    ts: `2026-09-28T10:00:0${id}.000Z`,
    receivedAt: '2026-09-28T10:01:00.000Z',
    ...over,
  });
  const demo = (id: number, load: string, origin: string, risk = 'high') =>
    row(id, {
      installId: load,
      platform: 'demo',
      appVersion: 'demo',
      event: 'demo_scanned',
      props: { risk, action: risk === 'high' ? 'block_confirm' : 'allow', origin },
    });
  const L1 = '11111111-1111-4111-8111-111111111111';
  const L2 = '22222222-2222-4222-8222-222222222222';
  const rows = [
    row(1, {}),
    demo(2, L1, 'pasted'),
    demo(3, L1, 'seeded'),
    demo(4, L2, 'seeded', 'low'),
    demo(5, L2, 'composed', 'low'),
    demo(6, L2, 'seeded'),
  ];
  const report = buildReport(rows, { registryCount: null, registryId: 'C' });

  it('never counts a page load as an install, a user or a wallet scan', () => {
    expect(report.summary.installs).toBe(1);
    expect(report.summary.events).toBe(1);
    expect(report.summary.byPlatform).toEqual({ extension: 1 });
    expect(report.q3).toHaveLength(1);
    expect(report.q4.byPlatform).toEqual({
      extension: { txSigned: 0, txSignedOk: 0, txScanned: 1, highRiskGated: 0, messagesScanned: 0 },
    });
  });

  it('reports visitor-supplied and seeded scans separately, never summed', () => {
    expect(report.demo).toEqual({
      pageLoads: 2,
      visitor: 2,
      seeded: 3,
      byOrigin: { pasted: 1, seeded: 3, composed: 1 },
      byRisk: { visitor: { high: 1, low: 1 }, seeded: { high: 2, low: 1 } },
    });
    const html = renderHtml(report);
    expect(html).toContain('Public playground');
    expect(html).toContain('never added to it');
    expect(html).not.toContain(L1);
    expect(html).not.toContain(L2);
  });

  it('shows no playground section when there were no playground scans', () => {
    const html = renderHtml(buildReport([row(1, {})], { registryCount: null, registryId: 'C' }));
    expect(html).not.toContain('Public playground');
  });
});
