// The emit points (#87), as one-line helpers the screens and the session
// handler call. Each helper builds exactly one TelemetryEvent from the
// narrowest input it needs — a scan verdict's risk, a mini-app's id, a
// signing outcome — so the call site cannot hand it anything else (the
// pasted message text, an address, an amount) even by accident. Tests call
// these with a stub sink and assert the event; a source-level test asserts
// every screen uses the helper rather than emit() directly.

import { emit } from './index';
import type {
  MiniAppId,
  RecheckDirection,
  RegistryReason,
  RiskLevel,
  ScanAction,
  TelemetryEvent,
} from './events';

const MINI_APP_IDS = new Set<MiniAppId>(['stardust-faucet', 'lumen-notes', 'lantern-demo']);

export function walletCreatedEvent(mode: 'create' | 'import' | 'passkey'): TelemetryEvent {
  return { name: 'wallet_created', props: { mode } };
}
export function messageScannedEvent(verdict: { risk: RiskLevel }): TelemetryEvent {
  return { name: 'message_scanned', props: { risk: verdict.risk } };
}
export function txScannedEvent(verdict: { risk: RiskLevel; action: ScanAction }): TelemetryEvent[] {
  const out: TelemetryEvent[] = [
    { name: 'tx_scanned', props: { risk: verdict.risk, action: verdict.action } },
  ];
  if (verdict.action === 'block_confirm')
    out.push({ name: 'high_risk_gated', props: { risk: verdict.risk } });
  return out;
}
export function swapExecutedEvent(engine: 'sdex' | 'soroswap'): TelemetryEvent {
  return {
    name: 'swap_executed',
    props: { engine: engine === 'soroswap' ? 'aggregator' : 'sdex' },
  };
}
export function earnActionEvent(kind: 'supply' | 'withdraw'): TelemetryEvent {
  return { name: 'earn_action', props: { kind } };
}
export function anchorFlowEvent(
  kind: 'deposit' | 'withdraw',
  stage: 'started' | 'completed' | 'failed',
): TelemetryEvent {
  return { name: 'anchor_flow', props: { kind, stage } };
}
// Only a BUNDLED app reports its id; a remote app — even one whose id is in
// the directory — is 'other', because its id names a URL we do not control.
export function miniAppOpenedEvent(appId: string, remote = false): TelemetryEvent {
  const appIdOut: MiniAppId =
    !remote && MINI_APP_IDS.has(appId as MiniAppId) ? (appId as MiniAppId) : 'other';
  return { name: 'miniapp_opened', props: { appId: appIdOut } };
}

export function txSignedEvent(
  kind: 'sign_and_submit' | 'sign_only' | 'submit_only',
  ok: boolean,
): TelemetryEvent {
  return { name: 'tx_signed', props: { kind, ok } };
}

// The registry write (#120). Takes the closed reason and the outcome only —
// the subject, the fee and any evidence note have no way in.
export function registryReportEvent(reason: RegistryReason, ok: boolean): TelemetryEvent {
  return { name: 'registry_report_submitted', props: { reason, ok } };
}

// The re-check before submit (#121): whether anything drifted, and which way.
export function txRecheckedEvent(r: { drifted: boolean; direction: RecheckDirection }): TelemetryEvent {
  return { name: 'tx_rechecked', props: { drifted: r.drifted, direction: r.direction } };
}

// Fire-and-forget wrappers. No-ops when telemetry is off or unconsented.
export const track = {
  walletCreated: (mode: 'create' | 'import' | 'passkey') => emit(walletCreatedEvent(mode)),
  messageScanned: (verdict: { risk: RiskLevel }) => emit(messageScannedEvent(verdict)),
  txScanned: (verdict: { risk: RiskLevel; action: ScanAction }) =>
    txScannedEvent(verdict).forEach(emit),
  swapExecuted: (engine: 'sdex' | 'soroswap') => emit(swapExecutedEvent(engine)),
  earnAction: (kind: 'supply' | 'withdraw') => emit(earnActionEvent(kind)),
  anchorFlow: (kind: 'deposit' | 'withdraw', stage: 'started' | 'completed' | 'failed') =>
    emit(anchorFlowEvent(kind, stage)),
  miniAppOpened: (appId: string, remote = false) => emit(miniAppOpenedEvent(appId, remote)),
  txSigned: (kind: 'sign_and_submit' | 'sign_only' | 'submit_only', ok: boolean) =>
    emit(txSignedEvent(kind, ok)),
  registryReport: (reason: RegistryReason, ok: boolean) => emit(registryReportEvent(reason, ok)),
  txRechecked: (r: { drifted: boolean; direction: RecheckDirection }) => emit(txRecheckedEvent(r)),
  guardianAdded: () => emit({ name: 'guardian_added', props: {} }),
  sessionStart: () => emit({ name: 'session_start', props: {} }),
  appFirstOpen: () => emit({ name: 'app_first_open', props: {} }),
};
