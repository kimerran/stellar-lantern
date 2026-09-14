// Soroban RPC `simulateTransaction` client for stage 1 (#52).
//
// The wallet already has a simulate client (src/core/stellar/soroban.ts) and
// its callers — prepareInvoke, passkey, Blend — are untouched by this file.
// The scanner needs its own because (a) the package has no import into the
// app and (b) the scanner wants the *raw* body, not the wallet's normalised
// subset: return value, footprint, events and restorePreamble all matter here.
//
// Posture: every call is bounded by a deadline; transient failures (network
// error, 5xx, 429, timeout) are retried with exponential backoff; when the
// network is simply unavailable the error says so honestly, so the verdict
// can distinguish "couldn't reach the RPC" from "the contract would fail".

import type { RawSimulation } from './types';

export type RpcFailureKind = 'timeout' | 'transport' | 'malformed';

export class RpcError extends Error {
  readonly kind: RpcFailureKind;
  readonly attempts: number;
  constructor(kind: RpcFailureKind, message: string, attempts: number) {
    super(message);
    this.name = 'RpcError';
    this.kind = kind;
    this.attempts = attempts;
  }
}

export interface RpcSimulateOptions {
  rpcUrl: string;
  fetchImpl?: typeof fetch;
  // Per-attempt deadline. Default 8 s: the public testnet endpoint answers a
  // simulate in well under a second when healthy; anything past this is a
  // stall, not a slow call.
  timeoutMs?: number;
  // Total attempts (first try + retries). Default 3.
  attempts?: number;
  // Backoff before retry n (1-based) is `backoffMs * 2^(n-1)`. Default 250 ms.
  backoffMs?: number;
  // Injectable so tests never sleep in real time.
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_RPC_TIMEOUT_MS = 8_000;
export const DEFAULT_RPC_ATTEMPTS = 3;
export const DEFAULT_RPC_BACKOFF_MS = 250;

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// One attempt. Throws RpcError('timeout' | 'transport') for retryable failures
// and RpcError('malformed') for a 2xx body that is not JSON.
async function attempt(
  xdr: string,
  opts: RpcSimulateOptions,
  timeoutMs: number,
  n: number,
): Promise<RawSimulation> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(opts.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'simulateTransaction',
        params: { transaction: xdr },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new RpcError('timeout', `Soroban RPC did not answer within ${timeoutMs}ms.`, n);
    }
    const msg = e instanceof Error ? e.message : 'network error';
    throw new RpcError('transport', `Soroban RPC unreachable: ${msg}`, n);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new RpcError('transport', `Soroban RPC responded ${res.status}.`, n);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new RpcError('malformed', 'Soroban RPC returned a non-JSON body.', n);
  }
  if (!body || typeof body !== 'object') {
    throw new RpcError('malformed', 'Soroban RPC returned a non-object body.', n);
  }
  return body as RawSimulation;
}

function retryable(e: unknown, status?: number): boolean {
  if (!(e instanceof RpcError)) return false;
  if (e.kind === 'timeout') return true;
  if (e.kind !== 'transport') return false;
  // Transport errors from a definite 4xx (other than 429) are not transient.
  return status === undefined || status === 429 || status >= 500;
}

// Run `simulateTransaction` with deadline + backoff and return the raw body.
// The body is *not* shape-checked here — `ingest` does that, so a fixture
// recorded from this call and one handed in directly go through one path.
export async function simulateWithRpc(
  xdr: string,
  opts: RpcSimulateOptions,
): Promise<RawSimulation> {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_RPC_ATTEMPTS);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  const backoffMs = opts.backoffMs ?? DEFAULT_RPC_BACKOFF_MS;
  const sleep = opts.sleep ?? realSleep;
  let last: unknown;
  let made = 0;
  for (let n = 1; n <= attempts; n += 1) {
    made = n;
    try {
      return await attempt(xdr, opts, timeoutMs, n);
    } catch (e) {
      last = e;
      const status = statusOf(e);
      if (n === attempts || !retryable(e, status)) break;
      await sleep(backoffMs * 2 ** (n - 1));
    }
  }
  if (last instanceof RpcError) {
    throw new RpcError(last.kind, last.message, made);
  }
  throw last;
}

function statusOf(e: unknown): number | undefined {
  if (!(e instanceof RpcError)) return undefined;
  const m = /responded (\d{3})\./.exec(e.message);
  return m ? Number(m[1]) : undefined;
}

// Convenience for PipelineDeps.simulate.
export function createRpcSimulator(
  opts: RpcSimulateOptions,
): (xdr: string) => Promise<RawSimulation> {
  return (xdr) => simulateWithRpc(xdr, opts);
}
