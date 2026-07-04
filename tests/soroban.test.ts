import { describe, it, expect } from 'vitest';
import { simulateTransaction, SOROBAN_TESTNET_RPC } from '@core/stellar/soroban';

const RPC = 'https://soroban-testnet.stellar.org';
// A stand-in for an already-built transaction envelope XDR (this module never
// builds one — it only forwards the string to the RPC node).
const TX_XDR = 'AAAAAgAAAAA=';

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

// A fetch whose body cannot be parsed as JSON (mirrors a truncated/garbled body).
function badBodyFetch(init: { ok?: boolean; status?: number } = {}) {
  const impl = (() =>
    Promise.resolve({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    })) as unknown as typeof fetch;
  return { impl };
}

describe('simulateTransaction', () => {
  it('POSTs a JSON-RPC 2.0 simulateTransaction request and parses a success result', async () => {
    const { impl, calls } = jsonFetch({
      jsonrpc: '2.0',
      id: 1,
      result: {
        transactionData: 'AAAAB...soroban-data',
        minResourceFee: '12345',
        latestLedger: 987654,
      },
    });
    const r = await simulateTransaction(TX_XDR, { rpcUrl: RPC, fetchImpl: impl });

    expect(calls[0]!.url).toBe(RPC);
    expect(calls[0]!.init?.method).toBe('POST');
    expect((calls[0]!.init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    const sent = JSON.parse(String(calls[0]!.init?.body));
    expect(sent).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: { transaction: TX_XDR },
    });
    expect(r).toEqual({
      ok: true,
      minResourceFee: '12345',
      transactionData: 'AAAAB...soroban-data',
      latestLedger: 987654,
    });
  });

  it('returns ok:false with the reason when the contract would fail (result.error set)', async () => {
    const { impl } = jsonFetch({
      jsonrpc: '2.0',
      id: 1,
      result: {
        error: 'HostError: Error(Contract, #4) — insufficient balance',
        latestLedger: 100,
      },
    });
    const r = await simulateTransaction(TX_XDR, { rpcUrl: RPC, fetchImpl: impl });
    expect(r).toEqual({ ok: false, error: 'HostError: Error(Contract, #4) — insufficient balance' });
  });

  it('returns ok:false with the message on a JSON-RPC top-level error', async () => {
    const { impl } = jsonFetch({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602, message: 'Invalid params: could not parse transaction' },
    });
    const r = await simulateTransaction(TX_XDR, { rpcUrl: RPC, fetchImpl: impl });
    expect(r).toEqual({ ok: false, error: 'Invalid params: could not parse transaction' });
  });

  it('throws on a non-2xx HTTP response, including the status', async () => {
    const { impl } = jsonFetch({}, { ok: false, status: 502 });
    await expect(
      simulateTransaction(TX_XDR, { rpcUrl: RPC, fetchImpl: impl }),
    ).rejects.toThrow(/502/);
  });

  it('degrades to an unreadable-response result on a malformed body', async () => {
    const { impl } = badBodyFetch();
    const r = await simulateTransaction(TX_XDR, { rpcUrl: RPC, fetchImpl: impl });
    expect(r).toEqual({ ok: false, error: 'Unreadable simulation response.' });

    // A well-formed JSON body that is missing both result and error is also
    // treated as unreadable rather than a spurious success.
    const empty = jsonFetch({ jsonrpc: '2.0', id: 1 });
    const r2 = await simulateTransaction(TX_XDR, { rpcUrl: RPC, fetchImpl: empty.impl });
    expect(r2).toEqual({ ok: false, error: 'Unreadable simulation response.' });
  });

  it('exposes a default testnet RPC constant', () => {
    expect(SOROBAN_TESTNET_RPC).toBe('https://soroban-testnet.stellar.org');
  });
});
