// Soroban RPC `simulateTransaction` — the "RPC-simulated invoke" primitive the
// Blend/Soroban integration (#21) needs. Given an already-built transaction XDR
// (a contract `invokeHostFunction`), it asks a Soroban RPC node to simulate the
// call and returns the resource-fee estimate + prepared transaction data, or the
// contract-level failure reason. Building the ScVals / invoke op is a separate,
// later step — here the INPUT is a finished XDR string.
//
// The network call is an injectable `fetch` (not `rpc.Server`) so the whole path
// is unit-testable offline, mirroring the SEP-1/SEP-24 clients. We POST the
// JSON-RPC 2.0 request ourselves.

// A sensible default so a testnet caller need not hardcode the URL, but
// `simulateTransaction` always takes `rpcUrl` explicitly.
export const SOROBAN_TESTNET_RPC = 'https://soroban-testnet.stellar.org';

export interface SimulateOptions {
  rpcUrl: string;
  fetchImpl?: typeof fetch;
}

// Normalized result of a simulation. `ok: true` means the RPC simulated the
// transaction and the contract call itself would succeed; `ok: false` carries a
// human-readable reason (either the simulate `result.error`, i.e. the contract
// would revert, or a JSON-RPC transport-level error).
export type SimulateResult =
  | { ok: true; minResourceFee: string; transactionData?: string; latestLedger?: number }
  | { ok: false; error: string };

interface JsonRpcSimulateResponse {
  error?: { message?: unknown };
  result?: {
    error?: unknown;
    minResourceFee?: unknown;
    transactionData?: unknown;
    latestLedger?: unknown;
  };
}

/**
 * Simulate an already-built Soroban transaction via a Soroban RPC node's
 * `simulateTransaction` JSON-RPC method. `txXdr` is a finished base64 transaction
 * envelope XDR (this module does not build ScVals or the invoke op). Returns a
 * normalized discriminated union:
 *  - success → `{ ok: true, minResourceFee, transactionData?, latestLedger? }`.
 *  - the contract would fail (simulate `result.error` set) → `{ ok: false, error }`.
 *  - a JSON-RPC top-level `error` → `{ ok: false, error }`.
 *  - a malformed / unreadable body → `{ ok: false, error: 'Unreadable simulation response.' }`.
 * A non-2xx HTTP response throws (mirrors the SEP clients). `fetchImpl` is
 * injectable for offline tests; defaults to the platform `fetch`.
 */
export async function simulateTransaction(
  txXdr: string,
  opts: SimulateOptions,
): Promise<SimulateResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(opts.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: { transaction: txXdr },
    }),
  });
  if (!res.ok) throw new Error(`Soroban RPC simulate failed (${res.status}).`);

  let body: JsonRpcSimulateResponse;
  try {
    body = (await res.json()) as JsonRpcSimulateResponse;
  } catch {
    return { ok: false, error: 'Unreadable simulation response.' };
  }
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Unreadable simulation response.' };
  }

  // JSON-RPC top-level error (bad request, method not found, …).
  if (body.error) {
    const msg = body.error.message;
    return { ok: false, error: typeof msg === 'string' && msg ? msg : 'Soroban RPC error.' };
  }

  const result = body.result;
  if (!result || typeof result !== 'object') {
    return { ok: false, error: 'Unreadable simulation response.' };
  }

  // The contract would fail: simulate returns a `result.error` string.
  if (typeof result.error === 'string' && result.error) {
    return { ok: false, error: result.error };
  }

  // Success requires a resource-fee estimate; without it the body is unusable.
  if (typeof result.minResourceFee !== 'string' || !result.minResourceFee) {
    return { ok: false, error: 'Unreadable simulation response.' };
  }

  return {
    ok: true,
    minResourceFee: result.minResourceFee,
    ...(typeof result.transactionData === 'string'
      ? { transactionData: result.transactionData }
      : {}),
    ...(typeof result.latestLedger === 'number' && Number.isFinite(result.latestLedger)
      ? { latestLedger: result.latestLedger }
      : {}),
  };
}
