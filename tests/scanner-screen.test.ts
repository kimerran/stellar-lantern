import { describe, it, expect, vi } from 'vitest';
import { xdr } from '@stellar/stellar-sdk';
import {
  auth,
  buildVerdict,
  effects,
  ingest,
  screen,
  runPipeline,
  entryLedgerKey,
  decodeEntry,
  interpretLedgerEntries,
  createRegistryScreener,
  TESTNET_REGISTRY_ID,
  type RawLedgerEntriesBody,
  type RawSimulation,
  type ScanRequest,
  type ScreenAnswer,
} from '@lantern/scanner';
import { entryLedgerKey as scriptEntryLedgerKey } from '../scripts/hot-read-blacklist-registry.mjs';
import doc from '../docs/blacklist-registry.md?raw';

// Stage 4 — Screen against the D1 registry (#57). Offline: the recorded
// getLedgerEntries body for a live Active entry, synthetic Disputed / Revoked
// / archived variants patched from it, a stubbed fetch, and a fake clock.

interface Fixture {
  name: string;
  networkPassphrase: string;
  source: string;
  xdr: string;
  simulation: RawSimulation | null;
}
interface RegistryFixture {
  registry: string;
  subjects: { flagged: string; clean: string };
  keys: { flagged: string; clean: string };
  response: RawLedgerEntriesBody & {
    result: {
      entries: Array<{ key: string; xdr: string; liveUntilLedgerSeq: number }>;
      latestLedger: number;
    };
  };
}
const ON_DISK = import.meta.glob<Fixture | RegistryFixture>(
  '../packages/lantern-scanner/fixtures/*.json',
  {
    eager: true,
    import: 'default',
  },
);
function fixture(name: string): Fixture {
  const f = Object.entries(ON_DISK).find(([p]) => p.endsWith(`/${name}.json`))?.[1];
  if (!f || !('xdr' in f)) throw new Error(`no fixture ${name}`);
  return f;
}
const REG = Object.entries(ON_DISK).find(([p]) =>
  p.endsWith('/registry-hot-read.json'),
)![1] as RegistryFixture;
const FLAGGED = REG.subjects.flagged;
const CLEAN = REG.subjects.clean;
const RPC = 'https://rpc.invalid/';

function requestFor(f: Fixture): ScanRequest {
  return {
    xdr: f.xdr,
    networkPassphrase: f.networkPassphrase,
    context: { network: 'TESTNET', fromAddress: f.source, destinationFunded: true },
  };
}
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Re-encode the recorded Active entry with a different status / liveUntil.
function patched(
  status: 'Active' | 'Disputed' | 'Revoked',
  liveUntil?: number,
): RegistryFixture['response'] {
  const live = REG.response.result.entries[0]!;
  const data = xdr.LedgerEntryData.fromXDR(live.xdr, 'base64');
  const cd = data.contractData();
  const map = cd
    .val()
    .map()!
    .map((m) =>
      m.key().sym().toString() === 'status'
        ? new xdr.ScMapEntry({ key: m.key(), val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(status)]) })
        : m,
    );
  const val = xdr.ScVal.scvMap(map);
  const rebuilt = xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: cd.ext(),
      contract: cd.contract(),
      key: cd.key(),
      durability: cd.durability(),
      val,
    }),
  ).toXDR('base64');
  return {
    ...REG.response,
    result: {
      ...REG.response.result,
      entries: [
        { ...live, xdr: rebuilt, liveUntilLedgerSeq: liveUntil ?? live.liveUntilLedgerSeq },
      ],
    },
  };
}

// A fetch that answers every getLedgerEntries with `body`, counting calls.
function registryFetch(body: unknown, status = 200) {
  const calls: string[][] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const req = JSON.parse(String(init?.body)) as { method: string; params: { keys: string[] } };
    expect(req.method).toBe('getLedgerEntries');
    calls.push(req.params.keys);
    return jsonResponse(body, status);
  };
  return { calls, fetchImpl };
}

