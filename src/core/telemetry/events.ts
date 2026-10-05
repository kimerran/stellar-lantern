// Telemetry events (#81): a closed discriminated union whose props are
// enum-valued only. There is no free-text field anywhere in these types —
// that is the structural guarantee that PII cannot be emitted: an address,
// an amount, a memo or a pasted message has no slot to go in. The runtime
// validator (validate.ts) enforces the same set on the wire.

// 'demo' is the public playground at golantern.xyz/demo (#188): no install,
// no consent screen, a random id per page load, and only `demo_scanned`.
// 'web' is the browser build at app.golantern.xyz (#239): a wallet like the
// other two, under the same opt-in, plus its own `web_attributed`.
export type Platform = 'extension' | 'android' | 'web' | 'demo';
export type Network = 'testnet' | 'public';
export type RiskLevel = 'low' | 'medium' | 'high';
export type ScanAction = 'allow' | 'warn' | 'block_confirm';
// Mirrors the registry contract's `Reason` enum (src/core/registry/report.ts).
export type RegistryReason = 'Scam' | 'Phishing' | 'Drainer' | 'Poisoning' | 'Mixer' | 'Other';
export type RecheckDirection = 'none' | 'escalated' | 'de_escalated' | 'lateral' | 'failed';
// Why a registry read answered `unknown` (#180) — the screener's own reasons,
// with anything else as 'other'.
export type RegistryUnknownReason =
  | 'timeout'
  | 'rpc_error'
  | 'malformed'
  | 'archived'
  | 'no_registry'
  | 'other';
// How long the screening stage took, and how long the wallet had been idle
// since the previous screening — buckets, never a raw duration.
export type ScreenLatency = 'lt_1s' | '1s_2s' | '2s_3s' | 'gte_3s';
export type ScreenIdle = 'first' | 'lt_30s' | '30s_2m' | 'gte_2m';

// Bundled mini-app ids only (src/core/miniapps/directory.ts) — never a URL.
// Anything not in this list is reported as 'other'.
// Where a playground scan's transaction came from (#188). Only `pasted` and
// `composed` are a visitor bringing their own transaction; `seeded` is one
// click on a built-in example and never counts toward SOW §6.3's headline.
export type DemoOrigin = 'seeded' | 'pasted' | 'composed';

// Where a web-app visitor came from (#239): the first `?src=` the web app
// was opened with, folded into this closed set on the device. The raw query
// string is never stored or sent; anything unrecognised is 'other'.
export const WEB_SOURCES = ['homepage-ios', 'homepage', 'launch', 'other'] as const;
export type WebSource = (typeof WEB_SOURCES)[number];

export type MiniAppId = 'stardust-faucet' | 'lumen-notes' | 'lantern-demo' | 'other';

export type TelemetryEvent =
  // Q1 — onboarding
  | { name: 'app_first_open'; props: Record<string, never> }
  | { name: 'session_start'; props: Record<string, never> }
  | { name: 'wallet_created'; props: { mode: 'create' | 'import' | 'passkey' } }
  // Q2 — feature interaction
  | { name: 'message_scanned'; props: { risk: RiskLevel } }
  | { name: 'swap_executed'; props: { engine: 'sdex' | 'aggregator' } }
  | { name: 'earn_action'; props: { kind: 'supply' | 'withdraw' } }
  | { name: 'guardian_added'; props: Record<string, never> }
  | {
      name: 'anchor_flow';
      props: { kind: 'deposit' | 'withdraw'; stage: 'started' | 'completed' | 'failed' };
    }
  | { name: 'miniapp_opened'; props: { appId: MiniAppId } }
  // Q4 — transaction / wallet activity
  | {
      name: 'tx_signed';
      props: { kind: 'sign_and_submit' | 'sign_only' | 'submit_only'; ok: boolean };
    }
  | { name: 'tx_scanned'; props: { risk: RiskLevel; action: ScanAction } }
  | { name: 'high_risk_gated'; props: { risk: RiskLevel } }
  // A review whose registry screening came back `unknown` — the "Couldn't
  // check the recipient" state (#180). Sent alongside its tx_scanned; says
  // why, how long it took, and whether it followed an idle spell.
  | {
      name: 'registry_unknown';
      props: { reason: RegistryUnknownReason; latency: ScreenLatency; idle: ScreenIdle };
    }
  // The one-click registry report (#120) — the counter behind §6.3's registry
  // targets. The reason is the contract's closed enum; no address, no fee
  // amount, no note has a slot here.
  | { name: 'registry_report_submitted'; props: { reason: RegistryReason; ok: boolean } }
  // The re-check before submit (#121). `failed` = could not re-check (RPC
  // down / timeout); `none` = re-checked, nothing changed. Drift frequency is
  // the number that says whether the guard earns its latency.
  | { name: 'tx_rechecked'; props: { drifted: boolean; direction: RecheckDirection } }
  // A completed scan on the public playground (#188). Its own event rather
  // than new props on tx_scanned: the validator requires every schema prop,
  // so a new tx_scanned prop would make the server reject every envelope
  // from the wallet builds already installed (the lesson of #182).
  | {
      name: 'demo_scanned';
      props: { risk: RiskLevel; action: ScanAction; origin: DemoOrigin };
    }
  // The web app's attribution (#239), sent once after opt-in. Its own event,
  // not a new prop on app_first_open, for the same reason as demo_scanned:
  // installed builds would start failing the validator.
  | { name: 'web_attributed'; props: { src: WebSource } }
  // Consent lifecycle
  | { name: 'consent_granted'; props: Record<string, never> }
  | { name: 'consent_revoked'; props: Record<string, never> };

