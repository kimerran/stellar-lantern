// Telemetry events (#81): a closed discriminated union whose props are
// enum-valued only. There is no free-text field anywhere in these types —
// that is the structural guarantee that PII cannot be emitted: an address,
// an amount, a memo or a pasted message has no slot to go in. The runtime
// validator (validate.ts) enforces the same set on the wire.

export type Platform = 'extension' | 'android';
export type Network = 'testnet' | 'public';
export type RiskLevel = 'low' | 'medium' | 'high';
export type ScanAction = 'allow' | 'warn' | 'block_confirm';

// Bundled mini-app ids only (src/core/miniapps directory) — never a URL.
export type MiniAppId = 'blockhub' | 'stellar-expert' | 'soroswap' | 'blend' | 'other';

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
  miniapp_opened: { appId: ['blockhub', 'stellar-expert', 'soroswap', 'blend', 'other'] },
  tx_signed: { kind: ['sign_and_submit', 'sign_only', 'submit_only'], ok: 'boolean' },
  tx_scanned: { risk: ['low', 'medium', 'high'], action: ['allow', 'warn', 'block_confirm'] },
  high_risk_gated: { risk: ['low', 'medium', 'high'] },
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
}
