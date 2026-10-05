import { describe, it, expect } from 'vitest';
import { validateEnvelope } from '../src/core/telemetry/validate';
import { EVENT_SCHEMA, WEB_SOURCES } from '../src/core/telemetry/events';
import { buildReport, type Row } from '../src/core/telemetry/report';

// The web app's analytics platform (#239): a wallet like the extension and
// Android, plus one event of its own (`web_attributed`) that no other
// platform may send. The server accepts all of it before any client sends it.

const INSTALL = '3c1e5a2b-7d4f-4e6a-9b8c-0d1e2f3a4b5c';
const ADDRESS = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const ev = (name: string, props: Record<string, unknown> = {}) => ({ name, props, ts: 1 });
const attributed = (src: string) => ev('web_attributed', { src });
const webEnvelope = (over: Record<string, unknown> = {}) => ({
  installId: INSTALL,
  platform: 'web',
  appVersion: '0.5.1',
  network: 'testnet',
  events: [
    ev('app_first_open'),
    ev('session_start'),
    ev('wallet_created', { mode: 'create' }),
    ev('tx_scanned', { risk: 'high', action: 'block_confirm' }),
    ev('tx_signed', { kind: 'sign_and_submit', ok: true }),
  ],
  ...over,
});

describe('the validator on web envelopes', () => {
  it('accepts the wallet’s events from platform web', () => {
    expect(validateEnvelope(webEnvelope())).toBe(true);
  });

  it('accepts the account only as a public address, like the other wallets (identity flag)', () => {
    expect(validateEnvelope(webEnvelope({ account: ADDRESS }))).toBe(true);
    expect(validateEnvelope(webEnvelope({ account: 'GABC' }))).toBe(false);
  });

  it('rejects a playground scan from web', () => {
    const scan = ev('demo_scanned', { risk: 'high', action: 'block_confirm', origin: 'pasted' });
    expect(validateEnvelope(webEnvelope({ events: [scan] }))).toBe(false);
  });

  it('accepts web_attributed from web for every source in the enum', () => {
    expect(EVENT_SCHEMA.web_attributed).toEqual({ src: [...WEB_SOURCES] });
    for (const src of WEB_SOURCES)
      expect(validateEnvelope(webEnvelope({ events: [attributed(src)] })), src).toBe(true);
  });

  it.each([
    ['a raw query string', attributed('twitter-campaign-42')],
    ['an address', attributed(ADDRESS)],
    ['no src', ev('web_attributed')],
    ['an extra prop', ev('web_attributed', { src: 'homepage', ref: 'x' })],
  ])('rejects web_attributed carrying %s', (_label, e) => {
    expect(validateEnvelope(webEnvelope({ events: [e] }))).toBe(false);
  });

  it('no other platform may send web_attributed', () => {
    for (const platform of ['extension', 'android', 'demo'])
      expect(
        validateEnvelope(webEnvelope({ platform, events: [attributed('homepage-ios')] })),
        platform,
      ).toBe(false);
  });

  it('other wallets are unchanged, and unknown platforms are still rejected', () => {
    expect(validateEnvelope(webEnvelope({ platform: 'extension' }))).toBe(true);
    expect(validateEnvelope(webEnvelope({ platform: 'android' }))).toBe(true);
    expect(validateEnvelope(webEnvelope({ platform: 'ios' }))).toBe(false);
  });
});

describe('the activity report counts web as a wallet platform', () => {
  const row = (id: number, over: Partial<Row>): Row => ({
    id,
    installId: INSTALL,
    platform: 'web',
    appVersion: '0.5.1',
    network: 'testnet',
    event: 'session_start',
    props: {},
    ts: `2026-10-05T10:00:0${id}.000Z`,
    receivedAt: '2026-10-05T10:01:00.000Z',
    ...over,
  });
  const EXT = '5f3d2f1e-9c2b-4a1d-8e7f-0123456789ab';
  const LOAD = '0b6f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
  const rows = [
    row(1, { event: 'web_attributed', props: { src: 'homepage-ios' } }),
    row(2, { event: 'wallet_created', props: { mode: 'create' } }),
    row(3, { event: 'tx_scanned', props: { risk: 'low', action: 'allow' } }),
    row(4, { installId: EXT, platform: 'extension' }),
    row(5, {
      installId: LOAD,
      platform: 'demo',
      appVersion: 'demo',
      event: 'demo_scanned',
      props: { risk: 'low', action: 'allow', origin: 'pasted' },
    }),
  ];
  const r = buildReport(rows, { registryCount: null, registryId: 'C' });

  it('a web install is an install, a user and an onboarded wallet; a page load is not', () => {
    expect(r.summary.installs).toBe(2);
    expect(r.summary.byPlatform).toEqual({ web: 1, extension: 1 });
    expect(r.q1.onboarded).toBe(1);
    expect(r.q3.map((t) => t.platform).sort()).toEqual(['extension', 'web']);
    expect(r.q4.byPlatform.web).toEqual({
      txSigned: 0,
      txSignedOk: 0,
      txScanned: 1,
      highRiskGated: 0,
      messagesScanned: 0,
    });
    expect(r.demo.pageLoads).toBe(1);
  });
});
