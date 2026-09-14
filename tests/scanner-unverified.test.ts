import { describe, it, expect } from 'vitest';
import {
  auth,
  effects,
  ingest,
  runPipeline,
  resolveTokenMetadata,
  metadataFromLedgerEntries,
  describeDefiFunction,
  UNVERIFIED_LABEL,
  type RawLedgerEntries,
  type RawSimulation,
  type ScanRequest,
  type TokenMetadataResolver,
} from '@lantern/scanner';
// The stage sources, as text, so the test can prove what they do not import.
import pipelineSrc from '../packages/lantern-scanner/src/pipeline.ts?raw';
import effectsSrc from '../packages/lantern-scanner/src/effects.ts?raw';
import tokenSrc from '../packages/lantern-scanner/src/token.ts?raw';
import unverifiedSrc from '../packages/lantern-scanner/src/unverified.ts?raw';
import observedSrc from '../packages/lantern-scanner/src/observed.ts?raw';

// Stage 3c — the unverified-contract fallback (#56). "Unknown contracts never
// guessed." Offline: the real Blend `submit` recording (an unverified root
// whose sub-invocation is a known transfer, with observed state changes),
// the real unknown-contract recording, and the synthetic token-admin tree
// with its look-alike function names.

interface Fixture {
  name: string;
  networkPassphrase: string;
  source: string;
  xdr: string;
  simulation: RawSimulation | null;
}
const ON_DISK = import.meta.glob<Fixture | { response: RawLedgerEntries }>(
  '../packages/lantern-scanner/fixtures/*.json',
  { eager: true, import: 'default' },
);
function fixture(name: string): Fixture {
  const f = Object.entries(ON_DISK).find(([p]) => p.endsWith(`/${name}.json`))?.[1];
  if (!f || !('xdr' in f)) throw new Error(`no fixture ${name}`);
  return f;
}
const META = Object.entries(ON_DISK).find(([p]) => p.endsWith('/token-metadata.json'))![1] as {
  response: RawLedgerEntries;
};
const recordedResolver: TokenMetadataResolver = async (id) =>
  metadataFromLedgerEntries(META.response, id);

function requestFor(f: Fixture): ScanRequest {
  return {
    xdr: f.xdr,
    networkPassphrase: f.networkPassphrase,
    context: { network: 'TESTNET', fromAddress: f.source, destinationFunded: true },
  };
}
async function effectsFor(name: string, resolver?: TokenMetadataResolver) {
  const f = fixture(name);
  const request = requestFor(f);
  const sim = await ingest(request, { simulate: async () => f.simulation! });
  const tree = auth(sim);
  return effects(sim, tree, request, await resolveTokenMetadata(tree, resolver));
}

const POOL = 'CC4KSBTTPCKZUYBXB47SSZGXTKO6G23Y6LJOIR6YCOJVTGJZEYJCHBOH';
const XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USER = 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK';

// ── The raw decoded call ─────────────────────────────────────────────────────
describe('unverified: raw decoded call', () => {
  it('a Blend submit is contract id + function + decoded args + depth + the label (real recording)', async () => {
    const set = await effectsFor('nested-subinvocation');
    expect(set.unverified).toHaveLength(1);
    const u = set.unverified[0]!;
    expect(u.label).toBe(UNVERIFIED_LABEL);
    expect(u.label).toBe('unverified contract — semantics unknown');
    expect(u.contractId).toBe(POOL);
    expect(u.functionName).toBe('submit');
    expect(u.depth).toBe(0);
    expect(u.entryIndex).toBe(0);
    expect(u.path).toEqual([]);
    expect(u.credentials).toEqual({ kind: 'source_account' });
    expect(u.args.map((a) => a.type)).toEqual(['address', 'address', 'address', 'vec']);
    // The known sub-invocation is NOT unverified — 3b decoded it.
    expect(set.deltas.map((d) => d.source)).toEqual(['token', 'token']);
    expect(set.coverage).toBe('partial');
  });

  it('a root call with no auth entry is still reported, with the op’s own decoded args', async () => {
    const f = fixture('unknown-contract');
    // The recording reverted, so there is no auth tree at all; pretend it
    // simulated cleanly with nothing to authorise.
    const body: RawSimulation = {
      jsonrpc: '2.0',
      id: 1,
      result: { minResourceFee: '100', results: [{ auth: [], xdr: 'AAAAAQ==' }], latestLedger: 1 },
    };
    const request = requestFor(f);
    const sim = await ingest(request, { simulate: async () => body });
    const set = effects(sim, auth(sim), request);
    expect(set.unverified).toEqual([
      {
        label: UNVERIFIED_LABEL,
        contractId: 'CBIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIVCUKRKFIVCR62',
        functionName: 'do_thing',
        args: [{ type: 'address', value: USER }],
        depth: 0,
      },
    ]);
    expect(set.source?.operations[0]?.contractArgs).toEqual([{ type: 'address', value: USER }]);
  });
});

