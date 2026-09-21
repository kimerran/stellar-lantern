// Telemetry events (#81): a closed discriminated union whose props are
// enum-valued only. There is no free-text field anywhere in these types —
// that is the structural guarantee that PII cannot be emitted: an address,
// an amount, a memo or a pasted message has no slot to go in. The runtime
// validator (validate.ts) enforces the same set on the wire.

export type Platform = 'extension' | 'android';
export type Network = 'testnet' | 'public';
export type RiskLevel = 'low' | 'medium' | 'high';
export type ScanAction = 'allow' | 'warn' | 'block_confirm';
// Mirrors the registry contract's `Reason` enum (src/core/registry/report.ts).
export type RegistryReason = 'Scam' | 'Phishing' | 'Drainer' | 'Poisoning' | 'Mixer' | 'Other';

// Bundled mini-app ids only (src/core/miniapps/directory.ts) — never a URL.
// Anything not in this list is reported as 'other'.
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
  // The one-click registry report (#120) — the counter behind §6.3's registry
  // targets. The reason is the contract's closed enum; no address, no fee
  // amount, no note has a slot here.
  | { name: 'registry_report_submitted'; props: { reason: RegistryReason; ok: boolean } }
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
  registry_report_submitted: {
    reason: ['Scam', 'Phishing', 'Drainer', 'Poisoning', 'Mixer', 'Other'],
    ok: 'boolean',
  },
  consent_granted: {},
  consent_revoked: {},
};

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
