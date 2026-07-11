import { describe, it, expect } from 'vitest';
import { Networks, Asset } from '@stellar/stellar-sdk';
import {
  assetContractId,
  toStroops,
  fromStroops,
  pickBestEngine,
  fetchSoroswapQuote,
  buildSoroswapSwapXdr,
  DEFAULT_PROTOCOLS,
  type SoroswapConfig,
} from '@core/stellar/soroswap';
import type { AssetRef } from '@core/stellar/tx';

const PASSPHRASE = Networks.TESTNET;
const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const FROM = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const XLM: AssetRef = { isNative: true };
const USDC: AssetRef = { isNative: false, code: 'USDC', issuer: ISSUER };

interface Captured {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

// A fetch stub that records each request and returns a queued response.
function stub(responses: Array<{ ok?: boolean; status?: number; body?: unknown; throws?: boolean }>) {
  const calls: Captured[] = [];
  let i = 0;
  const impl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const r = responses[i++] ?? responses[responses.length - 1]!;
    if (r.throws) return Promise.reject(new Error('network down'));
    return Promise.resolve({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: () => Promise.resolve(r.body),
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function cfg(over: Partial<SoroswapConfig> = {}): SoroswapConfig {
  return { apiKey: 'k_test', network: 'testnet', networkPassphrase: PASSPHRASE, ...over };
}

describe('soroswap pure helpers', () => {
  it('maps AssetRef to the canonical Soroban SAC contract id', () => {
    expect(assetContractId(XLM, PASSPHRASE)).toBe(Asset.native().contractId(PASSPHRASE));
    expect(assetContractId(USDC, PASSPHRASE)).toBe(new Asset('USDC', ISSUER).contractId(PASSPHRASE));
    // Matches the id the live Soroswap testnet token list publishes for XLM.
    expect(assetContractId(XLM, PASSPHRASE)).toBe('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC');
  });

  it('converts decimals to/from stroops without float error', () => {
    expect(toStroops('1')).toBe('10000000');
    expect(toStroops('100')).toBe('1000000000');
    expect(toStroops('0.1234567')).toBe('1234567');
    expect(toStroops('12.3456789')).toBe('123456789'); // full 7dp precision
    expect(fromStroops('10000000')).toBe('1.0000000');
    expect(fromStroops('1234567')).toBe('0.1234567');
    expect(fromStroops('0')).toBe('0.0000000');
  });

  it('rejects non-positive / over-precise amounts', () => {
    expect(() => toStroops('0')).toThrow();
    expect(() => toStroops('-1')).toThrow();
    expect(() => toStroops('1.12345678')).toThrow(); // 8dp
    expect(() => toStroops('abc')).toThrow();
  });

  it('picks the engine with the strictly larger receivable, ties/unusable prefer sdex', () => {
    expect(pickBestEngine('24.5', '25.0')).toBe('soroswap');
    expect(pickBestEngine('25.0', '24.5')).toBe('sdex');
    expect(pickBestEngine('24.5', '24.5')).toBe('sdex'); // tie → reliable native
    expect(pickBestEngine('24.5', null)).toBe('sdex'); // no aggregator quote
    expect(pickBestEngine('24.5', '0')).toBe('sdex'); // unusable
    expect(pickBestEngine('24.5', 'nope')).toBe('sdex');
  });
});

describe('fetchSoroswapQuote', () => {
  const args = { sendAsset: XLM, sendAmount: '100', destAsset: USDC };

  it('POSTs the quote with auth + normalized shape and parses amountOut (stroops → decimal)', async () => {
    const { impl, calls } = stub([{ body: { amountOut: '245000000', priceImpactPct: '0.10', platform: 'aggregator', routePlan: [] } }]);
    const quote = await fetchSoroswapQuote({ config: cfg({ fetchImpl: impl }), ...args });

    expect(quote).not.toBeNull();
    expect(quote!.amountOut).toBe('24.5000000');
    expect(quote!.amountOutStroops).toBe('245000000');
    expect(quote!.platform).toBe('aggregator');
    expect(quote!.priceImpactPct).toBe('0.10');

    const call = calls[0]!;
    expect(call.url).toBe('https://api.soroswap.finance/quote?network=testnet');
    expect(call.method).toBe('POST');
    expect(call.headers!.authorization).toBe('Bearer k_test');
    expect(call.body).toMatchObject({
      assetIn: Asset.native().contractId(PASSPHRASE),
      assetOut: new Asset('USDC', ISSUER).contractId(PASSPHRASE),
      amount: 1000000000,
      tradeType: 'EXACT_IN',
      protocols: DEFAULT_PROTOCOLS,
      slippageBps: 50,
    });
    // No fee unless both feeBps + referralId are set.
    expect((call.body as Record<string, unknown>).feeBps).toBeUndefined();
  });

  it('includes feeBps only when a referralId is also configured', async () => {
    const { impl, calls } = stub([{ body: { amountOut: '1' } }]);
    await fetchSoroswapQuote({ config: cfg({ fetchImpl: impl, feeBps: 50, referralId: FROM }), ...args });
    expect((calls[0]!.body as Record<string, unknown>).feeBps).toBe(50);
  });

  it('omits feeBps when referralId is missing (API would reject it)', async () => {
    const { impl, calls } = stub([{ body: { amountOut: '1' } }]);
    await fetchSoroswapQuote({ config: cfg({ fetchImpl: impl, feeBps: 50 }), ...args });
    expect((calls[0]!.body as Record<string, unknown>).feeBps).toBeUndefined();
  });

  it('returns null without an API key (never calls fetch)', async () => {
    const { impl, calls } = stub([{ body: { amountOut: '1' } }]);
    const quote = await fetchSoroswapQuote({ config: cfg({ fetchImpl: impl, apiKey: '' }), ...args });
    expect(quote).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('fails soft to null on non-2xx (403/428/500), empty route, malformed body, and network error', async () => {
    for (const r of [
      { ok: false, status: 403 },
      { ok: false, status: 428, body: { message: 'trustline required' } },
      { ok: false, status: 500 },
      { body: { amountOut: '0' } }, // zero liquidity
      { body: { amountOut: 245 } }, // wrong type
      { body: { nope: true } }, // missing field
      { throws: true },
    ]) {
      const { impl } = stub([r]);
      expect(await fetchSoroswapQuote({ config: cfg({ fetchImpl: impl }), ...args })).toBeNull();
    }
  });

  // Regression: the live API returns 201 (not 200) on a successful quote — so the
  // client must accept the whole 2xx range (`res.ok`), never gate on `=== 200`.
  // Verified live against a mainnet XLM→USDC quote.
  it('accepts a 201 Created quote (the live success status), not just 200', async () => {
    const { impl } = stub([{ ok: true, status: 201, body: { amountOut: '57027999', platform: 'aggregator' } }]);
    const quote = await fetchSoroswapQuote({ config: cfg({ fetchImpl: impl }), ...args });
    expect(quote).not.toBeNull();
    expect(quote!.amountOut).toBe('5.7027999');
    expect(quote!.platform).toBe('aggregator');
  });

  // Regression: on a network with no Soroswap liquidity (e.g. testnet) the API
  // returns 400 {"title":"No path found",...}, not a 2xx empty result. The client
  // must fail soft to null so the Swap screen falls back to the native SDEX engine.
  // Verified live against a testnet XLM→USDC quote (empty /protocols).
  it('fails soft to null on a 400 "No path found" (no-liquidity network)', async () => {
    const { impl } = stub([{ ok: false, status: 400, body: { title: 'No path found', detail: 'No path found', error: 'Quote Failed' } }]);
    expect(await fetchSoroswapQuote({ config: cfg({ fetchImpl: impl }), ...args })).toBeNull();
  });
});

describe('buildSoroswapSwapXdr', () => {
  const quote = {
    amountOut: '24.5000000',
    amountOutStroops: '245000000',
    priceImpactPct: null,
    platform: 'aggregator',
    raw: { assetIn: 'C_IN', assetOut: 'C_OUT', amountOut: '245000000', routePlan: [{ percent: '100' }] },
  };

  it('POSTs the raw quote + self-swap addresses and returns the built xdr', async () => {
    const { impl, calls } = stub([{ body: { xdr: 'AAAA_built_xdr' } }]);
    const xdr = await buildSoroswapSwapXdr({ config: cfg({ fetchImpl: impl }), quote, from: FROM });
    expect(xdr).toBe('AAAA_built_xdr');

    const call = calls[0]!;
    expect(call.url).toBe('https://api.soroswap.finance/quote/build?network=testnet');
    expect(call.headers!.authorization).toBe('Bearer k_test');
    expect(call.body).toMatchObject({ quote: quote.raw, from: FROM, to: FROM });
  });

  it('sends referralId only when feeBps + referralId are both set', async () => {
    const { impl, calls } = stub([{ body: { xdr: 'x' } }]);
    await buildSoroswapSwapXdr({ config: cfg({ fetchImpl: impl, feeBps: 50, referralId: FROM }), quote, from: FROM });
    expect((calls[0]!.body as Record<string, unknown>).referralId).toBe(FROM);

    const { impl: impl2, calls: calls2 } = stub([{ body: { xdr: 'x' } }]);
    await buildSoroswapSwapXdr({ config: cfg({ fetchImpl: impl2 }), quote, from: FROM });
    expect((calls2[0]!.body as Record<string, unknown>).referralId).toBeUndefined();
  });

  it('fails soft to null on 428 (needs trustline), non-2xx, missing xdr, and network error', async () => {
    for (const r of [
      { ok: false, status: 428, body: { action: 'trustline', actionData: { xdr: 'x' } } },
      { ok: false, status: 500 },
      { body: { hash: 'nope' } }, // no xdr field
      { body: { xdr: '' } },
      { throws: true },
    ]) {
      const { impl } = stub([r]);
      expect(await buildSoroswapSwapXdr({ config: cfg({ fetchImpl: impl }), quote, from: FROM })).toBeNull();
    }
  });

  it('returns null without an API key (never calls fetch)', async () => {
    const { impl, calls } = stub([{ body: { xdr: 'x' } }]);
    expect(await buildSoroswapSwapXdr({ config: cfg({ fetchImpl: impl, apiKey: '' }), quote, from: FROM })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
