import { describe, it, expect, vi } from 'vitest';
import { xdr } from '@stellar/stellar-sdk';
import {
  ingest,
  runPipeline,
  simulateWithRpc,
  createRpcSimulator,
  RpcError,
  type IngestFailure,
  type RawSimulation,
  type ScanRequest,
} from '@lantern/scanner';

// Stage 1 — Ingest (#52). Every test here runs offline: the RPC is a stubbed
// `fetch`, time is a fake clock, and the successful bodies are the recordings
// in packages/lantern-scanner/fixtures/.

interface Fixture {
  name: string;
  networkPassphrase: string;
  source: string;
  xdr: string;
  simulation: RawSimulation | null;
}
const ON_DISK = import.meta.glob<Fixture>('../packages/lantern-scanner/fixtures/*.json', {
  eager: true,
  import: 'default',
});
function fixture(name: string): Fixture {
  const f = Object.entries(ON_DISK).find(([p]) => p.endsWith(`/${name}.json`))?.[1];
  if (!f) throw new Error(`no fixture ${name}`);
  return f;
}
function requestFor(f: Fixture): ScanRequest {
  return {
    xdr: f.xdr,
    networkPassphrase: f.networkPassphrase,
    context: { network: 'TESTNET', fromAddress: f.source, destinationFunded: true },
  };
}

const RPC = 'https://rpc.invalid/';
type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
// A sleep that records what it was asked for and never actually waits.
function fakeSleep() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

// ── Normalised shape ─────────────────────────────────────────────────────────
describe('ingest: normalised simulation', () => {
  it('surfaces return value, auth, footprint, events and latestLedger from a real recording', async () => {
    const f = fixture('sac-transfer');
    const sim = await ingest(requestFor(f), { simulate: async () => f.simulation! });
    expect(sim.ok).toBe(true);
    expect(sim.outcome).toBe('ok');
    expect(sim.failure).toBeUndefined();
    expect(sim.auth).toHaveLength(1);
    expect(typeof sim.returnValue).toBe('string');
    // SAC transfer returns void.
    expect(xdr.ScVal.fromXDR(sim.returnValue!, 'base64').switch().name).toBe('scvVoid');
    // Footprint keys are real LedgerKey XDR: 1 read-only, 2 read-write for a transfer.
    expect(sim.footprint.readOnly).toHaveLength(1);
    expect(sim.footprint.readWrite).toHaveLength(2);
    for (const k of [...sim.footprint.readOnly, ...sim.footprint.readWrite]) {
      expect(() => xdr.LedgerKey.fromXDR(k, 'base64')).not.toThrow();
    }
    expect(sim.events).toHaveLength(3);
    for (const ev of sim.events) {
      expect(() => xdr.DiagnosticEvent.fromXDR(ev, 'base64')).not.toThrow();
    }
    expect(typeof sim.latestLedger).toBe('number');
    expect(sim.restorePreamble).toBeUndefined();
  });

  it('keeps the nested case’s auth entries and footprint together', async () => {
    const f = fixture('nested-subinvocation');
    const sim = await ingest(requestFor(f), { simulate: async () => f.simulation! });
    expect(sim.ok).toBe(true);
    expect(sim.auth.length).toBeGreaterThan(0);
    expect(sim.footprint.readWrite.length).toBeGreaterThan(0);
  });

  it('a classic tx has an empty footprint and no events without simulating', async () => {
    const sim = await ingest(requestFor(fixture('classic-payment')));
    expect(sim).toMatchObject({
      ok: true,
      outcome: 'ok',
      simulated: false,
      footprint: { readOnly: [], readWrite: [] },
      events: [],
    });
  });
});

