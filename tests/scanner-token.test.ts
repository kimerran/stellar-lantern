import { describe, it, expect } from 'vitest';
import {
  auth,
  effects,
  ingest,
  runPipeline,
  resolveTokenMetadata,
  recogniseTokenCall,
  scaleAmount,
  createTokenMetadataCache,
  createRpcTokenResolver,
  metadataFromLedgerEntries,
  contractInstanceKey,
  UNLIMITED_ALLOWANCE_THRESHOLD,
  type AssetDelta,
  type RawLedgerEntries,
  type RawSimulation,
  type ScanRequest,
  type TokenMetadata,
  type TokenMetadataResolver,
} from '@lantern/scanner';

// Stage 3b — SEP-41 / SAC token-interface calls (#55). Offline: recordings
// for transfer / approve / the nested transfer, the synthetic token-admin
// fixture for mint / burn / clawback and the look-alikes, and the recorded
// getLedgerEntries body for metadata.

interface Fixture {
  name: string;
  networkPassphrase: string;
  source: string;
  xdr: string;
  simulation: RawSimulation | null;
}
interface MetadataFixture {
  contracts: string[];
  keys: string[];
  response: RawLedgerEntries;
}
const ON_DISK = import.meta.glob<Fixture | MetadataFixture>(
  '../packages/lantern-scanner/fixtures/*.json',
  { eager: true, import: 'default' },
);
function fixture(name: string): Fixture {
  const f = Object.entries(ON_DISK).find(([p]) => p.endsWith(`/${name}.json`))?.[1];
  if (!f || !('xdr' in f)) throw new Error(`no fixture ${name}`);
  return f;
}
const META = Object.entries(ON_DISK).find(([p]) =>
  p.endsWith('/token-metadata.json'),
)![1] as MetadataFixture;

const XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC_SAC = 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU';
const POOL = 'CC4KSBTTPCKZUYBXB47SSZGXTKO6G23Y6LJOIR6YCOJVTGJZEYJCHBOH';
const DEST = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const SPENDER = 'GBVG3DQJNAYAPTB4FKPLL65BUNF76K2TKPTK72LDIAJKRATGRY5BFJBP';
const USDC_ISSUER = 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';

function requestFor(f: Fixture): ScanRequest {
  return {
    xdr: f.xdr,
    networkPassphrase: f.networkPassphrase,
    context: { network: 'TESTNET', fromAddress: f.source, destinationFunded: true },
  };
}
// A resolver that answers only from the recorded getLedgerEntries body.
const recordedResolver: TokenMetadataResolver = async (id) =>
  metadataFromLedgerEntries(META.response, id);
const fetchFor =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status });

async function effectsFor(name: string, resolver?: TokenMetadataResolver) {
  const f = fixture(name);
  const request = requestFor(f);
  const sim = await ingest(request, { simulate: async () => f.simulation! });
  const tree = auth(sim);
  const meta = await resolveTokenMetadata(tree, resolver);
  return effects(sim, tree, request, meta);
}
const row = (d: AssetDelta) =>
  `${d.direction} ${d.address.slice(0, 4)} ${d.asset.code} ${d.amount ?? 'raw:' + d.raw} d${d.depth}`;