// ── Hot read: one implementation, pinned to the doc and the script ───────────
describe('registry hot read', () => {
  it('derives the same ledger key as the script and the doc’s worked example', () => {
    const section = doc.split('### Worked example')[1]?.split('\n## ')[0] ?? '';
    const contract = /Contract `(C[A-Z2-7]{55})`/.exec(section)?.[1]!;
    const subject = /subject `(G[A-Z2-7]{55})`/.exec(section)?.[1]!;
    const published = /```\n([A-Za-z0-9+/=\n]+?)\n```/.exec(section)?.[1]?.replace(/\n/g, '')!;
    expect(entryLedgerKey(contract, subject)).toBe(published);
    expect(entryLedgerKey(contract, subject)).toBe(
      scriptEntryLedgerKey(contract, subject).toXDR('base64'),
    );
    expect(TESTNET_REGISTRY_ID).toBe(contract);
    // And the recording was made against that same deployment.
    expect(REG.registry).toBe(contract);
    expect(entryLedgerKey(REG.registry, FLAGGED)).toBe(REG.keys.flagged);
  });

  it('decodes the recorded Active entry: reporter, reason, report count', () => {
    const live = REG.response.result.entries[0]!;
    const entry = decodeEntry(xdr.LedgerEntryData.fromXDR(live.xdr, 'base64').contractData().val());
    expect(entry).toMatchObject({
      subject: FLAGGED,
      reporter: 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK',
      reason: 'Scam',
      status: 'Active',
      index: 0,
    });
    expect(entry.reports).toBeGreaterThanOrEqual(1);
    expect(entry.evidence).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.reportedAt).toBeGreaterThan(1_700_000_000);
  });

  it('refuses a stale entry shape instead of guessing at it', () => {
    const live = REG.response.result.entries[0]!;
    const val = xdr.LedgerEntryData.fromXDR(live.xdr, 'base64').contractData().val();
    const without = xdr.ScVal.scvMap(
      val.map()!.filter((m) => m.key().sym().toString() !== 'index'),
    );
    expect(() => decodeEntry(without)).toThrow(/index/);
  });
});

// ── Three outcomes ───────────────────────────────────────────────────────────
describe('interpretLedgerEntries', () => {
  it('a live Active entry is flagged, with the entry attached (recorded)', () => {
    const a = interpretLedgerEntries(REG.response, REG.keys.flagged);
    expect(a.outcome).toBe('flagged');
    expect(a.entry?.reason).toBe('Scam');
    expect(a.source).toBe('registry');
  });

  it('a never-reported address is not flagged, with no error (recorded)', () => {
    expect(interpretLedgerEntries(REG.response, REG.keys.clean)).toEqual({
      outcome: 'not_flagged',
      source: 'registry',
    });
  });

  it('Disputed and Revoked entries are not flagged but remain readable', () => {
    for (const status of ['Disputed', 'Revoked'] as const) {
      const a = interpretLedgerEntries(patched(status), REG.keys.flagged);
      expect(a.outcome).toBe('not_flagged');
      expect(a.entry?.status).toBe(status);
      expect(a.entry?.reports).toBeGreaterThanOrEqual(1);
    }
  });

  it('an archived entry (liveUntil behind latestLedger, or zero) is unknown, never clean', () => {
    const behind = interpretLedgerEntries(
      patched('Active', REG.response.result.latestLedger - 1),
      REG.keys.flagged,
    );
    expect(behind).toMatchObject({ outcome: 'unknown', reason: 'archived' });
    expect(behind.entry?.status).toBe('Active');
    const zero = interpretLedgerEntries(patched('Active', 0), REG.keys.flagged);
    expect(zero).toMatchObject({ outcome: 'unknown', reason: 'archived' });
  });

  it('an RPC-level error or a malformed body is unknown', () => {
    expect(interpretLedgerEntries({ error: { message: 'boom' } }, REG.keys.flagged)).toMatchObject({
      outcome: 'unknown',
      reason: 'rpc_error',
    });
    expect(interpretLedgerEntries({ result: { entries: 'nope' } }, REG.keys.flagged)).toMatchObject(
      {
        outcome: 'unknown',
        reason: 'malformed',
      },
    );
    const garbage = {
      ...REG.response,
      result: { ...REG.response.result, entries: [{ key: REG.keys.flagged, xdr: 'AAAA' }] },
    };
    expect(interpretLedgerEntries(garbage, REG.keys.flagged)).toMatchObject({
      outcome: 'unknown',
      reason: 'malformed',
    });
  });
});