// ── What simulation proved ───────────────────────────────────────────────────
describe('unverified: observed balance changes', () => {
  it('reports the SAC balance change the simulation observed for the unverified submit', async () => {
    const set = await effectsFor('nested-subinvocation', recordedResolver);
    // The pool's XLM SAC balance rose by 1 XLM (63990000000 → 64000000000);
    // the user's account entry changed too.
    const pool = set.observed.find((d) => d.address === POOL);
    expect(pool).toMatchObject({
      direction: 'in',
      asset: { code: 'XLM', contractId: XLM_SAC, decimals: 7 },
      amount: '1.0000000',
      raw: '10000000',
      source: 'simulation',
    });
    const user = set.observed.find((d) => d.address === USER);
    expect(user).toMatchObject({ direction: 'out', asset: { code: 'XLM', decimals: 7 } });
    expect(set.observedNet.find((n) => n.address === POOL)?.in).toBe('1.0000000');
    // The pool's Positions / ResData entries are NOT interpreted: not balances.
    expect(set.observed.length).toBe(2);
  });

  it('observed changes are kept separate from declared deltas — no double counting', async () => {
    const set = await effectsFor('sac-transfer', recordedResolver);
    expect(set.deltas.every((d) => d.source === 'token')).toBe(true);
    expect(set.observed.every((d) => d.source === 'simulation')).toBe(true);
    expect(set.net.find((n) => n.address === USER)?.out).toBe('5.0000000');
    expect(set.observedNet.find((n) => n.address === USER)?.out).toBe('5.0000000');
  });

  it('an unparseable state change is skipped, never invented', async () => {
    const f = fixture('sac-transfer');
    const body: RawSimulation = {
      ...f.simulation!,
      result: {
        ...f.simulation!.result,
        stateChanges: [
          { type: 'updated', key: 'bm90LXhkcg==', before: 'AAAA', after: 'AAAA' },
          { type: 'weird', key: 'x' },
        ],
      },
    };
    const request = requestFor(f);
    const sim = await ingest(request, { simulate: async () => body });
    expect(sim.stateChanges).toHaveLength(1);
    expect(effects(sim, auth(sim), request).observed).toEqual([]);
  });
});

