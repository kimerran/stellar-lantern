// Telemetry (#81) — wire-up for the wallet. Everything here sits behind the
// `telemetry` flag (OFF by default): with it off, no emit point imports this
// module and the subsystem dead-code-eliminates out of the bundle.
//
// Consent lives in the existing Settings record (`analyticsConsent`,
// default false) — there is no parallel store. The sink is a hard no-op
// until it is true.

import { getSettings, onSettingsChanged, setSettings } from '@shared/storage';
import { isNativePlatform } from '@shared/kv';
import { createSink, type Sink } from './sink';
import { clearInstallId, getInstallId } from './install-id';
import type { TelemetryEvent } from './events';

export type { TelemetryEvent, Envelope, StampedEvent, EventName } from './events';
export { validateEnvelope, validateEvent } from './validate';
export { createSink } from './sink';
export { getInstallId, clearInstallId, INSTALL_ID_KEY } from './install-id';

let sink: Sink | null = null;
let consent = false;

export interface StartOptions {
  ingestUrl: string;
  appVersion: string;
}

// Call once at app start, under `if (__FEATURE_TELEMETRY__)`. Safe to call
// with no consent: nothing is buffered or sent until the user opts in.
export async function startTelemetry(opts: StartOptions): Promise<void> {
  const settings = await getSettings();
  consent = settings.analyticsConsent === true;
  let network = settings.network;
  onSettingsChanged((s) => {
    consent = s.analyticsConsent === true;
    network = s.network;
  });
  sink = createSink({
    ingestUrl: opts.ingestUrl,
    platform: isNativePlatform() ? 'android' : 'extension',
    appVersion: opts.appVersion,
    network: () => (network === 'PUBLIC' ? 'public' : 'testnet'),
    installId: getInstallId,
    hasConsent: () => consent,
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void sink?.flush();
    });
  }
}

export function emit(event: TelemetryEvent): void {
  sink?.emit(event);
}

export async function grantConsent(): Promise<void> {
  await setSettings({ analyticsConsent: true });
  consent = true;
  sink?.emit({ name: 'consent_granted', props: {} });
  await sink?.flush();
}

// Revoke + "delete my data": stop emitting, ask the server to drop the
// install's rows, and forget the id locally so any future trail is unlinkable.
export async function revokeConsentAndDelete(): Promise<void> {
  sink?.emit({ name: 'consent_revoked', props: {} });
  await sink?.flush();
  await setSettings({ analyticsConsent: false });
  consent = false;
  await sink?.requestDeletion();
  await clearInstallId();
}

// Test hook.
export function __resetTelemetry(): void {
  sink = null;
  consent = false;
}
