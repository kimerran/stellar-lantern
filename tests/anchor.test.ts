import { describe, it, expect } from 'vitest';
import { parseAnchorToml, discoverAnchor } from '@core/anchor/toml';

const SIGNING_KEY = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const ISSUER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

const SAMPLE_TOML = `
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
WEB_AUTH_ENDPOINT="https://anchor.example.com/auth"
TRANSFER_SERVER_SEP0024="https://anchor.example.com/sep24"
SIGNING_KEY="${SIGNING_KEY}"

[[CURRENCIES]]
code="USDC"
issuer="${ISSUER}"

[[CURRENCIES]]
code="XLM"
`;

// Minimal Response-like stub for an injected fetch.
function fakeFetch(body: string, init: { ok?: boolean; status?: number } = {}) {
  const calls: string[] = [];
  const impl = ((url: string) => {
    calls.push(url);
    return Promise.resolve({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      text: () => Promise.resolve(body),
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('parseAnchorToml', () => {
  it('extracts the SEP-10 / SEP-24 endpoints, signing key, and currencies', () => {
    const info = parseAnchorToml(SAMPLE_TOML);
    expect(info.webAuthEndpoint).toBe('https://anchor.example.com/auth');
    expect(info.transferServerSep24).toBe('https://anchor.example.com/sep24');
    expect(info.signingKey).toBe(SIGNING_KEY);
    expect(info.currencies).toEqual([
      { code: 'USDC', issuer: ISSUER },
      { code: 'XLM' }, // native — no issuer
    ]);
  });

  it('leaves missing fields undefined and returns no currencies', () => {
    const info = parseAnchorToml('NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"');
    expect(info.webAuthEndpoint).toBeUndefined();
    expect(info.transferServerSep24).toBeUndefined();
    expect(info.signingKey).toBeUndefined();
    expect(info.currencies).toEqual([]);
  });

  it('drops a SIGNING_KEY that is not a valid account key', () => {
    expect(parseAnchorToml('SIGNING_KEY="NOT_A_REAL_KEY"').signingKey).toBeUndefined();
  });

  it('throws on malformed TOML', () => {
    expect(() => parseAnchorToml('this is = = not toml')).toThrow();
  });
});

describe('discoverAnchor', () => {
  it('fetches /.well-known/stellar.toml and parses it', async () => {
    const { impl, calls } = fakeFetch(SAMPLE_TOML);
    const info = await discoverAnchor('anchor.example.com', impl);
    expect(calls[0]).toBe('https://anchor.example.com/.well-known/stellar.toml');
    expect(info.webAuthEndpoint).toBe('https://anchor.example.com/auth');
  });

  it('normalizes a home domain with scheme and trailing slash', async () => {
    const { impl, calls } = fakeFetch(SAMPLE_TOML);
    await discoverAnchor('https://anchor.example.com/', impl);
    expect(calls[0]).toBe('https://anchor.example.com/.well-known/stellar.toml');
  });

  it('throws a readable error on a non-2xx response', async () => {
    const { impl } = fakeFetch('not found', { ok: false, status: 404 });
    await expect(discoverAnchor('anchor.example.com', impl)).rejects.toThrow(/404/);
  });

  it('rejects an empty home domain', async () => {
    const { impl } = fakeFetch(SAMPLE_TOML);
    await expect(discoverAnchor('   ', impl)).rejects.toThrow(/required/i);
  });
});
