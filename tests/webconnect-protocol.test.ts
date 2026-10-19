import { describe, it, expect } from 'vitest';
import {
  MAX_REQUEST_BYTES,
  PAGE_SOURCE,
  RELAY_SOURCE,
  USER_REJECTED_MESSAGE,
  isExtensionSender,
  parseEvent,
  parsePageEvent,
  parseRequest,
  parseResponse,
  requestTimeoutMs,
  toPageMessage,
  unwrapPageMessage,
  webConnectOrigin,
} from '@core/webconnect/protocol';

const EXT_ID = 'iflpkjgolcbleombhldiibhojohjpnmd';
const EXT_ORIGIN = `chrome-extension://${EXT_ID}`;
const EXT_BASE = `${EXT_ORIGIN}/`;

describe('parseRequest', () => {
  it('accepts a well-formed request and defaults params to {}', () => {
    expect(parseRequest({ id: 'abc123', method: 'isConnected' })).toEqual({
      ok: true,
      value: { id: 'abc123', method: 'isConnected', params: {} },
    });
  });

  it('rejects anything without a usable id, with no id to answer to', () => {
    for (const raw of [
      null,
      'x',
      [],
      { method: 'isConnected' },
      { id: '', method: 'isConnected' },
      { id: 'a b' },
      { id: 'x'.repeat(65) },
    ]) {
      const r = parseRequest(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.id).toBeNull();
    }
  });

  it('keeps the id when the rest is wrong, so the page learns which call failed', () => {
    for (const raw of [
      { id: 'a1', method: 'stealKeys' },
      { id: 'a1', method: 'isConnected', params: [] },
      { id: 'a1', method: 'isConnected', params: 'x' },
    ]) {
      const r = parseRequest(raw);
      expect(r).toMatchObject({ ok: false, id: 'a1', error: { code: 'invalid_request' } });
    }
  });

  it('rejects an oversized request', () => {
    const r = parseRequest({
      id: 'a1',
      method: 'signTransaction',
      params: { xdr: 'A'.repeat(MAX_REQUEST_BYTES) },
    });
    expect(r).toMatchObject({
      ok: false,
      id: 'a1',
      error: { code: 'invalid_request', message: 'Request too large' },
    });
  });

  it('rejects a request it cannot serialize (cycles, BigInt)', () => {
    const params: Record<string, unknown> = {};
    params.self = params;
    expect(parseRequest({ id: 'a1', method: 'isConnected', params })).toMatchObject({
      ok: false,
      id: 'a1',
    });
    expect(parseRequest({ id: 'a1', method: 'isConnected', params: { n: 1n } })).toMatchObject({
      ok: false,
      id: 'a1',
    });
  });
});

describe('page ↔ relay envelopes', () => {
  it('unwraps only our own page messages', () => {
    expect(
      unwrapPageMessage({
        source: PAGE_SOURCE,
        id: 'a',
        method: 'isConnected',
        params: {},
        extra: 1,
      }),
    ).toEqual({
      id: 'a',
      method: 'isConnected',
      params: {},
    });
    expect(unwrapPageMessage({ source: RELAY_SOURCE, id: 'a' })).toBeNull();
    expect(unwrapPageMessage({ id: 'a', method: 'isConnected' })).toBeNull();
    expect(unwrapPageMessage('hello')).toBeNull();
  });

  it('round-trips a success and an error through toPageMessage / parseResponse', () => {
    expect(
      parseResponse(toPageMessage({ id: 'a', ok: true, result: { isConnected: true } })),
    ).toEqual({
      id: 'a',
      ok: true,
      result: { isConnected: true },
    });
    expect(
      parseResponse(
        toPageMessage({
          id: 'b',
          ok: false,
          error: { code: 'user_rejected', message: USER_REJECTED_MESSAGE },
        }),
      ),
    ).toEqual({
      id: 'b',
      ok: false,
      error: { code: 'user_rejected', message: 'User rejected the request' },
    });
  });

  it("ignores the page's own requests and anything malformed", () => {
    expect(parseResponse({ source: PAGE_SOURCE, id: 'a', ok: true })).toBeNull();
    expect(parseResponse({ source: RELAY_SOURCE, id: 'a b', ok: true })).toBeNull();
    expect(parseResponse({ source: RELAY_SOURCE, id: 'a', ok: false, error: 'nope' })).toBeNull();
    expect(parseResponse({ source: RELAY_SOURCE, id: 'a' })).toBeNull();
  });

  it('passes only known events', () => {
    expect(parseEvent({ event: 'change', data: { network: 'TESTNET' } })).toEqual({
      event: 'change',
      data: { network: 'TESTNET' },
    });
    expect(parseEvent({ event: 'change' })).toEqual({ event: 'change', data: {} });
    expect(parseEvent({ event: 'drain' })).toBeNull();
    expect(parsePageEvent(toPageMessage({ event: 'change', data: {} }))).toEqual({
      event: 'change',
      data: {},
    });
    expect(parsePageEvent({ event: 'change', data: {} })).toBeNull();
  });

  it('gives calls that need a person ten minutes, the rest fifteen seconds', () => {
    expect(requestTimeoutMs('signTransaction')).toBe(600_000);
    expect(requestTimeoutMs('requestAccess')).toBe(600_000);
    expect(requestTimeoutMs('isConnected')).toBe(15_000);
    expect(requestTimeoutMs('getAddress')).toBe(15_000);
  });
});

