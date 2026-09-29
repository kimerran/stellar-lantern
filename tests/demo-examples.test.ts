import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TransactionBuilder } from '@stellar/stellar-sdk';
import type { PipelineDeps, ScreenAnswer } from '@lantern/scanner';
import { EXAMPLES, recordedScreen, runExample } from '../src/demo/examples';
import { ExampleResult } from '../src/demo/Examples';
import { DEMO_NETWORK } from '../src/demo/scan';

// The D4 playground's seeded examples (#185). Nothing here touches the
// network: "live" is a stub, and "offline" is a stub that fails the way a
// dead testnet does.

const FLAGGED = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

const offline: PipelineDeps = {
  simulate: async () => {
    throw new TypeError('Failed to fetch');
  },
  screen: async () => ({ outcome: 'unknown', reason: 'rpc_error', source: 'registry' }),
};

const example = (id: string) => {
  const e = EXAMPLES.find((x) => x.id === id);
  if (!e) throw new Error(`no example ${id}`);
  return e;
};

describe('the six examples with the network off', () => {
  it('are the six the issue names, one of them marked malicious', () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual([
      'safe-payment',
      'reported-scammer',
      'unlimited-approval',
      'unverified-contract',
      'signer-takeover',
      'account-merge',
    ]);
    expect(EXAMPLES.filter((e) => e.malicious).map((e) => e.id)).toEqual(['reported-scammer']);
  });

  it.each(EXAMPLES.map((e) => [e.id, e] as const))(
    '%s renders its recorded verdict from the fixture, with the notice',
    async (_id, e) => {
      const out = await runExample(e, offline);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.cached).toBeDefined();
      expect(out.discrepancy).toBeUndefined();
      expect(out.scan.result.risk).toBe(e.expect.risk);
      if (e.expect.action) expect(out.scan.result.action).toBe(e.expect.action);
      const html = renderToStaticMarkup(createElement(ExampleResult, { outcome: out }));
      expect(html).toContain('Using cached simulation');
      expect(html).toContain('data-testid="scan-result"');
    },
  );

  it('example 2 is flagged / high / block_confirm from the recording', async () => {
    const out = await runExample(example('reported-scammer'), offline);
    if (!out.ok) throw new Error(out.error);
    expect(out.scan.result.risk).toBe('high');
    expect(out.scan.result.action).toBe('block_confirm');
    const answer = out.scan.result.screen.answers.find((a) => a.address === FLAGGED)?.answer;
    expect(answer?.outcome).toBe('flagged');
    expect(answer?.source).toBe('recording');
  });
});

describe('live first', () => {
  const liveRegistry = (answer: (a: string) => ScreenAnswer): PipelineDeps => ({
    screen: async (a) => answer(a),
  });

  it('a live answer is shown as live: no cached notice', async () => {
    const out = await runExample(
      example('reported-scammer'),
      liveRegistry((a) =>
        a === FLAGGED
          ? { outcome: 'flagged', source: 'registry' }
          : { outcome: 'not_flagged', source: 'registry' },
      ),
    );
    if (!out.ok) throw new Error(out.error);
    expect(out.cached).toBeUndefined();
    expect(out.scan.result.risk).toBe('high');
    const html = renderToStaticMarkup(createElement(ExampleResult, { outcome: out }));
    expect(html).not.toContain('Using cached simulation');
    expect(html).toContain('Live testnet answer');
  });

  it('a live answer that differs from the recording is shown, and the difference is flagged', async () => {
    // Testnet reset, or the entry revoked: the live registry says not flagged.
    const out = await runExample(
      example('reported-scammer'),
      liveRegistry(() => ({ outcome: 'not_flagged', source: 'registry' })),
    );
    if (!out.ok) throw new Error(out.error);
    expect(out.cached).toBeUndefined();
    expect(out.scan.result.risk).toBe('low');
    expect(out.discrepancy).toMatch(/recorded example scores high/);
    const html = renderToStaticMarkup(createElement(ExampleResult, { outcome: out }));
    expect(html).toContain('differs from the recording');
  });
});

describe('recordedScreen', () => {
  it('answers from the recording, and unknown for anything it did not record', async () => {
    expect((await recordedScreen(FLAGGED)).outcome).toBe('flagged');
    expect((await recordedScreen('GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57')).outcome).toBe(
      'not_flagged',
    );
    const other = await recordedScreen('GDO52IAZJBNVS4LLJTUSCHLKME52X3JJ5N5UHAIWPUAAFG253Z62YL7Q');
    expect(other).toMatchObject({ outcome: 'unknown', reason: 'not_recorded' });
  });
});

describe('Copy XDR', () => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s copies an envelope that decodes', (_id, e) => {
    const tx = TransactionBuilder.fromXDR(e.fixture.xdr, DEMO_NETWORK.passphrase);
    expect(tx.toXDR()).toBe(e.fixture.xdr);
  });
});
