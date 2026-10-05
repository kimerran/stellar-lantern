import { describe, it, expect, beforeEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import {
  __resetAttribution,
  attributeOnce,
  recordedWebSource,
  recordFirstOpenSource,
  toWebSource,
  webSourceFromSearch,
  WEB_ATTRIBUTED_KEY,
  WEB_SOURCE_KEY,
} from '@shared/web/attribution';
import { WEB_SOURCES } from '@core/telemetry/events';
import { validateEvent } from '@core/telemetry/validate';
import { WEB_TELEMETRY_ENABLED } from '../src/web/telemetry';

// The web app's attribution (#239): the first open's `?src=`, kept only as
// an enum value, sent once after opt-in. And, until the server release is
// live, a web build that sends nothing at all.

function memKV(): KV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
}

let kv: ReturnType<typeof memKV>;
beforeEach(() => {
  kv = memKV();
  __setKV(kv);
  __resetAttribution();
});
// A new page load: same storage, fresh in-memory state.
const reopen = (search: string) => {
  __resetAttribution();
  return recordFirstOpenSource(search);
};

describe('toWebSource / webSourceFromSearch', () => {
  it('keeps a known slug', () => {
    for (const s of WEB_SOURCES) expect(toWebSource(s)).toBe(s);
  });

  it.each([
    'twitter-campaign-42',
    'HOMEPAGE-IOS',
    ' homepage',
    '',
    'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
    '<script>',
  ])('turns an arbitrary string (%j) into other', (raw) => {
    expect(toWebSource(raw)).toBe('other');
  });

  it('reads the first src from a query string, and null without one', () => {
    expect(webSourceFromSearch('?src=homepage-ios')).toBe('homepage-ios');
    expect(webSourceFromSearch('?src=launch&src=homepage')).toBe('launch');
    expect(webSourceFromSearch('?src=newsletter')).toBe('other');
    expect(webSourceFromSearch('?src=')).toBe('other');
    expect(webSourceFromSearch('')).toBeNull();
    expect(webSourceFromSearch('?ref=homepage')).toBeNull();
  });
});

describe('recordFirstOpenSource', () => {
  it('stores an arbitrary src as other, never the raw string', async () => {
    await recordFirstOpenSource('?src=my-secret-campaign-xyz');
    expect(await recordedWebSource()).toBe('other');
    expect([...kv.store.values()].join('|')).not.toContain('my-secret-campaign');
  });

  it('only the first open counts', async () => {
    await recordFirstOpenSource('?src=homepage-ios');
    await reopen('?src=launch');
    expect(await recordedWebSource()).toBe('homepage-ios');
  });

  it('an open without src records nothing, and a later src does not either', async () => {
    await recordFirstOpenSource('');
    expect(kv.store.has(WEB_SOURCE_KEY)).toBe(false);
    await reopen('?src=homepage');
    expect(await recordedWebSource()).toBeNull();
  });

  it('an installed first open without src records launch', async () => {
    await recordFirstOpenSource('', () => true);
    expect(await recordedWebSource()).toBe('launch');
  });

  it('an installed first open with src keeps the src', async () => {
    await recordFirstOpenSource('?src=homepage-ios', () => true);
    expect(await recordedWebSource()).toBe('homepage-ios');
  });

  it('a first open in a browser tab without src still records nothing', async () => {
    await recordFirstOpenSource('', () => false);
    expect(kv.store.has(WEB_SOURCE_KEY)).toBe(false);
  });

  it('a stored value outside the enum is ignored', async () => {
    kv.store.set(WEB_SOURCE_KEY, 'tampered');
    expect(await recordedWebSource()).toBeNull();
  });
});

describe('attributeOnce', () => {
  it('sends nothing without consent, then once with it, as a valid web_attributed', async () => {
    await recordFirstOpenSource('?src=homepage-ios');
    const sent: string[] = [];
    const send = (src: string) => void sent.push(src);
    expect(await attributeOnce(send, () => false)).toBe(false);
    expect(sent).toEqual([]);
    expect(kv.store.has(WEB_ATTRIBUTED_KEY)).toBe(false);
    expect(await attributeOnce(send, () => true)).toBe(true);
    expect(await attributeOnce(send, () => true)).toBe(false);
    expect(sent).toEqual(['homepage-ios']);
    expect(validateEvent({ name: 'web_attributed', props: { src: sent[0] }, ts: 1 })).toBe(true);
  });

  it('sends nothing when no source was recorded', async () => {
    await recordFirstOpenSource('');
    const sent: string[] = [];
    expect(
      await attributeOnce(
        (s) => void sent.push(s),
        () => true,
      ),
    ).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('the web build stays silent until the server release', () => {
  // Flip WEB_TELEMETRY_ENABLED only after lantern-api accepts platform 'web'.
  it.skipIf(WEB_TELEMETRY_ENABLED)(
    'the committed webapp/ carries no telemetry code or ingest URL',
    () => {
      // Read at transform time: the node-polyfills plugin replaces node:fs here.
      const js = Object.values(
        import.meta.glob<string>('../webapp/assets/*.js', {
          query: '?raw',
          import: 'default',
          eager: true,
        }),
      ).join('\n');
      expect(js.length).toBeGreaterThan(0);
      expect(js).not.toContain('lantern.telemetry.installId');
      expect(js).not.toContain('/v1/telemetry');
      expect(js).not.toContain('web_attributed');
      // The attribution is still recorded on the device, as an enum.
      expect(js).toContain('lantern.web.source');
    },
  );
});
