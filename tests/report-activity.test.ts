import { describe, it, expect } from 'vitest';
import {
  buildReport,
  renderHtml,
  fetchAllRows,
  fetchRegistryCount,
  registryInstanceKey,
  registryCountFromEntry,
  parseArgs,
  type Row,
} from '../scripts/report-activity';
import registryFixture from '../packages/lantern-scanner/fixtures/registry-hot-read.json';

// The activity report (#81 T-5). Pure functions over a hand-computed
// fixture: three installs on two platforms, one of them a tester who only
// opened the app. Numbers below are worked out by hand, not copied from the
// output.

const A = '5f3d2f1e-9c2b-4a1d-8e7f-0123456789ab'; // extension, testnet, onboarded (create), scanned, signed
const B = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'; // android, testnet, onboarded (import), high-risk gate, message check
const C = '11111111-2222-4333-8444-555555555555'; // extension, public, opened only
let id = 0;
const row = (
  installId: string,
  platform: string,
  network: string,
  ts: string,
  event: string,
  props: Row['props'] = {},
): Row => ({
  id: ++id,
  installId,
  platform,
  appVersion: '0.1.0',
  network,
  event,
  props,
  ts,
  receivedAt: ts,
});
const ROWS: Row[] = [
  row(B, 'android', 'testnet', '2026-09-20T09:00:00.000Z', 'app_first_open'),
  row(B, 'android', 'testnet', '2026-09-20T09:00:01.000Z', 'session_start'),
  row(B, 'android', 'testnet', '2026-09-20T09:02:00.000Z', 'wallet_created', { mode: 'import' }),
  row(A, 'extension', 'testnet', '2026-09-20T10:00:00.000Z', 'app_first_open'),
  row(A, 'extension', 'testnet', '2026-09-20T10:00:01.000Z', 'session_start'),
  row(A, 'extension', 'testnet', '2026-09-20T10:03:00.000Z', 'wallet_created', { mode: 'create' }),
  row(A, 'extension', 'testnet', '2026-09-20T10:05:00.000Z', 'tx_scanned', {
    risk: 'low',
    action: 'allow',
  }),
  row(A, 'extension', 'testnet', '2026-09-20T10:05:10.000Z', 'tx_signed', {
    kind: 'sign_and_submit',
    ok: true,
  }),
  row(B, 'android', 'testnet', '2026-09-21T09:00:00.000Z', 'session_start'),
  row(B, 'android', 'testnet', '2026-09-21T09:01:00.000Z', 'tx_scanned', {
    risk: 'high',
    action: 'block_confirm',
  }),
  row(B, 'android', 'testnet', '2026-09-21T09:01:00.500Z', 'high_risk_gated', { risk: 'high' }),
  row(B, 'android', 'testnet', '2026-09-21T09:04:00.000Z', 'message_scanned', { risk: 'high' }),
  row(C, 'extension', 'public', '2026-09-22T12:00:00.000Z', 'app_first_open'),
  row(C, 'extension', 'public', '2026-09-22T12:00:01.000Z', 'session_start'),
  row(A, 'extension', 'testnet', '2026-09-23T10:00:00.000Z', 'session_start'),
  row(A, 'extension', 'testnet', '2026-09-23T10:01:00.000Z', 'tx_signed', {
    kind: 'sign_only',
    ok: false,
  }),
];
const NOW = () => new Date('2026-09-24T00:00:00.000Z');
const opts = {
  since: '2026-09-20T00:00:00Z',
  until: '2026-09-24T00:00:00Z',
  registryCount: 8,
  registryId: 'CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F',
  now: NOW,
};

