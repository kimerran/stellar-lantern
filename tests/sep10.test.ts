import { describe, it, expect } from 'vitest';
import { Keypair, Networks, WebAuth } from '@stellar/stellar-sdk';
import { fetchChallenge, validateChallenge, submitChallenge } from '@core/anchor/sep10';

const HOME_DOMAIN = 'anchor.example.com';
const WEB_AUTH = 'https://anchor.example.com/auth';
const pp = Networks.TESTNET;

// A server keypair stands in for the anchor's SIGNING_KEY; a client keypair for
// the wallet. buildChallengeTx produces exactly what a compliant anchor returns.
const server = Keypair.random();
const client = Keypair.random();

function challengeXdr(opts: { serverKp?: Keypair; home?: string } = {}): string {
  return WebAuth.buildChallengeTx(
    opts.serverKp ?? server,
    client.publicKey(),
    opts.home ?? HOME_DOMAIN,
    300,
    pp,
    HOME_DOMAIN,
  );
}

// Minimal Response-like stub for an injected fetch that returns JSON.
function jsonFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = ((url: string, reqInit?: RequestInit) => {
    calls.push({ url, init: reqInit });
    return Promise.resolve({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: () => Promise.resolve(body),
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('validateChallenge', () => {
  it('accepts a well-formed challenge signed by the anchor and returns the client account', () => {
    const r = validateChallenge(challengeXdr(), {
      serverAccountId: server.publicKey(),
      networkPassphrase: pp,
      homeDomain: HOME_DOMAIN,
      webAuthDomain: HOME_DOMAIN,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.clientAccountId).toBe(client.publicKey());
  });

  it('rejects a challenge signed by a different (wrong) server key', () => {
    const r = validateChallenge(challengeXdr({ serverKp: Keypair.random() }), {
      serverAccountId: server.publicKey(),
      networkPassphrase: pp,
      homeDomain: HOME_DOMAIN,
      webAuthDomain: HOME_DOMAIN,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a wrong home domain and unparseable XDR', () => {
    expect(
      validateChallenge(challengeXdr(), {
        serverAccountId: server.publicKey(),
        networkPassphrase: pp,
        homeDomain: 'evil.example.com',
        webAuthDomain: HOME_DOMAIN,
      }).ok,
    ).toBe(false);
    expect(
      validateChallenge('not-a-real-xdr', {
        serverAccountId: server.publicKey(),
        networkPassphrase: pp,
        homeDomain: HOME_DOMAIN,
        webAuthDomain: HOME_DOMAIN,
      }).ok,
    ).toBe(false);
  });
});

describe('fetchChallenge', () => {
  it('GETs the endpoint with account + home_domain and returns the challenge', async () => {
    const { impl, calls } = jsonFetch({ transaction: 'XDR==', network_passphrase: pp });
    const c = await fetchChallenge(WEB_AUTH, { account: client.publicKey(), homeDomain: HOME_DOMAIN }, impl);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('account')).toBe(client.publicKey());
    expect(url.searchParams.get('home_domain')).toBe(HOME_DOMAIN);
    expect(c.transaction).toBe('XDR==');
    expect(c.networkPassphrase).toBe(pp);
  });

  it('throws on a non-2xx response and on a missing transaction', async () => {
    const bad = jsonFetch({}, { ok: false, status: 400 });
    await expect(fetchChallenge(WEB_AUTH, { account: client.publicKey(), homeDomain: HOME_DOMAIN }, bad.impl)).rejects.toThrow(/400/);
    const empty = jsonFetch({ network_passphrase: pp });
    await expect(fetchChallenge(WEB_AUTH, { account: client.publicKey(), homeDomain: HOME_DOMAIN }, empty.impl)).rejects.toThrow(/no challenge/i);
  });
});

describe('submitChallenge', () => {
  it('POSTs the signed XDR and returns the JWT', async () => {
    const { impl, calls } = jsonFetch({ token: 'jwt.abc.123' });
    const token = await submitChallenge(WEB_AUTH, 'SIGNED==', impl);
    expect(token).toBe('jwt.abc.123');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(String(calls[0]!.init?.body)).toContain('SIGNED==');
  });

  it('throws on a non-2xx response and on a missing token', async () => {
    const bad = jsonFetch({}, { ok: false, status: 401 });
    await expect(submitChallenge(WEB_AUTH, 'SIGNED==', bad.impl)).rejects.toThrow(/401/);
    const empty = jsonFetch({});
    await expect(submitChallenge(WEB_AUTH, 'SIGNED==', empty.impl)).rejects.toThrow(/no auth token/i);
  });
});