describe('isExtensionSender (the privileged listener)', () => {
  it("accepts Lantern's popup, a Lantern tab and the approval window", () => {
    expect(
      isExtensionSender({ id: EXT_ID, url: `${EXT_ORIGIN}/index.html` }, EXT_ID, EXT_BASE),
    ).toBe(true);
    // An extension page in a tab or popup window has sender.tab, and is still ours.
    expect(
      isExtensionSender(
        { id: EXT_ID, url: `${EXT_ORIGIN}/index.html#/approve`, tab: { id: 7 } },
        EXT_ID,
        EXT_BASE,
      ),
    ).toBe(true);
  });

  it("refuses a content script: our id, but the web page's url", () => {
    expect(
      isExtensionSender(
        { id: EXT_ID, url: 'https://evil.example/', tab: { id: 7 }, frameId: 0 },
        EXT_ID,
        EXT_BASE,
      ),
    ).toBe(false);
    expect(
      isExtensionSender(
        { id: EXT_ID, url: `https://evil.example/${EXT_ORIGIN}/index.html` },
        EXT_ID,
        EXT_BASE,
      ),
    ).toBe(false);
  });

  it('refuses another extension, and a sender with no url', () => {
    expect(
      isExtensionSender({ id: 'other', url: `${EXT_ORIGIN}/index.html` }, EXT_ID, EXT_BASE),
    ).toBe(false);
    expect(isExtensionSender({ id: EXT_ID }, EXT_ID, EXT_BASE)).toBe(false);
    expect(isExtensionSender({ id: EXT_ID, url: 'not a url' }, EXT_ID, EXT_BASE)).toBe(false);
    // A longer host that starts with our id can't pass the prefix check.
    expect(
      isExtensionSender({ id: EXT_ID, url: `${EXT_ORIGIN}x/index.html` }, EXT_ID, EXT_BASE),
    ).toBe(false);
  });
});

describe('webConnectOrigin (who a web-connect port speaks for)', () => {
  const tab = { id: 3 };

  it('takes the browser-reported origin of an https top frame', () => {
    expect(
      webConnectOrigin({
        origin: 'https://app.paiflow.xyz',
        url: 'https://app.paiflow.xyz/trigger/1',
        frameId: 0,
        tab,
      }),
    ).toBe('https://app.paiflow.xyz');
    // Older Chrome without sender.origin: fall back to the url's origin.
    expect(webConnectOrigin({ url: 'https://app.paiflow.xyz/x?y#z', frameId: 0, tab })).toBe(
      'https://app.paiflow.xyz',
    );
  });

  it('refuses frames, tabless senders, opaque and non-https origins', () => {
    expect(webConnectOrigin({ origin: 'https://a.example', frameId: 2, tab })).toBeNull();
    expect(webConnectOrigin({ origin: 'https://a.example', frameId: 0 })).toBeNull();
    expect(webConnectOrigin({ origin: 'null', frameId: 0, tab })).toBeNull();
    expect(webConnectOrigin({ origin: 'http://a.example', frameId: 0, tab })).toBeNull();
    expect(
      webConnectOrigin({ origin: 'file://', url: 'file:///tmp/x.html', frameId: 0, tab }),
    ).toBeNull();
  });

  it('allows http://localhost only when asked to (development builds)', () => {
    expect(webConnectOrigin({ origin: 'http://localhost:5174', frameId: 0, tab })).toBeNull();
    expect(webConnectOrigin({ origin: 'http://localhost:5174', frameId: 0, tab }, true)).toBe(
      'http://localhost:5174',
    );
    expect(webConnectOrigin({ origin: 'http://127.0.0.1:8080', frameId: 0, tab }, true)).toBe(
      'http://127.0.0.1:8080',
    );
    expect(
      webConnectOrigin({ origin: 'http://evil.localhost.example', frameId: 0, tab }, true),
    ).toBeNull();
  });
});