export type EventName = TelemetryEvent['name'];

// The allowed value set per event prop — the single source the validator
// checks against. Booleans are listed as 'boolean'.
export const EVENT_SCHEMA: Record<EventName, Record<string, readonly string[] | 'boolean'>> = {
  app_first_open: {},
  session_start: {},
  wallet_created: { mode: ['create', 'import', 'passkey'] },
  message_scanned: { risk: ['low', 'medium', 'high'] },
  swap_executed: { engine: ['sdex', 'aggregator'] },
  earn_action: { kind: ['supply', 'withdraw'] },
  guardian_added: {},
  anchor_flow: { kind: ['deposit', 'withdraw'], stage: ['started', 'completed', 'failed'] },
  miniapp_opened: { appId: ['stardust-faucet', 'lumen-notes', 'lantern-demo', 'other'] },
  tx_signed: { kind: ['sign_and_submit', 'sign_only', 'submit_only'], ok: 'boolean' },
  tx_scanned: { risk: ['low', 'medium', 'high'], action: ['allow', 'warn', 'block_confirm'] },
  high_risk_gated: { risk: ['low', 'medium', 'high'] },
  registry_unknown: {
    reason: ['timeout', 'rpc_error', 'malformed', 'archived', 'no_registry', 'other'],
    latency: ['lt_1s', '1s_2s', '2s_3s', 'gte_3s'],
    idle: ['first', 'lt_30s', '30s_2m', 'gte_2m'],
  },
  registry_report_submitted: {
    reason: ['Scam', 'Phishing', 'Drainer', 'Poisoning', 'Mixer', 'Other'],
    ok: 'boolean',
  },
  tx_rechecked: {
    drifted: 'boolean',
    direction: ['none', 'escalated', 'de_escalated', 'lateral', 'failed'],
  },
  demo_scanned: {
    risk: ['low', 'medium', 'high'],
    action: ['allow', 'warn', 'block_confirm'],
    origin: ['seeded', 'pasted', 'composed'],
  },
  web_attributed: { src: WEB_SOURCES },
  consent_granted: {},
  consent_revoked: {},
};

// The events a `platform: 'demo'` envelope may carry, and the only platform
// that may carry them. The playground sends nothing a wallet sends, and a
// wallet can't send a playground scan.
export const DEMO_EVENTS: ReadonlySet<EventName> = new Set<EventName>(['demo_scanned']);

// Events only a `platform: 'web'` envelope may carry (#239). Unlike the
// playground, the web app also sends every wallet event; this set only stops
// the other wallets from sending web-only ones.
export const WEB_EVENTS: ReadonlySet<EventName> = new Set<EventName>(['web_attributed']);

export interface StampedEvent {
  name: EventName;
  props: Record<string, string | boolean>;
  ts: number; // unix ms
}

// What one flush sends. The install id is an opaque UUID (install-id.ts);
// the report maps it to "User N" at export time and never prints it.
export interface Envelope {
  installId: string;
  platform: Platform;
  appVersion: string;
  network: Network;
  events: StampedEvent[];
  // ALPHA ONLY (#100): the wallet's public address, attached under
  // __FEATURE_TELEMETRY_IDENTITY__ so the report is per tester. The one
  // deliberate exception to "no key-shaped string anywhere in the envelope".
  account?: string;
}
