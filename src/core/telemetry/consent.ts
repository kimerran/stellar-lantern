// Consent surface logic (#86): the copy the Settings toggle and the one-time
// prompt show, and the one rule for when the prompt appears. Kept out of the
// React tree so the copy can be asserted against docs/telemetry.md and the
// once-only rule can be tested without a DOM.

import type { Settings } from '@shared/types';
import { setSettings } from '@shared/storage';

export const CONSENT_COPY = {
  title: 'Share anonymous usage data',
  summary:
    'Helps us see which features are used and whether the scanner’s warnings help. Off by default; you can turn it off and delete your data at any time.',
  collected: [
    'an anonymous install id (a random number, not linked to your wallet)',
    'which features you use, and how often',
    'whether a scan warned you, and how risky it said the transaction was',
    'which platform you are on (Android or Chrome) and the app version',
  ],
  neverCollected: [
    'your addresses, public keys or secret keys',
    'your recovery phrase or password',
    'amounts, asset codes, memos or transaction hashes',
    'the text of any message you check',
  ],
  idTitle: 'Analytics ID',
  idHint:
    'Include this ID in your test report so we can match your feedback to your usage. It is random, not derived from your wallet.',
  deleteTitle: 'Delete my data',
  deleteHint: 'Turns sharing off and asks us to delete everything sent from this install.',
  promptAccept: 'Share anonymous usage data',
  promptDecline: 'Not now',
} as const;

// The prompt shows exactly once, after onboarding has produced a wallet and
// before the user has answered it — never before onboarding, never twice.
export function shouldShowConsentPrompt(
  settings: Pick<Settings, 'analyticsPromptSeen' | 'analyticsConsent'>,
): boolean {
  return settings.analyticsPromptSeen !== true && settings.analyticsConsent !== true;
}

export async function markConsentPromptSeen(): Promise<void> {
  await setSettings({ analyticsPromptSeen: true });
}
