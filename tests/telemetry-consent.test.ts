import { describe, it, expect, beforeEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { getSettings, setSettings } from '@shared/storage';
import {
  CONSENT_COPY,
  shouldShowConsentPrompt,
  markConsentPromptSeen,
  startTelemetry,
  grantConsent,
  revokeConsentAndDelete,
  deleteAnalyticsData,
  getInstallId,
  INSTALL_ID_KEY,
  __resetTelemetry,
} from '@core/telemetry';
import promptSrc from '../src/popup/screens/AnalyticsPrompt.tsx?raw';
import telemetryDoc from '../docs/telemetry.md?raw';

// The consent surface (#86): the once-only prompt rule, the transitions
// through the real Settings record, and the copy against docs/telemetry.md.

function memKV(): KV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
}

beforeEach(() => {
  __setKV(memKV());
  __resetTelemetry();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { onChanged: { addListener: () => {}, removeListener: () => {} } },
  };
});

describe('shouldShowConsentPrompt', () => {
  it('shows once: only while unanswered and consent is not already on', () => {
    expect(shouldShowConsentPrompt({})).toBe(true);
    expect(shouldShowConsentPrompt({ analyticsPromptSeen: true })).toBe(false);
    expect(shouldShowConsentPrompt({ analyticsConsent: true })).toBe(false);
    expect(shouldShowConsentPrompt({ analyticsPromptSeen: false, analyticsConsent: false })).toBe(
      true,
    );
  });

  it('"Not now" answers it for good', async () => {
    expect(shouldShowConsentPrompt(await getSettings())).toBe(true);
    await markConsentPromptSeen();
    const s = await getSettings();
    expect(shouldShowConsentPrompt(s)).toBe(false);
    expect(s.analyticsConsent).toBeUndefined(); // declined ≠ consented
  });

  it('accepting answers it and turns consent on; revoking keeps it answered and turns consent off', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('', { status: 204 })) as typeof fetch;
    try {
      await startTelemetry({
        ingestUrl: 'https://ingest.lantern.invalid/v1/telemetry',
        appVersion: '0.1.0',
      });
      await grantConsent();
      let s = await getSettings();
      expect(s).toMatchObject({ analyticsConsent: true, analyticsPromptSeen: true });
      expect(shouldShowConsentPrompt(s)).toBe(false);
      await revokeConsentAndDelete();
      s = await getSettings();
      expect(s).toMatchObject({ analyticsConsent: false, analyticsPromptSeen: true });
      expect(shouldShowConsentPrompt(s)).toBe(false); // never re-prompted after an answer
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('deleteAnalyticsData (explicit "Delete my data")', () => {
  function stubFetch() {
    const calls: Array<{ method: string; body: string }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: String(init?.body) });
      return new Response('', { status: 204 });
    }) as typeof fetch;
    return { calls, restore: () => void (globalThis.fetch = realFetch) };
  }

  it('sends the deletion request whenever an install id exists — even with consent already off', async () => {
    const kv = memKV();
    __setKV(kv);
    const { calls, restore } = stubFetch();
    try {
      await startTelemetry({
        ingestUrl: 'https://ingest.lantern.invalid/v1/telemetry',
        appVersion: '0.1.0',
      });
      await grantConsent();
      const id = await getInstallId();
      // A revoke that never reached the server: consent is off, the id remains.
      await setSettings({ analyticsConsent: false });
      kv.store.set(INSTALL_ID_KEY, id);
      __resetTelemetry();
      await startTelemetry({
        ingestUrl: 'https://ingest.lantern.invalid/v1/telemetry',
        appVersion: '0.1.0',
      });
      const before = calls.length;
      await deleteAnalyticsData();
      const del = calls.slice(before).find((c) => c.method === 'DELETE');
      expect(del).toBeDefined();
      expect(del?.body).toContain(id);
      expect(kv.store.has(INSTALL_ID_KEY)).toBe(false);
      expect((await getSettings()).analyticsConsent).toBe(false);
    } finally {
      restore();
    }
  });

  it('makes no request for an install that never had an id', async () => {
    const kv = memKV();
    __setKV(kv);
    const { calls, restore } = stubFetch();
    try {
      await startTelemetry({
        ingestUrl: 'https://ingest.lantern.invalid/v1/telemetry',
        appVersion: '0.1.0',
      });
      await deleteAnalyticsData();
      expect(calls).toHaveLength(0);
      expect(kv.store.has(INSTALL_ID_KEY)).toBe(false);
    } finally {
      restore();
    }
  });
});

describe('the prompt is non-blocking', () => {
  it('has no backdrop and no modal semantics; wallet controls stay reachable', () => {
    expect(promptSrc).not.toMatch(/inset-0/);
    expect(promptSrc).not.toMatch(/aria-modal/);
    expect(promptSrc).not.toMatch(/role="dialog"/);
    expect(promptSrc).not.toMatch(/bg-scrim/);
    expect(promptSrc).toMatch(/pointer-events-none/); // the wrapper lets clicks through
    expect(promptSrc).toMatch(/pointer-events-auto/); // only the card itself is interactive
  });
});

describe('consent copy', () => {
  it('says the same thing as docs/telemetry.md', () => {
    // Every "never collect" line in the UI names something the doc's list names.
    const doc = telemetryDoc.toLowerCase();
    const neverSection = doc.split('## what we never collect')[1]?.split('\n## ')[0] ?? '';
    expect(neverSection.length).toBeGreaterThan(50);
    for (const [uiLine, docKeyword] of [
      ['addresses, public keys or secret keys', 'secret keys'],
      ['recovery phrase or password', 'seed phrases, passwords'],
      [
        'amounts, asset codes, memos or transaction hashes',
        'amounts, asset codes, memos, transaction hashes',
      ],
      ['the text of any message you check', 'raw pasted message text'],
    ] as const) {
      expect(
        CONSENT_COPY.neverCollected.some((l) => l.includes(uiLine)),
        uiLine,
      ).toBe(true);
      expect(neverSection, docKeyword).toContain(docKeyword);
    }
    // And what we do collect is what the doc's short version says.
    expect(CONSENT_COPY.collected.join(' ')).toMatch(/anonymous install id/);
    expect(doc).toMatch(/opt-in, default off/);
    expect(CONSENT_COPY.summary).toMatch(/off by default/i);
    // No UI line mentions anything the doc forbids collecting as if it were collected.
    for (const line of CONSENT_COPY.collected) {
      expect(line).not.toMatch(/address|key|phrase|amount|memo|message text/i);
    }
    // The Analytics ID row (#98): the doc names the row and the UI says the id
    // is random and not wallet-derived, matching the doc's promise.
    expect(doc).toContain('analytics id');
    expect(CONSENT_COPY.idTitle).toBe('Analytics ID');
    expect(CONSENT_COPY.idHint).toMatch(/random/i);
    expect(CONSENT_COPY.idHint).toMatch(/not derived from your wallet/i);
  });
});
