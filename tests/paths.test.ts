import { describe, it, expect } from 'vitest';
import { fetchStrictSendPaths } from '@core/stellar/paths';
import type { AssetRef } from '@core/stellar/tx';

const HORIZON = 'https://horizon-testnet.stellar.org';
const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const XLM: AssetRef = { isNative: true };
const USDC: AssetRef = { isNative: false, code: 'USDC', issuer: ISSUER };

// A fetch stub that records the requested URL and returns a fixed JSON body.
function stub(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const urls: string[] = [];
  const impl = ((url: string) => {
    urls.push(url);
    return Promise.resolve({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: () => Promise.resolve(body),
    });
  }) as unknown as typeof fetch;
  return { impl, urls };
}

const embedded = (records: unknown[]) => ({ _embedded: { records } });

describe('fetchStrictSendPaths', () => {
  it('returns the best (highest) destination_amount and its path', async () => {
    const { impl } = stub(
      embedded([
        { destination_amount: '24.1000000', path: [] },
        { destination_amount: '24.5000000', path: [{ asset_type: 'native' }] },
        { destination_amount: '23.9000000', path: [] },
      ]),
    );
    const q = await fetchStrictSendPaths({ horizonUrl: HORIZON, sendAsset: XLM, sendAmount: '100', destAsset: USDC, fetchImpl: impl });
    expect(q).toEqual({ destAmount: '24.5000000', path: [{ isNative: true }] });
  });

  it('maps an issued asset in the path to an AssetRef', async () => {
    const { impl } = stub(
      embedded([
        { destination_amount: '10', path: [{ asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: ISSUER }] },
      ]),
    );
    const q = await fetchStrictSendPaths({ horizonUrl: HORIZON, sendAsset: XLM, sendAmount: '50', destAsset: USDC, fetchImpl: impl });
    expect(q?.path).toEqual([{ isNative: false, code: 'USDC', issuer: ISSUER }]);
  });

  it('encodes the send asset + destination_assets in the query', async () => {
    const { impl, urls } = stub(embedded([{ destination_amount: '1', path: [] }]));
    await fetchStrictSendPaths({ horizonUrl: HORIZON, sendAsset: USDC, sendAmount: '5', destAsset: XLM, fetchImpl: impl });
    const url = urls[0]!;
    expect(url).toContain('/paths/strict-send?');
    expect(url).toContain('source_asset_type=credit_alphanum4');
    expect(url).toContain('source_asset_code=USDC');
    expect(url).toContain(`source_asset_issuer=${ISSUER}`);
    expect(url).toContain('source_amount=5');
    expect(url).toContain('destination_assets=native');
  });

  it('returns null when there is no route (zero liquidity)', async () => {
    const { impl } = stub(embedded([]));
    const q = await fetchStrictSendPaths({ horizonUrl: HORIZON, sendAsset: XLM, sendAmount: '100', destAsset: USDC, fetchImpl: impl });
    expect(q).toBeNull();
  });

  it('throws on a non-2xx response', async () => {
    const { impl } = stub({}, { ok: false, status: 400 });
    await expect(
      fetchStrictSendPaths({ horizonUrl: HORIZON, sendAsset: XLM, sendAmount: '100', destAsset: USDC, fetchImpl: impl }),
    ).rejects.toThrow(/400/);
  });
});
