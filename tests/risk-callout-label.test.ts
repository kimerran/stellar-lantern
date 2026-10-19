import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RiskCallout } from '../src/popup/components/RiskCallout';
import type { ScanReason } from '../src/core/scan';

// A medium or high callout names its level in words ("High risk — action
// needed"), not only in red. Callers that already put a ScanBadge beside it
// (the demo gallery, the playground) turn the built-in one off.

const reasons: ScanReason[] = [
  { code: 'seed_phrase', title: 'Asks for your secret phrase', detail: 'x', severity: 'high' },
] as ScanReason[];
const html = (props: Partial<Parameters<typeof RiskCallout>[0]>) =>
  renderToStaticMarkup(createElement(RiskCallout, { risk: 'high', reasons, ...props }));

describe('RiskCallout names the risk level', () => {
  it('leads a high callout with "High risk — action needed"', () => {
    const h = html({});
    expect(h).toContain('High risk — action needed');
    expect(h.indexOf('High risk')).toBeLessThan(h.indexOf('Asks for your secret phrase'));
  });

  it('labels medium as caution', () => {
    expect(html({ risk: 'medium' })).toContain('Caution — review below');
  });

  it('adds no badge to a low callout', () => {
    const h = html({ risk: 'low', reasons: [] });
    expect(h).not.toContain('Checked by Lantern');
    expect(h).not.toContain('High risk');
  });

  it('leaves the badge out when the caller shows its own', () => {
    expect(html({ badge: false })).not.toContain('High risk');
  });
});