// ── The live screener: RPC, timeout, TTL cache ───────────────────────────────
describe('createRegistryScreener', () => {
  it('posts the derived key and answers from the body', async () => {
    const { calls, fetchImpl } = registryFetch(REG.response);
    const lookup = createRegistryScreener({ rpcUrl: RPC, fetchImpl });
    expect((await lookup(FLAGGED)).outcome).toBe('flagged');
    expect((await lookup(CLEAN)).outcome).toBe('not_flagged');
    expect(calls).toEqual([[REG.keys.flagged], [REG.keys.clean]]);
  });

  it('TTL cache: two scans within the TTL make one network call; after it, two', async () => {
    let t = 1_000_000;
    const { calls, fetchImpl } = registryFetch(REG.response);
    const lookup = createRegistryScreener({ rpcUrl: RPC, fetchImpl, ttlMs: 60_000, now: () => t });
    const f = fixture('classic-payment');
    const request = requestFor(f);
    const sim = await ingest(request);
    const set = effects(sim, auth(sim), request);
    await screen(set, request, { screen: lookup });
    await screen(set, request, { screen: lookup });
    expect(calls).toHaveLength(1);
    t += 60_001;
    await screen(set, request, { screen: lookup });
    expect(calls).toHaveLength(2);
  });

  it('shares an in-flight lookup and does not cache unknown answers', async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async () => {
      n += 1;
      return jsonResponse({}, n === 1 ? 503 : 200);
    };
    const lookup = createRegistryScreener({ rpcUrl: RPC, fetchImpl });
    const [a, b] = await Promise.all([lookup(CLEAN), lookup(CLEAN)]);
    expect(a).toEqual(b);
    expect(a.outcome).toBe('unknown');
    expect(n).toBe(1);
    // The failure was not cached: the next call goes back to the network.
    await lookup(CLEAN);
    expect(n).toBe(2);
  });

  it('RPC error → unknown (rpc_error)', async () => {
    const { fetchImpl } = registryFetch({}, 500);
    expect(await createRegistryScreener({ rpcUrl: RPC, fetchImpl })(FLAGGED)).toMatchObject({
      outcome: 'unknown',
      reason: 'rpc_error',
    });
    const throws = createRegistryScreener({
      rpcUrl: RPC,
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(await throws(FLAGGED)).toMatchObject({ outcome: 'unknown', reason: 'rpc_error' });
  });

  it('timeout → unknown (timeout), on a fake clock', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl: typeof fetch = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        });
      const pending = createRegistryScreener({ rpcUrl: RPC, fetchImpl, timeoutMs: 1_000 })(FLAGGED);
      await vi.advanceTimersByTimeAsync(1_500);
      expect(await pending).toMatchObject({ outcome: 'unknown', reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('archived → unknown (archived) through the screener too', async () => {
    const { fetchImpl } = registryFetch(patched('Active', 0));
    expect(await createRegistryScreener({ rpcUrl: RPC, fetchImpl })(FLAGGED)).toMatchObject({
      outcome: 'unknown',
      reason: 'archived',
    });
  });
});

// ── In the pipeline ──────────────────────────────────────────────────────────
describe('screen stage', () => {
  const answering =
    (table: Record<string, ScreenAnswer>) =>
    async (address: string): Promise<ScreenAnswer> =>
      table[address] ?? { outcome: 'not_flagged', source: 'registry' };

  it('a reported address is flagged, with reporter / reason / count in the verdict copy', async () => {
    const { fetchImpl } = registryFetch(REG.response);
    const f = fixture('classic-payment');
    // Point the payment at the flagged address by screening a patched effect set.
    const request = requestFor(f);
    const sim = await ingest(request);
    const set = effects(sim, auth(sim), request);
    set.effects[0]!.counterparty = FLAGGED;
    const res = await screen(set, request, {
      screen: createRegistryScreener({ rpcUrl: RPC, fetchImpl }),
    });
    expect(res.outcome).toBe('flagged');
    expect(res.hits[0]).toMatchObject({
      address: FLAGGED,
      source: 'registry',
      entry: { reason: 'Scam' },
    });
    expect(
      res.answers.find((a) => a.address === FLAGGED)?.answer.entry?.reports,
    ).toBeGreaterThanOrEqual(1);
  });

  it('a muxed destination (M…) is screened as its base G…, so a flagged account cannot hide in a mux', async () => {
    const { Account, Asset, BASE_FEE, MuxedAccount, Networks, Operation, TransactionBuilder } =
      await import('@stellar/stellar-sdk');
    const muxed = new MuxedAccount(new Account(FLAGGED, '0'), '7').accountId();
    expect(muxed.startsWith('M')).toBe(true);
    const f = fixture('classic-payment');
    const xdrB64 = new TransactionBuilder(new Account(f.source, '1'), {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({ destination: muxed, asset: Asset.native(), amount: '1' }))
      .setTimeout(0)
      .build()
      .toXDR();
    const request: ScanRequest = { ...requestFor(f), xdr: xdrB64 };
    const sim = await ingest(request);
    const set = effects(sim, auth(sim), request);
    const { calls, fetchImpl } = registryFetch(REG.response);
    const res = await screen(set, request, {
      screen: createRegistryScreener({ rpcUrl: RPC, fetchImpl }),
    });
    expect(res.checked).toEqual([FLAGGED]);
    expect(calls).toEqual([[REG.keys.flagged]]);
    expect(res.outcome).toBe('flagged');
    const v = buildVerdict({
      request,
      simulation: sim,
      auth: auth(sim),
      effects: set,
      screen: res,
    });
    expect(v.reasons.map((r) => r.code)).toContain('reported_address');
    expect(v.risk).toBe('high');
  });

  it('every counterparty in a multi-recipient transaction is screened, plus contracts touched', async () => {
    const f = fixture('deep-auth');
    const seen: string[] = [];
    const result = await runPipeline(requestFor(f), {
      simulate: async () => f.simulation!,
      screen: async (a) => {
        seen.push(a);
        return { outcome: 'not_flagged', source: 'registry' };
      },
    });
    const SPENDER = 'GBVG3DQJNAYAPTB4FKPLL65BUNF76K2TKPTK72LDIAJKRATGRY5BFJBP';
    for (const must of [
      SPENDER, // depth-2 transfer recipient and approval spender
      'CC4KSBTTPCKZUYBXB47SSZGXTKO6G23Y6LJOIR6YCOJVTGJZEYJCHBOH',
      'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU',
    ]) {
      expect(result.screen.checked).toContain(must);
    }
    expect(result.screen.checked).not.toContain(f.source); // the signer is not a counterparty
    expect(new Set(seen).size).toBe(seen.length); // each address looked up once
    expect(result.screen.outcome).toBe('clean');
  });

  it('a three-op transaction screens each distinct recipient once, never the signer', async () => {
    // Ops: 25 XLM → DEST, 1.5 USDC → DEST, 0.5 XLM from OTHER → SOURCE (the signer).
    const f = fixture('classic-multi-op');
    const seen: string[] = [];
    const result = await runPipeline(requestFor(f), {
      screen: async (a) => {
        seen.push(a);
        return { outcome: 'not_flagged', source: 'registry' };
      },
    });
    expect(result.screen.checked).toEqual([
      'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
    ]);
    expect(seen).toEqual(result.screen.checked);
  });

  it('unknown never yields low: archived, RPC error and timeout, each on its own', async () => {
    const f = fixture('classic-payment');
    for (const reason of ['archived', 'rpc_error', 'timeout']) {
      const result = await runPipeline(requestFor(f), {
        screen: async () => ({ outcome: 'unknown', reason, source: 'registry' }),
      });
      expect(result.screen.outcome).toBe('unknown');
      expect(result.screen.unknown[0]?.reason).toBe(reason);
      expect(result.risk).not.toBe('low');
      expect(result.action).not.toBe('allow');
      expect(result.reasons.map((r) => r.code)).toContain('screen_unknown');
    }
  });

  it('Disputed / Revoked stay clean in the pipeline while the entry is visible in answers', async () => {
    const f = fixture('classic-payment');
    const request = requestFor(f);
    const sim = await ingest(request);
    const set = effects(sim, auth(sim), request);
    set.effects[0]!.counterparty = FLAGGED;
    const { fetchImpl } = registryFetch(patched('Revoked'));
    const res = await screen(set, request, {
      screen: createRegistryScreener({ rpcUrl: RPC, fetchImpl }),
    });
    expect(res.outcome).toBe('clean');
    expect(res.hits).toEqual([]);
    expect(res.answers[0]?.answer.entry?.status).toBe('Revoked');
  });

  it('the registry answer wins over the demo deny-list, and scan()’s testnet-always branch does not shadow it', async () => {
    const f = fixture('classic-payment');
    const request = requestFor(f);
    const sim = await ingest(request);
    const set = effects(sim, auth(sim), request);
    // The demo address, which scan() always flags on testnet.
    set.effects[0]!.counterparty = FLAGGED;
    const res = await screen(set, request, {
      screen: answering({ [FLAGGED]: { outcome: 'not_flagged', source: 'registry' } }),
    });
    expect(res.outcome).toBe('clean');
    // And end to end: a registry saying "not flagged" for the demo address
    // produces no reported_address reason, whatever scan() thinks.
    const xdrWithDemoDest = fixture('classic-payment');
    const result = await runPipeline(requestFor(xdrWithDemoDest), {
      screen: answering({}),
    });
    expect(result.reasons.map((r) => r.code)).not.toContain('reported_address');
  });

  it('with no screener the demo list answers only because DEMO_AFFORDANCES is on under test', async () => {
    const f = fixture('classic-payment');
    const request = requestFor(f);
    const sim = await ingest(request);
    const set = effects(sim, auth(sim), request);
    set.effects[0]!.counterparty = FLAGGED;
    const res = await screen(set, request);
    expect(__FEATURE_DEMO_AFFORDANCES__).toBe(true);
    expect(res.hits[0]).toMatchObject({ address: FLAGGED, source: 'demo-list' });
  });
});