// ── Never guess ──────────────────────────────────────────────────────────────
describe('unverified: never guess', () => {
  it('invents no semantic label for look-alikes: transfer_from, transferAll, 2-arg transfer', async () => {
    const set = await effectsFor('token-admin');
    const names = set.unverified.map((u) => u.functionName);
    expect(names).toEqual(['rebalance', 'transfer_from', 'transferAll', 'transfer']);
    for (const u of set.unverified) {
      expect(u.label).toBe(UNVERIFIED_LABEL);
      expect(Object.keys(u).sort()).toEqual(
        [
          'args',
          'contractId',
          'credentials',
          'depth',
          'entryIndex',
          'functionName',
          'label',
          'path',
        ].sort(),
      );
    }
    // None of them produced a delta or an approval.
    expect(set.deltas.filter((d) => d.depth === 0)).toEqual([]);
    expect(set.approvals).toEqual([]);
  });

  it('a DeFi-sounding name and a meaningless one produce the same verdict', async () => {
    const f = fixture('nested-subinvocation');
    const rename = (name: string): RawSimulation => {
      // Re-encode the root invocation's function name; everything else identical.
      const { xdr } = require('@stellar/stellar-sdk') as typeof import('@stellar/stellar-sdk');
      const first = (f.simulation!.result!.results as Array<{ auth: string[] }>)[0]!;
      const e = xdr.SorobanAuthorizationEntry.fromXDR(first.auth[0]!, 'base64');
      const root = e.rootInvocation();
      const fn = root.function().contractFn();
      const patched = new xdr.SorobanAuthorizationEntry({
        credentials: e.credentials(),
        rootInvocation: new xdr.SorobanAuthorizedInvocation({
          function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new xdr.InvokeContractArgs({
              contractAddress: fn.contractAddress(),
              functionName: name,
              args: fn.args(),
            }),
          ),
          subInvocations: root.subInvocations(),
        }),
      }).toXDR('base64');
      return {
        ...f.simulation!,
        result: { ...f.simulation!.result, results: [{ ...first, auth: [patched] }] },
      };
    };
    const strip = (r: Awaited<ReturnType<typeof runPipeline>>) => ({
      risk: r.risk,
      action: r.action,
      reasons: r.reasons.map((x) => `${x.code}:${x.severity}`),
      signals: r.signals.map((s) => s.code),
    });
    const supply = await runPipeline(requestFor(f), { simulate: async () => rename('supply') });
    const gibberish = await runPipeline(requestFor(f), { simulate: async () => rename('zq_x9') });
    expect(strip(supply)).toEqual(strip(gibberish));
    expect(supply.reasons.map((r) => r.code)).toContain('unverified_contract');
    // describeDefiFunction knows "supply"; the verdict must not.
    expect(describeDefiFunction('supply')).toBeDefined();
    const text = JSON.stringify({
      reasons: supply.reasons,
      signals: supply.signals,
      effects: supply.effects,
    });
    expect(text).not.toContain(describeDefiFunction('supply'));
  });

  it('describeDefiFunction cannot reach the verdict path: no stage module imports defi.ts', () => {
    for (const [name, src] of Object.entries({
      pipelineSrc,
      effectsSrc,
      tokenSrc,
      unverifiedSrc,
      observedSrc,
    })) {
      expect(src, name).not.toMatch(/describeDefiFunction/);
      expect(src, name).not.toMatch(/from '\.\/defi'/);
    }
  });
});

// ── Risk ─────────────────────────────────────────────────────────────────────
describe('unverified: raises risk', () => {
  it('an unknown contract is at least medium, with the label in the reason', async () => {
    const f = fixture('nested-subinvocation');
    const result = await runPipeline(requestFor(f), {
      simulate: async () => f.simulation!,
      resolveToken: recordedResolver,
    });
    expect(['medium', 'high']).toContain(result.risk);
    expect(result.action).not.toBe('allow');
    const reason = result.reasons.find((r) => r.code === 'unverified_contract')!;
    expect(reason.severity).toBe('medium');
    expect(reason.title).toBe('Unverified contract — semantics unknown');
    expect(reason.detail).toMatch(/“submit”/);
    expect(reason.detail).toMatch(/2 balance changes/);
    // The generic legacy contract_call reason is superseded, not duplicated.
    expect(result.reasons.map((r) => r.code)).not.toContain('contract_call');
    expect(result.signals.map((s) => s.code)).toContain('unverified_contract');
    expect(result.signals.map((s) => s.code)).toContain('observed_balance_changes');
  });

  it('a fully decoded token call carries no unverified reason', async () => {
    const f = fixture('sac-transfer');
    const result = await runPipeline(requestFor(f), {
      simulate: async () => f.simulation!,
      resolveToken: recordedResolver,
    });
    expect(result.effects.unverified).toEqual([]);
    expect(result.effects.coverage).toBe('full');
    expect(result.reasons.map((r) => r.code)).not.toContain('unverified_contract');
  });
});
