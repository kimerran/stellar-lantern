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
  | {
      ok: true;
      minResourceFee: string;
      transactionData?: string;
      // Base64 `SorobanAuthorizationEntry` list the call requires — from the
      // simulation's `results[0].auth`. These must be attached to the invoke op
      // before signing (see `assembleInvokeXdr`); empty for calls that need no auth.
      auth?: string[];
      latestLedger?: number;
    }
  | { ok: false; error: string };

interface JsonRpcSimulateResponse {
  error?: { message?: unknown };
  result?: {
    error?: unknown;
    minResourceFee?: unknown;
    transactionData?: unknown;
    results?: unknown;
    latestLedger?: unknown;
  };
}

// Pull the base64 auth entries out of `result.results[0].auth`, defensively.
function parseAuth(results: unknown): string[] | undefined {
  if (!Array.isArray(results) || results.length === 0) return undefined;
  const first = results[0] as { auth?: unknown } | null;
  if (!first || !Array.isArray(first.auth)) return undefined;
  const auth = first.auth.filter((a): a is string => typeof a === 'string');
  return auth.length > 0 ? auth : undefined;
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

  const auth = parseAuth(result.results);
  return {
    ok: true,
    minResourceFee: result.minResourceFee,
    ...(typeof result.transactionData === 'string'
      ? { transactionData: result.transactionData }
      : {}),
    ...(auth ? { auth } : {}),
    ...(typeof result.latestLedger === 'number' && Number.isFinite(result.latestLedger)
      ? { latestLedger: result.latestLedger }
      : {}),
  };
}
