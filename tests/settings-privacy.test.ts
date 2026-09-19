import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Settings } from '@popup/screens/Settings';
import { CONSENT_COPY } from '@core/telemetry';
import type { Settings as SettingsType } from '@shared/types';

// Settings → Privacy shows the Analytics ID row only while sharing is on and
// an id exists (#98). Static render: no DOM, no storage — the row is a pure
// function of props.

const ID = '0d9a7ff4-ff9b-4652-868e-e6c09770e162';
const noop = () => {};
const async = async () => {};
function render(settings: Partial<SettingsType>, installId: string | null) {
  return renderToStaticMarkup(
    createElement(Settings, {
      address: 'GBK4XPLHJDQ2K2GGF7DZ5KJ2PCG5R4RJRCZT3TGSGWYQ3W7NLZ2GM5X9V2',
      settings: { network: 'TESTNET', autoLockMinutes: 5, ...settings } as SettingsType,
      onBack: noop,
      onCopyAddress: noop,
      onOpenReceive: noop,
      onOpenGuardians: noop,
      onOpenScan: noop,
      onOpenCashInOut: noop,
      onLock: noop,
      setNetwork: noop,
      setAutoLock: noop,
      setHorizonOverrides: noop,
      setRpcOverrides: noop,
      setAnalyticsConsent: async,
      deleteAnalytics: async,
      installId,
    }),
  );
}

describe('Settings → Privacy analytics id row', () => {
  it('shows the id and its hint when sharing is on and an id exists', () => {
    const html = render({ analyticsConsent: true }, ID);
    expect(html).toContain(CONSENT_COPY.idTitle);
    expect(html).toContain(ID);
    expect(html).toContain('not derived from your wallet');
  });

  it('hides the row when sharing is off, even if an id lingers', () => {
    const html = render({ analyticsConsent: false }, ID);
    expect(html).not.toContain(CONSENT_COPY.idTitle);
    expect(html).not.toContain(ID);
  });

  it('hides the row when no id has been minted yet', () => {
    const html = render({ analyticsConsent: true }, null);
    expect(html).not.toContain(CONSENT_COPY.idTitle);
    expect(html).toContain(CONSENT_COPY.title); // the toggle itself is still there
  });
});
