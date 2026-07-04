import { describe, it, expect, vi } from 'vitest';
import { Keypair, Networks, WebAuth } from '@stellar/stellar-sdk';
import { authenticateSep10, startAnchorTransfer } from '@core/anchor/session';

const HOME = 'anchor.example.com';
const WEB_AUTH = 'https://anchor.example.com/auth';
const TRANSFER = 'https://anchor.example.com/sep24';
const pp = Networks.TESTNET;
const server = Keypair.random(); // stands in for the anchor's SIGNING_KEY
const client = Keypair.random(); // the wallet

// A compliant anchor's challenge, signed by `serverKp` (defaults to the real server).
function challengeXdr(serverKp = server): string {
  return WebAuth.buildChallengeTx(serverKp, client.publicKey(), HOME, 300, pp, HOME);
}

// Injected fetch routed by method+url to the right JSON body; captures calls.
function routedFetch(routes: { challenge?: unknown; token?: unknown; interactive?: unknown }) {
  const calls: Array<{ url: string; method: string; body?: string; headers?: Record<string, string> }> = [];
  const impl = ((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({
      url,
      method,
      body: init?.body ? String(init.body) : undefined,
      headers: init?.headers as Record<string, string> | undefined,
    });
    let body: unknown = {};
    if (url.includes('/interactive')) body = routes.interactive;
    else if (method === 'POST') body = routes.token;
    else body = routes.challenge;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve('') });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const params = (signChallenge: (x: string, p: string) => Promise<string>, fetchImpl: typeof fetch) => ({
  webAuthEndpoint: WEB_AUTH,
  signingKey: server.publicKey(),
  homeDomain: HOME,
  webAuthDomain: HOME,
  account: client.publicKey(),
  networkPassphrase: pp,
  signChallenge,
  fetchImpl,
});

describe('authenticateSep10', () => {
  it('validates the challenge, signs it, and returns the JWT', async () => {
    const signer = vi.fn(async () => 'SIGNED==');
    const { impl, calls } = routedFetch({ challenge: { transaction: challengeXdr(), network_passphrase: pp }, token: { token: 'jwt.abc' } });
    const jwt = await authenticateSep10(params(signer, impl));
    expect(jwt).toBe('jwt.abc');
    expect(signer).toHaveBeenCalledTimes(1);
    expect(signer).toHaveBeenCalledWith(expect.any(String), pp);
    expect(calls.find((c) => c.method === 'POST')?.body).toContain('SIGNED==');
  });

  it('SECURITY: refuses a challenge signed by the wrong key and NEVER signs it', async () => {
    const signer = vi.fn(async () => 'SIGNED==');
    const { impl } = routedFetch({ challenge: { transaction: challengeXdr(Keypair.random()), network_passphrase: pp } });
    await expect(authenticateSep10(params(signer, impl))).rejects.toThrow(/verify the anchor/i);
    expect(signer).not.toHaveBeenCalled();
  });

  it('SECURITY: refuses a challenge built for a different network, without signing', async () => {
    const signer = vi.fn(async () => 'SIGNED==');
    const { impl } = routedFetch({ challenge: { transaction: challengeXdr(), network_passphrase: Networks.PUBLIC } });
    await expect(authenticateSep10(params(signer, impl))).rejects.toThrow(/different network/i);
    expect(signer).not.toHaveBeenCalled();
  });
});

describe('startAnchorTransfer', () => {
  it('authenticates then starts the SEP-24 interactive with the JWT and returns id + url', async () => {
    const signer = vi.fn(async () => 'SIGNED==');
    const { impl, calls } = routedFetch({
      challenge: { transaction: challengeXdr(), network_passphrase: pp },
      token: { token: 'jwt.abc' },
      interactive: { id: 'tx-1', url: 'https://anchor.example.com/i/tx-1', type: 'interactive_customer_info_needed' },
    });
    const r = await startAnchorTransfer({ ...params(signer, impl), transferServer: TRANSFER, kind: 'deposit', assetCode: 'USDC' });
    expect(r).toMatchObject({ id: 'tx-1', url: 'https://anchor.example.com/i/tx-1' });
    const interactive = calls.find((c) => c.url.includes('/interactive'));
    expect(interactive?.url).toBe('https://anchor.example.com/sep24/transactions/deposit/interactive');
    expect(interactive?.headers?.Authorization).toBe('Bearer jwt.abc');
    expect(interactive?.body).toContain('USDC');
  });
});