// ── Metadata ─────────────────────────────────────────────────────────────────
describe('token metadata', () => {
  it('reads code / decimals / issuer for a SAC out of its instance entry (recorded)', () => {
    expect(metadataFromLedgerEntries(META.response, USDC_SAC)).toEqual({
      code: 'USDC',
      name: `USDC:${USDC_ISSUER}`,
      decimals: 7,
      issuer: USDC_ISSUER,
    });
    expect(metadataFromLedgerEntries(META.response, XLM_SAC)).toEqual({
      code: 'XLM',
      name: 'native',
      decimals: 7,
    });
    expect(META.keys).toContain(contractInstanceKey(USDC_SAC));
  });

  it('an unresolvable contract yields null, not a guess', () => {
    expect(metadataFromLedgerEntries(META.response, POOL)).toBeNull();
    expect(metadataFromLedgerEntries({ error: { message: 'boom' } }, USDC_SAC)).toBeNull();
    expect(metadataFromLedgerEntries({ result: { entries: 'nope' } }, USDC_SAC)).toBeNull();
  });

  it('the RPC resolver posts getLedgerEntries for the instance key and never throws', async () => {
    let posted: { method?: string; params?: { keys?: string[] } } = {};
    const resolver = createRpcTokenResolver({
      rpcUrl: 'https://rpc.invalid/',
      fetchImpl: async (_url, init) => {
        posted = JSON.parse(String(init?.body)) as typeof posted;
        return new Response(JSON.stringify(META.response), { status: 200 });
      },
    });
    expect(await resolver(USDC_SAC)).toMatchObject({ code: 'USDC', decimals: 7 });
    expect(posted.method).toBe('getLedgerEntries');
    expect(posted.params?.keys).toEqual([contractInstanceKey(USDC_SAC)]);
    const down = createRpcTokenResolver({
      rpcUrl: 'https://rpc.invalid/',
      fetchImpl: fetchFor({}, 503),
    });
    expect(await down(USDC_SAC)).toBeNull();
    const throws = createRpcTokenResolver({
      rpcUrl: 'https://rpc.invalid/',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(await throws(USDC_SAC)).toBeNull();
  });

  it('is cached per contract id, including in-flight lookups', async () => {
    let calls = 0;
    const cached = createTokenMetadataCache(async (id) => {
      calls += 1;
      return id === USDC_SAC ? { code: 'USDC', decimals: 7 } : null;
    });
    const [a, b] = await Promise.all([cached(USDC_SAC), cached(USDC_SAC)]);
    expect(a).toEqual(b);
    await cached(USDC_SAC);
    await cached(POOL);
    await cached(POOL);
    expect(calls).toBe(2);
  });
});

// ── Recognition ──────────────────────────────────────────────────────────────
describe('token recognition', () => {
  it('the five functions, by exact name and shape, at every depth', async () => {
    const admin = await effectsFor('token-admin');
    const deep = await effectsFor('deep-auth');
    const fns = (set: typeof admin) =>
      set.deltas.map((d) => `${d.depth}`).concat(set.approvals.map((a) => `approve@${a.depth}`));
    // No resolver here: an unresolved token shows its contract id, not a guessed code.
    expect(admin.deltas.map(row)).toEqual([
      `in GAMN CAQC… raw:9007199254740993 d1`,
      `out GAMN CAQC… raw:2500000 d1`,
      `out GAMN CAQC… raw:1 d1`,
    ]);
    expect(deep.deltas.map(row)).toEqual([
      `out GAMN XLM 1.0000000 d1`,
      `in CC4K XLM 1.0000000 d1`,
      `out GAMN CAQC… raw:-5 d2`,
      `in GBVG CAQC… raw:-5 d2`,
    ]);
    expect(fns(deep)).toContain('approve@1');
  });

  it('look-alikes are not the token interface: transfer_from, transferAll, a 2-arg transfer', async () => {
    const f = fixture('token-admin');
    const sim = await ingest(requestFor(f), { simulate: async () => f.simulation! });
    const tree = auth(sim);
    const names = tree.calls.map((c) => c.functionName);
    expect(names).toEqual([
      'rebalance',
      'mint',
      'burn',
      'clawback',
      'transfer_from',
      'transferAll',
      'transfer',
    ]);
    const recognised = tree.calls.map((c) => recogniseTokenCall(c)?.fn ?? null);
    expect(recognised).toEqual([null, 'mint', 'burn', 'clawback', null, null, null]);
    const set = await effectsFor('token-admin');
    expect(set.coverage).toBe('partial');
  });

  it('a transfer that appears only as a sub-invocation is decoded (real Blend recording)', async () => {
    const set = await effectsFor('nested-subinvocation', recordedResolver);
    expect(set.deltas.map(row)).toEqual([`out GAMN XLM 1.0000000 d1`, `in CC4K XLM 1.0000000 d1`]);
    expect(set.effects[0]?.kind).toBe('contract_call'); // root `submit` is not a token fn
    expect(set.coverage).toBe('partial');
  });

  it('a root transfer upgrades the coarse row and counts as full coverage (real recording)', async () => {
    const set = await effectsFor('sac-transfer', recordedResolver);
    expect(set.effects[0]).toMatchObject({
      kind: 'token_transfer',
      functionName: 'transfer',
      counterparty: DEST,
    });
    expect(set.deltas.map(row)).toEqual([`out GAMN XLM 5.0000000 d0`, `in GDVE XLM 5.0000000 d0`]);
    expect(set.coverage).toBe('full');
    expect(set.net.find((n) => n.address === DEST)).toMatchObject({
      in: '5.0000000',
      asset: { code: 'XLM' },
    });
  });
});

// ── Amounts: BigInt end to end, scaled only at the boundary ──────────────────
describe('token amounts', () => {
  it('i128 above MAX_SAFE_INTEGER round-trips exactly', async () => {
    const set = await effectsFor('token-admin');
    const mint = set.deltas[0]!;
    expect(mint.raw).toBe('9007199254740993');
    expect(BigInt(mint.raw!)).toBe(9007199254740993n);
    expect(String(Number(mint.raw))).not.toBe(mint.raw); // the float would be corrupted
    expect(mint.amount).toBeNull(); // decimals unknown → no scaled amount
    expect(mint.asset.decimals).toBeNull();
  });

  it('resolves decimals and renders 1000000000 as 100.0000000 USDC', async () => {
    const set = await effectsFor('token-admin', async (id) =>
      id === USDC_SAC ? { code: 'USDC', decimals: 7, issuer: USDC_ISSUER } : null,
    );
    expect(set.deltas[1]).toMatchObject({
      raw: '2500000',
      amount: '0.2500000',
      asset: { code: 'USDC', decimals: 7 },
    });
    expect(scaleAmount(1_000_000_000n, 7)).toBe('100.0000000');
    expect(scaleAmount(1_000_000_000n, 0)).toBe('1000000000');
    expect(scaleAmount(-5n, 2)).toBe('-0.05');
    expect(scaleAmount(5n, null)).toBeNull();
  });

  it('never guesses a scale: an unresolved token keeps raw + decimals: null through the aggregate', async () => {
    const set = await effectsFor('token-admin', async () => null);
    const usdc = set.net.find((n) => n.address === fixture('token-admin').source)!;
    expect(usdc.asset.decimals).toBeNull();
    expect(usdc.in).toBe('9007199254740993');
    expect(usdc.out).toBe('2500001');
  });
});

// ── approve: the risk-bearing one ────────────────────────────────────────────
describe('approve', () => {
  it('captures amount and expiration_ledger (real recording) and flags an unlimited allowance', async () => {
    const set = await effectsFor('sep41-approve', recordedResolver);
    expect(set.approvals).toHaveLength(1);
    const ap = set.approvals[0]!;
    expect(ap).toMatchObject({
      owner: fixture('sep41-approve').source,
      spender: SPENDER,
      asset: { code: 'USDC', decimals: 7, issuer: USDC_ISSUER },
      amount: '170141183460469231731687303715884105727',
      unlimited: true,
      depth: 0,
    });
    expect(ap.expirationLedger).toBeGreaterThan(4_000_000);
    expect(BigInt(ap.amount) >= UNLIMITED_ALLOWANCE_THRESHOLD).toBe(true);
    expect(set.effects[0]?.kind).toBe('token_approve');
    expect(set.deltas).toEqual([]); // an approval moves nothing yet
  });

  it('raises a distinct high reason + signal the verdict stage consumes', async () => {
    const f = fixture('sep41-approve');
    const result = await runPipeline(requestFor(f), {
      simulate: async () => f.simulation!,
      resolveToken: recordedResolver,
    });
    expect(result.risk).toBe('high');
    expect(result.action).toBe('block_confirm');
    expect(result.reasons.find((r) => r.code === 'unlimited_allowance')?.severity).toBe('high');
    expect(result.signals.map((s) => s.code)).toContain('unlimited_allowance');
    // The recording expires 1,000,000 ledgers out (~2 months): not long-lived.
    expect(result.signals.map((s) => s.code)).not.toContain('long_lived_allowance');
  });

  it('an allowance whose horizon cannot be bounded is long-lived', async () => {
    const f = fixture('sep41-approve');
    const { latestLedger: _dropped, ...rest } = f.simulation!.result!;
    const result = await runPipeline(requestFor(f), {
      simulate: async () => ({ ...f.simulation!, result: rest }),
      resolveToken: recordedResolver,
    });
    expect(result.signals.map((s) => s.code)).toContain('long_lived_allowance');
    expect(result.reasons.find((r) => r.code === 'unlimited_allowance')?.detail).toMatch(
      /very long time/,
    );
  });

  it('a bounded, short-lived approval is a signal, not a reason', async () => {
    const f = fixture('sep41-approve');
    const sim = await ingest(requestFor(f), { simulate: async () => f.simulation! });
    const latest = sim.latestLedger!;
    // Re-encode the recorded approve with a small amount and a near expiry.
    const { Address, XdrLargeInt, xdr } = await import('@stellar/stellar-sdk');
    const e = xdr.SorobanAuthorizationEntry.fromXDR(sim.auth[0]!, 'base64');
    const fn = e.rootInvocation().function().contractFn();
    const args = fn.args();
    args[2] = new XdrLargeInt('i128', '1000000').toScVal();
    args[3] = xdr.ScVal.scvU32(latest + 1000);
    const patched = new xdr.SorobanAuthorizationEntry({
      credentials: e.credentials(),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: fn.contractAddress(),
            functionName: fn.functionName(),
            args,
          }),
        ),
        subInvocations: [],
      }),
    }).toXDR('base64');
    void Address;
    const first = (f.simulation!.result!.results as Array<{ auth: string[] }>)[0]!;
    const body: RawSimulation = {
      ...f.simulation!,
      result: { ...f.simulation!.result, results: [{ ...first, auth: [patched] }] },
    };
    const result = await runPipeline(requestFor(f), {
      simulate: async () => body,
      resolveToken: recordedResolver,
    });
    expect(result.effects.approvals[0]).toMatchObject({
      amount: '1000000',
      amountScaled: '0.1000000',
      unlimited: false,
    });
    expect(result.reasons.map((r) => r.code)).not.toContain('unlimited_allowance');
    expect(result.signals.map((s) => s.code)).toContain('allowance');
    expect(result.signals.map((s) => s.code)).not.toContain('long_lived_allowance');
  });
});