// ── restorePreamble: the third answer ────────────────────────────────────────
describe('ingest: archived state', () => {
  it('a simulation carrying restorePreamble is unknown, not ok', async () => {
    const f = fixture('archived-state');
    const sim = await ingest(requestFor(f), { simulate: async () => f.simulation! });
    expect(sim.ok).toBe(false);
    expect(sim.outcome).toBe('unknown');
    expect(sim.failure).toBeUndefined();
    expect(sim.restorePreamble?.minResourceFee).toBe('123456');
    // The rest of the body is still normalised so a caller can build the restore.
    expect(sim.auth).toHaveLength(1);
    expect(sim.footprint.readWrite).toHaveLength(2);
  });

  it('never produces a clean verdict', async () => {
    const f = fixture('archived-state');
    const result = await runPipeline(requestFor(f), { simulate: async () => f.simulation! });
    expect(result.risk).toBe('high');
    expect(result.action).toBe('block_confirm');
    expect(result.reasons.map((r) => r.code)).toContain('state_archived');
    expect(result.signals.find((s) => s.stage === 'ingest')?.code).toBe('unknown');
  });

  it('an unreadable restorePreamble is malformed, not silently ok', async () => {
    const f = fixture('sac-transfer');
    const body: RawSimulation = {
      ...f.simulation!,
      result: { ...f.simulation!.result, restorePreamble: { minResourceFee: 5 } },
    };
    const sim = await ingest(requestFor(f), { simulate: async () => body });
    expect(sim.outcome).toBe('failed');
    expect(sim.failure).toBe('simulation_malformed');
  });
});

