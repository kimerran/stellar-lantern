import { describe, it, expect } from 'vitest';
import { startInteractive, fetchTransaction, fetchSep24Info } from '@core/anchor/sep24';

const TRANSFER = 'https://anchor.example.com/sep24';
const ACCOUNT = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const JWT = 'jwt.abc.123';

// Minimal Response-like stub for an injected fetch that captures the request.
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

describe('startInteractive', () => {
  it('POSTs to the deposit interactive endpoint with the JWT and returns id + url', async () => {
    const { impl, calls } = jsonFetch({ id: 'tx-1', url: 'https://anchor.example.com/i/tx-1', type: 'interactive_customer_info_needed' });
    const r = await startInteractive(TRANSFER, { kind: 'deposit', assetCode: 'USDC', account: ACCOUNT, jwt: JWT }, impl);
    expect(calls[0]!.url).toBe('https://anchor.example.com/sep24/transactions/deposit/interactive');
    expect(calls[0]!.init?.method).toBe('POST');
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${JWT}`);
    expect(String(calls[0]!.init?.body)).toContain('USDC');
    expect(r).toEqual({ id: 'tx-1', url: 'https://anchor.example.com/i/tx-1', type: 'interactive_customer_info_needed' });
  });

  it('targets the withdraw endpoint for a withdraw and tolerates a trailing slash', async () => {
    const { impl, calls } = jsonFetch({ id: 'tx-2', url: 'https://x/i' });
    await startInteractive(`${TRANSFER}/`, { kind: 'withdraw', assetCode: 'USDC', account: ACCOUNT, jwt: JWT }, impl);
    expect(calls[0]!.url).toBe('https://anchor.example.com/sep24/transactions/withdraw/interactive');
  });

  it('throws on a non-2xx response and when no interactive URL comes back', async () => {
    const bad = jsonFetch({}, { ok: false, status: 403 });
    await expect(startInteractive(TRANSFER, { kind: 'deposit', assetCode: 'USDC', account: ACCOUNT, jwt: JWT }, bad.impl)).rejects.toThrow(/403/);
    const empty = jsonFetch({ id: 'tx-3' }); // missing url
    await expect(startInteractive(TRANSFER, { kind: 'deposit', assetCode: 'USDC', account: ACCOUNT, jwt: JWT }, empty.impl)).rejects.toThrow(/interactive URL/i);
  });

  it('rejects a non-https interactive URL (data:/javascript:/http:) — it gets hosted in an iframe in the wallet chrome', async () => {
    for (const url of [
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(document.cookie)',
      'http://anchor.example.com/i/tx', // plain http — SEP-24 mandates https
      'not-a-url',
    ]) {
      const { impl } = jsonFetch({ id: 'tx-1', url });
      await expect(
        startInteractive(TRANSFER, { kind: 'deposit', assetCode: 'USDC', account: ACCOUNT, jwt: JWT }, impl),
      ).rejects.toThrow(/https|invalid interactive URL/i);
    }
  });
});

describe('fetchTransaction', () => {
  it('GETs /transaction?id= with the JWT and maps the fields', async () => {
    const { impl, calls } = jsonFetch({
      transaction: { id: 'tx-1', status: 'completed', more_info_url: 'https://x/more', amount_in: '100', amount_out: '99' },
    });
    const t = await fetchTransaction(TRANSFER, 'tx-1', JWT, impl);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/sep24/transaction');
    expect(url.searchParams.get('id')).toBe('tx-1');
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${JWT}`);
    expect(t).toEqual({ id: 'tx-1', status: 'completed', moreInfoUrl: 'https://x/more', amountIn: '100', amountOut: '99' });
  });

  it('throws on a non-2xx response and on an unreadable transaction', async () => {
    const bad = jsonFetch({}, { ok: false, status: 404 });
    await expect(fetchTransaction(TRANSFER, 'tx-1', JWT, bad.impl)).rejects.toThrow(/404/);
    const empty = jsonFetch({ transaction: { id: 'tx-1' } }); // missing status
    await expect(fetchTransaction(TRANSFER, 'tx-1', JWT, empty.impl)).rejects.toThrow(/unreadable/i);
  });
});

describe('fetchSep24Info', () => {
  it('GETs /info (no auth) and maps deposit/withdraw assets, limits and fees, sorted by code', async () => {
    const { impl, calls } = jsonFetch({
      deposit: {
        USDC: { enabled: true, min_amount: 1, max_amount: 1000, fee_fixed: 0.5, fee_percent: 1 },
        native: { enabled: true },
      },
      withdraw: {
        USDC: { enabled: true, min_amount: 5 },
      },
      fee: { enabled: false },
    });
    const info = await fetchSep24Info(TRANSFER, impl);
    expect(calls[0]!.url).toBe('https://anchor.example.com/sep24/info');
    // /info is public — no Authorization header attached.
    expect((calls[0]!.init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
    // sorted by code: 'native' sorts before 'USDC' (localeCompare)
    expect(info.deposit).toEqual([
      { assetCode: 'native', enabled: true },
      { assetCode: 'USDC', enabled: true, minAmount: 1, maxAmount: 1000, feeFixed: 0.5, feePercent: 1 },
    ]);
    expect(info.withdraw).toEqual([{ assetCode: 'USDC', enabled: true, minAmount: 5 }]);
  });

  it('treats a missing `enabled` as enabled and an explicit false as disabled', async () => {
    const { impl } = jsonFetch({ deposit: { USDC: {}, ABC: { enabled: false } } });
    const info = await fetchSep24Info(TRANSFER, impl);
    // sorted: ABC before USDC
    expect(info.deposit).toEqual([
      { assetCode: 'ABC', enabled: false },
      { assetCode: 'USDC', enabled: true },
    ]);
    expect(info.withdraw).toEqual([]);
  });

  it('tolerates a trailing slash and a response missing deposit/withdraw', async () => {
    const { impl, calls } = jsonFetch({});
    const info = await fetchSep24Info(`${TRANSFER}/`, impl);
    expect(calls[0]!.url).toBe('https://anchor.example.com/sep24/info');
    expect(info).toEqual({ deposit: [], withdraw: [] });
  });

  it('throws on a non-2xx response', async () => {
    const bad = jsonFetch({}, { ok: false, status: 500 });
    await expect(fetchSep24Info(TRANSFER, bad.impl)).rejects.toThrow(/500/);
  });
});