describe('buildReport', () => {
  const r = buildReport(ROWS, opts);

  it('summary: distinct installs, split by platform and network, event total', () => {
    expect(r.summary).toEqual({
      installs: 3,
      byPlatform: { android: 1, extension: 2 },
      byNetwork: { testnet: 2, public: 1 },
      events: 16,
    });
  });

  it('Q1: installs that completed onboarding, by mode', () => {
    expect(r.q1).toEqual({ onboarded: 2, byMode: { import: 1, create: 1 } });
  });

  it('Q2: event × count × distinct installs, busiest first', () => {
    expect(r.q2.slice(0, 3)).toEqual([
      { event: 'session_start', count: 5, installs: 3 },
      { event: 'app_first_open', count: 3, installs: 3 },
      { event: 'tx_scanned', count: 2, installs: 2 },
    ]);
    expect(r.q2.find((e) => e.event === 'tx_signed')).toEqual({
      event: 'tx_signed',
      count: 2,
      installs: 1,
    });
  });

  it('Q3: "User N" in first-seen order, with platform, first/last seen and the chronological trail', () => {
    expect(r.q3.map((t) => t.label)).toEqual(['User 1', 'User 2', 'User 3']);
    const u1 = r.q3[0]!;
    expect(u1).toMatchObject({
      platform: 'android',
      network: 'testnet',
      firstSeen: '2026-09-20T09:00:00.000Z',
      lastSeen: '2026-09-21T09:04:00.000Z',
    });
    expect(u1.events.map((e) => e.event)).toEqual([
      'app_first_open',
      'session_start',
      'wallet_created',
      'session_start',
      'tx_scanned',
      'high_risk_gated',
      'message_scanned',
    ]);
    expect(r.q3[1]).toMatchObject({
      label: 'User 2',
      platform: 'extension',
      firstSeen: '2026-09-20T10:00:00.000Z',
      lastSeen: '2026-09-23T10:01:00.000Z',
    });
    expect(r.q3[2]).toMatchObject({ label: 'User 3', platform: 'extension', network: 'public' });
    expect(r.q3[2]!.events).toHaveLength(2);
  });

  it('Q4: per-platform counts plus the registry cross-check', () => {
    expect(r.q4.byPlatform).toEqual({
      android: { txSigned: 0, txSignedOk: 0, txScanned: 1, highRiskGated: 1, messagesScanned: 1 },
      extension: { txSigned: 2, txSignedOk: 1, txScanned: 1, highRiskGated: 0, messagesScanned: 0 },
    });
    expect(r.q4.registry).toEqual({ distinctReportedSubjects: 8, contractId: opts.registryId });
  });

  it('carries no UUID anywhere in the model', () => {
    const text = JSON.stringify(r);
    for (const u of [A, B, C]) expect(text).not.toContain(u);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('--format=json is the same numbers', () => {
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe('renderHtml', () => {
  const html = renderHtml(buildReport(ROWS, opts));

  it('is self-contained: no script, no external stylesheet, font, image or fetch', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/@import|url\(/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/<style>/);
  });

  it('answers Q1–Q4 and prints User N, never a UUID', () => {
    expect(html).toContain('Q1 — Users onboarded');
    expect(html).toContain('Q2 — How they used it');
    expect(html).toContain('Q3 — Per-user activity');
    expect(html).toContain('Q4 — Transactions and scans');
    expect(html).toContain('User 1');
    expect(html).toContain('User 3');
    expect(html).toContain('>8<'); // the registry tile
    for (const u of [A, B, C]) expect(html).not.toContain(u);
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('escapes anything that could be markup', () => {
    const hostile = renderHtml(
      buildReport(
        [
          row(
            A,
            '<img src=x onerror=alert(1)>',
            'testnet',
            '2026-09-20T09:00:00.000Z',
            'session_start',
          ),
        ],
        opts,
      ),
    );
    expect(hostile).not.toContain('<img');
    expect(hostile).toContain('&lt;img');
  });

  it('renders a clean empty state with zero events', () => {
    const empty = renderHtml(
      buildReport([], { registryCount: null, registryId: opts.registryId, now: NOW }),
    );
    expect(empty).toContain('No activity in this window yet');
    expect(empty).toContain('>0<');
    expect(empty).toContain('unavailable'); // registry read failed → said so, not a fake 0
    expect(empty).not.toContain('Q1 — Users onboarded');
    expect(empty).toContain('Q4 — Transactions and scans'); // the cross-check still renders
    expect(empty).not.toMatch(/<script/i);
  });
});

describe('fetchAllRows', () => {
  it('pages through the export with the admin token and the window', async () => {
    const calls: string[] = [];
    const pages: Record<string, unknown> = {
      '': { rows: ROWS.slice(0, 2), next: 2 },
      '2': { rows: ROWS.slice(2, 3), next: null },
    };
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = new URL(String(url));
      calls.push(u.search);
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer t');
      return new Response(JSON.stringify(pages[u.searchParams.get('after') ?? '']), {
        status: 200,
      });
    };
    const rows = await fetchAllRows(
      'https://api.invalid/',
      't',
      { since: '2026-09-01' },
      fetchImpl,
    );
    expect(rows).toHaveLength(3);
    expect(calls).toEqual(['?since=2026-09-01', '?since=2026-09-01&after=2']);
  });

  it('fails loudly on a non-2xx', async () => {
    await expect(
      fetchAllRows('https://api.invalid', 't', {}, async () => new Response('', { status: 401 })),
    ).rejects.toThrow(/401/);
  });
});

describe('registry cross-check', () => {
  it('reads Count out of the registry instance (fee-free), or reports null', async () => {
    // The instance is not in the hot-read fixture (that records Entry keys), so
    // build the expectation from the key derivation and a stubbed body.
    const key = registryInstanceKey(registryFixture.registry);
    expect(key).toMatch(/^[A-Za-z0-9+/=]+$/);
    const nullOnMiss = await fetchRegistryCount(
      'https://rpc.invalid',
      registryFixture.registry,
      async () => new Response(JSON.stringify({ result: { entries: [] } }), { status: 200 }),
    );
    expect(nullOnMiss).toBeNull();
    const nullOnError = await fetchRegistryCount(
      'https://rpc.invalid',
      registryFixture.registry,
      async () => {
        throw new TypeError('offline');
      },
    );
    expect(nullOnError).toBeNull();
    expect(registryCountFromEntry('bm90LXhkcg==')).toBeNull();
  });
});

describe('parseArgs', () => {
  it('accepts --k v and --k=v forms', () => {
    expect(
      parseArgs([
        '--format=json',
        '--since',
        '2026-09-01',
        '--until=2026-10-01',
        '--input',
        'x.jsonl',
      ]),
    ).toEqual({
      format: 'json',
      since: '2026-09-01',
      until: '2026-10-01',
      input: 'x.jsonl',
    });
    expect(parseArgs([])).toEqual({ format: 'html' });
  });
});