// ── Every failure mode, asserted per mode ────────────────────────────────────
describe('ingest: fail closed, per mode', () => {
  const good = () => fixture('sac-transfer');

  const MODES: Array<{
    mode: IngestFailure;
    reason: string;
    fixtureName: string;
    simulate?: (xdr: string) => Promise<RawSimulation>;
  }> = [
    { mode: 'undecodable', reason: 'undecodable', fixtureName: 'malformed-xdr' },
    {
      mode: 'simulation_unavailable',
      reason: 'simulation_unavailable',
      fixtureName: 'sac-transfer',
    },
    {
      mode: 'rpc_timeout',
      reason: 'rpc_timeout',
      fixtureName: 'sac-transfer',
      simulate: async () => {
        throw new RpcError('timeout', 'Soroban RPC did not answer within 8000ms.', 3);
      },
    },
    {
      mode: 'rpc_transport',
      reason: 'rpc_unreachable',
      fixtureName: 'sac-transfer',
      simulate: async () => {
        throw new RpcError('transport', 'Soroban RPC responded 500.', 3);
      },
    },
    {
      mode: 'simulation_malformed',
      reason: 'simulation_malformed',
      fixtureName: 'sac-transfer',
      // A JSON-RPC-level error object: the RPC was reached, so it is malformed, not transport.
      simulate: async () => ({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'bad request' },
      }),
    },
    {
      mode: 'simulation_malformed',
      reason: 'simulation_malformed',
      fixtureName: 'sac-transfer',
      simulate: async () => ({ jsonrpc: '2.0', id: 1, result: { results: [] } }),
    },
    {
      mode: 'simulation_malformed',
      reason: 'simulation_malformed',
      fixtureName: 'sac-transfer',
      simulate: async () => ({
        ...good().simulation!,
        result: { ...good().simulation!.result, transactionData: 'bm90LXhkcg==' },
      }),
    },
    {
      mode: 'simulation_reverted',
      reason: 'simulation_reverted',
      fixtureName: 'unknown-contract',
      simulate: async () => fixture('unknown-contract').simulation!,
    },
  ];

  for (const { mode, reason, fixtureName, simulate } of MODES) {
    it(`${mode} (${reason}) → high / block_confirm`, async () => {
      const request = requestFor(fixture(fixtureName));
      const deps = simulate ? { simulate } : {};
      const sim = await ingest(request, deps);
      expect(sim.ok).toBe(false);
      expect(sim.outcome).toBe('failed');
      expect(sim.failure).toBe(mode);
      const result = await runPipeline(request, deps);
      expect(result.risk).toBe('high');
      expect(result.action).toBe('block_confirm');
      const hit = result.reasons.find((r) => r.code === reason);
      expect(hit?.severity).toBe('high');
      expect(result.signals.find((s) => s.stage === 'ingest')?.code).toBe('fail_closed');
    });
  }

  it('a non-RpcError thrown by the simulate dependency is treated as unreachable', async () => {
    const sim = await ingest(requestFor(good()), {
      simulate: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(sim.failure).toBe('rpc_transport');
    expect(sim.error).toBe('ECONNRESET');
  });
});

// ── The RPC client: deadline + backoff, no real time ─────────────────────────
describe('simulateWithRpc', () => {
  it('posts a simulateTransaction JSON-RPC request and returns the raw body', async () => {
    const f = fixture('sac-transfer');
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: FetchStub = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return jsonResponse(f.simulation);
    };
    const raw = await simulateWithRpc(f.xdr, { rpcUrl: RPC, fetchImpl, sleep: fakeSleep().sleep });
    expect(raw).toEqual(f.simulation);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      jsonrpc: '2.0',
      method: 'simulateTransaction',
      params: { transaction: f.xdr },
    });
  });

  it('retries a 500 with exponential backoff, then succeeds', async () => {
    const f = fixture('sac-transfer');
    const { waits, sleep } = fakeSleep();
    let n = 0;
    const fetchImpl: FetchStub = async () =>
      ++n < 3 ? jsonResponse({}, 500) : jsonResponse(f.simulation);
    const raw = await simulateWithRpc(f.xdr, {
      rpcUrl: RPC,
      fetchImpl,
      sleep,
      attempts: 3,
      backoffMs: 100,
    });
    expect(raw).toEqual(f.simulation);
    expect(n).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it('gives up after the configured attempts with a transport error that says so', async () => {
    const { waits, sleep } = fakeSleep();
    let n = 0;
    const fetchImpl: FetchStub = async () => {
      n += 1;
      throw new TypeError('fetch failed');
    };
    const err = await simulateWithRpc('AAAA', {
      rpcUrl: RPC,
      fetchImpl,
      sleep,
      attempts: 4,
      backoffMs: 10,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).kind).toBe('transport');
    expect((err as RpcError).attempts).toBe(4);
    expect((err as RpcError).message).toMatch(/unreachable/);
    expect(n).toBe(4);
    expect(waits).toEqual([10, 20, 40]);
  });

  it('times out an attempt that never answers, using a fake clock', async () => {
    vi.useFakeTimers();
    try {
      const { sleep } = fakeSleep();
      let n = 0;
      // Honour the abort signal the way real fetch does: reject when aborted.
      const fetchImpl: FetchStub = (_url, init) =>
        new Promise((_resolve, reject) => {
          n += 1;
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        });
      const pending = simulateWithRpc('AAAA', {
        rpcUrl: RPC,
        fetchImpl,
        sleep,
        timeoutMs: 1_000,
        attempts: 2,
        backoffMs: 1,
      }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(2_500);
      const err = await pending;
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).kind).toBe('timeout');
      expect((err as RpcError).attempts).toBe(2);
      expect(n).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a definite client error', async () => {
    const { waits, sleep } = fakeSleep();
    let n = 0;
    const fetchImpl: FetchStub = async () => {
      n += 1;
      return jsonResponse({}, 400);
    };
    const err = await simulateWithRpc('AAAA', { rpcUrl: RPC, fetchImpl, sleep }).catch(
      (e: unknown) => e,
    );
    expect((err as RpcError).kind).toBe('transport');
    expect((err as RpcError).attempts).toBe(1);
    expect(n).toBe(1);
    expect(waits).toEqual([]);
  });

  it('a 2xx non-JSON body is malformed and not retried', async () => {
    const { sleep } = fakeSleep();
    let n = 0;
    const fetchImpl: FetchStub = async () => {
      n += 1;
      return new Response('<html>rate limited</html>', { status: 200 });
    };
    const err = await simulateWithRpc('AAAA', { rpcUrl: RPC, fetchImpl, sleep }).catch(
      (e: unknown) => e,
    );
    expect((err as RpcError).kind).toBe('malformed');
    expect((err as RpcError).attempts).toBe(1);
    expect(n).toBe(1);
  });

  it('createRpcSimulator plugs straight into the pipeline and its failures become ingest reasons', async () => {
    const f = fixture('sac-transfer');
    const { sleep } = fakeSleep();
    const fetchImpl: FetchStub = async () => jsonResponse({}, 503);
    const result = await runPipeline(requestFor(f), {
      simulate: createRpcSimulator({ rpcUrl: RPC, fetchImpl, sleep, attempts: 2, backoffMs: 1 }),
    });
    expect(result.risk).toBe('high');
    expect(result.reasons.map((r) => r.code)).toContain('rpc_unreachable');
    expect(result.simulation.failure).toBe('rpc_transport');
  });
});