// ── Screening sees token counterparties ──────────────────────────────────────
describe('screen', () => {
  it('checks a nested transfer recipient and an approval spender, not just the root counterparty', async () => {
    const f = fixture('deep-auth');
    const result = await runPipeline(requestFor(f), {
      simulate: async () => f.simulation!,
      isFlagged: async (a) => a === SPENDER,
    });
    expect(result.screen.checked).toContain(SPENDER);
    expect(result.screen.outcome).toBe('flagged');
    expect(result.screen.hits.map((h) => h.address)).toEqual([SPENDER]);
    expect(result.reasons.map((r) => r.code)).toContain('reported_address');
    expect(result.risk).toBe('high');
  });
});

// ── Metadata failures degrade, never abort ───────────────────────────────────
describe('resolver failures', () => {
  it('a throwing resolver leaves the token unresolved and the scan intact', async () => {
    const f = fixture('sac-transfer');
    const result = await runPipeline(requestFor(f), {
      simulate: async () => f.simulation!,
      resolveToken: async () => {
        throw new Error('rpc down');
      },
    });
    // Native SAC is known without metadata; the scan completes.
    expect(result.effects.deltas[0]?.asset).toMatchObject({ code: 'XLM', decimals: 7 });
    expect(typeof result.explanation).toBe('string');
  });

  it('the native SAC is XLM at 7 decimals even with no resolver', async () => {
    const set = await effectsFor('sac-transfer');
    expect(set.deltas[0]?.asset).toEqual({ code: 'XLM', contractId: XLM_SAC, decimals: 7 });
    const meta: TokenMetadata | null = null;
    expect(meta).toBeNull();
  });
});
