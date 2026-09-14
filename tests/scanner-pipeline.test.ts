import { describe, it, expect } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import {
  ingest,
  auth,
  effects,
  screen,
  buildVerdict,
  runPipeline,
  explainRulesBased,
  scan,
  DEMO_FLAGGED_ADDRESSES,
  type Explainer,
  type RawSimulation,
  type ScanRequest,
  type SimulationResult,
  type Verdict,
} from '@lantern/scanner';
import fixtureIndex from '../packages/lantern-scanner/fixtures/index.json';

// ── Fixture corpus (#51) ─────────────────────────────────────────────────────
// Real XDR + the raw simulateTransaction body recorded from testnet by
// packages/lantern-scanner/fixtures/record.mjs. Read from disk by Vite at
// transform time (`import.meta.glob`, not `node:fs` — the node-polyfills plugin
// shims fs inside test files); nothing here touches the network.
interface Fixture {
  name: string;
  description: string;
  networkPassphrase: string;
  source: string;
  xdr: string;
  simulation: RawSimulation | null;
}

const ON_DISK = import.meta.glob<Fixture>('../packages/lantern-scanner/fixtures/*.json', {
  eager: true,
  import: 'default',
});
const FIXTURES: Record<string, Fixture> = {};
for (const [path, value] of Object.entries(ON_DISK)) {
  const name = path.replace(/^.*\//, '').replace(/\.json$/, '');
  if (name !== 'index') FIXTURES[name] = value;
}

function fixture(name: string): Fixture {
  const f = FIXTURES[name];
  if (!f) throw new Error(`no fixture named ${name}`);
  return f;
}

// A `simulate` dependency that answers only from the fixture's recording — the
// pipeline never gets a chance to reach the network.
function recorded(f: Fixture): (xdr: string) => Promise<RawSimulation> {
  return async (xdr) => {
    if (xdr !== f.xdr) throw new Error('simulate called with an XDR the fixture did not record');
    if (!f.simulation) throw new Error(`fixture ${f.name} has no recorded simulation`);
    return f.simulation;
  };
}

const EMPTY_SIM: SimulationResult = {
  ok: false,
  outcome: 'failed',
  failure: 'undecodable',
  decoded: null,
  simulated: false,
  auth: [],
  footprint: { readOnly: [], readWrite: [] },
  events: [],
};

function requestFor(f: Fixture): ScanRequest {
  return {
    xdr: f.xdr,
    networkPassphrase: f.networkPassphrase,
    context: { network: 'TESTNET', fromAddress: f.source, destinationFunded: true },
  };
}

const CORPUS = [
  'archived-state',
  'classic-payment',
  'deep-auth',
  'path-payment',
  'sac-transfer',
  'sep41-approve',
  'nested-subinvocation',
  'unknown-contract',
  'malformed-xdr',
];

describe('fixture corpus', () => {
  it('has every case later slices need, on disk, with index.json in sync', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...CORPUS].sort());
    expect([...(fixtureIndex as string[])].sort()).toEqual([...CORPUS].sort());
  });

  it('records testnet XDR and a simulation for every Soroban case', () => {
    for (const name of CORPUS) {
      const f = fixture(name);
      expect(f.networkPassphrase).toBe(Networks.TESTNET);
      expect(f.description.length).toBeGreaterThan(10);
      const soroban = [
        'sac-transfer',
        'sep41-approve',
        'nested-subinvocation',
        'unknown-contract',
        'archived-state',
        'deep-auth',
      ];
      if (soroban.includes(name)) expect(f.simulation).not.toBeNull();
      else expect(f.simulation).toBeNull();
    }
  });
});

// ── Stage 1: ingest ──────────────────────────────────────────────────────────
describe('ingest', () => {
  it('decodes a classic payment without simulating', async () => {
    const f = fixture('classic-payment');
    let called = false;
    const sim = await ingest(requestFor(f), {
      simulate: async () => {
        called = true;
        return {};
      },
    });
    expect(sim.ok).toBe(true);
    expect(sim.simulated).toBe(false);
    expect(called).toBe(false);
    expect(sim.decoded?.operations[0]?.type).toBe('payment');
  });

  it('fails closed on malformed XDR', async () => {
    const sim = await ingest(requestFor(fixture('malformed-xdr')));
    expect(sim.ok).toBe(false);
    expect(sim.decoded).toBeNull();
    expect(sim.error).toBe('undecodable');
  });

  it('fails closed on a Soroban tx when no simulation is available', async () => {
    const sim = await ingest(requestFor(fixture('sac-transfer')));
    expect(sim.ok).toBe(false);
    expect(sim.simulated).toBe(false);
    expect(sim.error).toBe('simulation_unavailable');
  });

  it('fails closed when the RPC reports the contract would fail', async () => {
    const f = fixture('unknown-contract');
    const sim = await ingest(requestFor(f), { simulate: recorded(f) });
    expect(sim.ok).toBe(false);
    expect(sim.simulated).toBe(true);
    expect(sim.error).toMatch(/MissingValue/);
  });

  it('fails closed when the simulate dependency throws', async () => {
    const f = fixture('sac-transfer');
    const sim = await ingest(requestFor(f), {
      simulate: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(sim.ok).toBe(false);
    expect(sim.error).toBe('ECONNRESET');
  });

  it('extracts the auth entries from a successful simulation', async () => {
    const f = fixture('sac-transfer');
    const sim = await ingest(requestFor(f), { simulate: recorded(f) });
    expect(sim.ok).toBe(true);
    expect(sim.auth.length).toBeGreaterThan(0);
    expect(typeof sim.latestLedger).toBe('number');
  });
});

// ── Stage 2: auth ────────────────────────────────────────────────────────────
describe('auth', () => {
  it('parses a flat SAC transfer into one root with no children', async () => {
    const f = fixture('sac-transfer');
    const tree = auth(await ingest(requestFor(f), { simulate: recorded(f) }));
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0]?.functionName).toBe('transfer');
    expect(tree.roots[0]?.children).toHaveLength(0);
    expect(tree.nestedCount).toBe(0);
    expect(tree.analyzed).toBe(true);
  });

  it('surfaces the nested sub-invocation a Blend submit hides', async () => {
    const f = fixture('nested-subinvocation');
    const tree = auth(await ingest(requestFor(f), { simulate: recorded(f) }));
    expect(tree.roots[0]?.functionName).toBe('submit');
    expect(tree.roots[0]?.children.map((c) => c.functionName)).toEqual(['transfer']);
    expect(tree.roots[0]?.children[0]?.contractId).toBe(
      'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    );
    expect(tree.nestedCount).toBe(1);
  });

  it('returns an empty tree for a classic transaction', async () => {
    const tree = auth(await ingest(requestFor(fixture('classic-payment'))));
    expect(tree).toEqual({
      entries: [],
      calls: [],
      roots: [],
      nestedCount: 0,
      maxDepth: 0,
      unparseable: 0,
      analyzed: true,
    });
  });

  it('counts an unparseable entry instead of throwing or silently dropping it', () => {
    const tree = auth({
      ...EMPTY_SIM,
      ok: true,
      outcome: 'ok',
      simulated: true,
      auth: ['not-xdr'],
    });
    expect(tree.roots).toEqual([]);
    expect(tree.unparseable).toBe(1);
  });
});

// ── Stage 3: effects ─────────────────────────────────────────────────────────
describe('effects', () => {
  it('maps a classic payment to a payment effect with its counterparty', async () => {
    const sim = await ingest(requestFor(fixture('classic-payment')));
    const set = effects(sim, auth(sim));
    expect(set.coverage).toBe('full');
    expect(set.effects).toEqual([
      {
        kind: 'payment',
        opIndex: 0,
        counterparty: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
        assetCode: 'XLM',
        amount: '25.0000000',
      },
    ]);
  });

  it('reports partial coverage for a contract call the skeleton cannot decode', async () => {
    const f = fixture('sep41-approve');
    const sim = await ingest(requestFor(f), { simulate: recorded(f) });
    const set = effects(sim, auth(sim));
    expect(set.coverage).toBe('partial');
    expect(set.effects[0]?.kind).toBe('contract_call');
    expect(set.effects[0]?.functionName).toBe('approve');
  });

  it('is empty with no coverage when nothing decoded', () => {
    expect(effects(EMPTY_SIM, auth(EMPTY_SIM))).toEqual({
      source: null,
      effects: [],
      coverage: 'none',
    });
  });
});

// ── Stage 4: screen ──────────────────────────────────────────────────────────
describe('screen', () => {
  it('checks every counterparty and is clean against the demo list', async () => {
    const f = fixture('classic-payment');
    const sim = await ingest(requestFor(f));
    const res = await screen(effects(sim, auth(sim)), requestFor(f));
    expect(res.outcome).toBe('clean');
    expect(res.checked).toEqual(['GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57']);
    expect(res.hits).toEqual([]);
  });

  it('flags through an injected registry lookup', async () => {
    const f = fixture('classic-payment');
    const sim = await ingest(requestFor(f));
    const res = await screen(effects(sim, auth(sim)), requestFor(f), {
      isFlagged: async () => true,
    });
    expect(res.outcome).toBe('flagged');
    expect(res.hits[0]?.source).toBe('registry');
  });

  it('is "unavailable", not "clean", when the lookup cannot be made', async () => {
    const f = fixture('classic-payment');
    const sim = await ingest(requestFor(f));
    const nulls = await screen(effects(sim, auth(sim)), requestFor(f), {
      isFlagged: async () => null,
    });
    expect(nulls.outcome).toBe('unavailable');
    const throws = await screen(effects(sim, auth(sim)), requestFor(f), {
      isFlagged: async () => {
        throw new Error('rpc down');
      },
    });
    expect(throws.outcome).toBe('unavailable');
  });
});

// ── Stage 5: verdict ─────────────────────────────────────────────────────────
async function verdictFor(
  f: Fixture,
  deps: Parameters<typeof runPipeline>[1] = {},
): Promise<Verdict> {
  const request = requestFor(f);
  const simulation = await ingest(request, deps);
  const authTree = auth(simulation);
  const effectSet = effects(simulation, authTree);
  const screenResult = await screen(effectSet, request, deps);
  return buildVerdict({
    request,
    simulation,
    auth: authTree,
    effects: effectSet,
    screen: screenResult,
  });
}

describe('buildVerdict', () => {
  it('is deeply frozen — the object handed to stage 6 cannot be changed', async () => {
    const v = await verdictFor(fixture('classic-payment'));
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.reasons)).toBe(true);
    expect(Object.isFrozen(v.signals)).toBe(true);
    for (const r of v.reasons) expect(Object.isFrozen(r)).toBe(true);
    for (const s of v.signals) expect(Object.isFrozen(s)).toBe(true);
  });

  it('is low/allow for an ordinary classic payment, with an audit trail', async () => {
    const v = await verdictFor(fixture('classic-payment'));
    expect(v.risk).toBe('low');
    expect(v.action).toBe('allow');
    expect(v.signals.map((s) => s.stage)).toEqual([
      'ingest',
      'auth',
      'effects',
      'screen',
      'verdict',
    ]);
  });

  it('fails closed: malformed XDR is high/block_confirm', async () => {
    const v = await verdictFor(fixture('malformed-xdr'));
    expect(v.risk).toBe('high');
    expect(v.action).toBe('block_confirm');
    expect(v.reasons.map((r) => r.code)).toContain('undecodable');
  });

  it('fails closed: a Soroban call that cannot be simulated is high', async () => {
    const f = fixture('unknown-contract');
    const v = await verdictFor(f, { simulate: recorded(f) });
    expect(v.risk).toBe('high');
    expect(v.reasons.map((r) => r.code)).toContain('simulation_reverted');
  });

  it('fails closed: an auth entry it cannot read is high, not silently ignored', async () => {
    const f = fixture('sac-transfer');
    const good = f.simulation!;
    const first = (good.result!.results as Array<{ auth: string[] }>)[0]!;
    const corrupted: RawSimulation = {
      ...good,
      result: { ...good.result, results: [{ ...first, auth: [...first.auth, 'not-xdr'] }] },
    };
    const v = await verdictFor(f, { simulate: async () => corrupted });
    expect(v.risk).toBe('high');
    expect(v.action).toBe('block_confirm');
    expect(v.reasons.map((r) => r.code)).toContain('auth_unreadable');
    expect(v.signals.find((s) => s.stage === 'auth')?.code).toBe('fail_closed');
  });

  it('raises a reported counterparty to high', async () => {
    const f = fixture('classic-payment');
    const v = await verdictFor(f, { isFlagged: async () => true });
    expect(v.risk).toBe('high');
    expect(v.reasons.filter((r) => r.code === 'reported_address')).toHaveLength(1);
  });

  it('warns when the registry could not be reached', async () => {
    const f = fixture('classic-payment');
    const v = await verdictFor(f, { isFlagged: async () => null });
    expect(v.risk).toBe('medium');
    expect(v.reasons.map((r) => r.code)).toContain('screen_unavailable');
  });

  it('carries the shipped heuristics (never weaker than scan()) and ignores forceScenario', async () => {
    const f = fixture('classic-payment');
    const request = requestFor(f);
    const legacy = scan({ ...request });
    const v = await verdictFor(f);
    expect(v.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(legacy.reasons.map((r) => r.code)),
    );
    const forced: ScanRequest = {
      ...request,
      context: { ...request.context, forceScenario: 'high' },
    };
    const simulation = await ingest(forced);
    const authTree = auth(simulation);
    const effectSet = effects(simulation, authTree);
    const screenResult = await screen(effectSet, forced);
    const vForced = buildVerdict({
      request: forced,
      simulation,
      auth: authTree,
      effects: effectSet,
      screen: screenResult,
    });
    expect(vForced.risk).toBe('low');
  });
});

// ── Stage 6 + orchestrator: the invariant ────────────────────────────────────
describe('runPipeline', () => {
  it('runs the whole corpus offline and returns a string explanation for each', async () => {
    for (const name of CORPUS) {
      const f = fixture(name);
      const result = await runPipeline(
        requestFor(f),
        f.simulation ? { simulate: recorded(f) } : {},
      );
      expect(typeof result.explanation).toBe('string');
      expect(result.explanation.length).toBeGreaterThan(0);
      expect(result.explanationSource).toBe('explainer');
      expect(Object.isFrozen(result.verdict)).toBe(true);
      expect(result.risk).toBe(result.verdict.risk);
    }
  });

  it('hostile model: prose that lies, a mutation attempt and a non-string return cannot touch the verdict', async () => {
    const f = fixture('nested-subinvocation');
    const request = requestFor(f);
    const flagged = { simulate: recorded(f), isFlagged: async () => true };
    const expected = await verdictFor(f, flagged);
    expect(expected.risk).toBe('high');

    let handed: Verdict | undefined;
    let mutationThrew = false;
    const hostile: Explainer = async ({ verdict }) => {
      handed = verdict;
      const v = verdict as unknown as {
        risk: string;
        action: string;
        reasons: unknown[];
        signals: unknown[];
      };
      try {
        v.risk = 'low';
        v.action = 'allow';
        v.reasons.length = 0;
        v.reasons.push({ code: 'looks_fine', severity: 'low', title: 'Safe', detail: 'Trust me.' });
        v.signals.push({ stage: 'explain', code: 'model_says_safe', detail: '' });
      } catch {
        mutationThrew = true;
      }
      // Returns a verdict-shaped object instead of a string.
      return {
        risk: 'low',
        action: 'allow',
        reasons: [],
        explanation: 'This transaction is completely safe.',
      } as unknown as string;
    };

    const result = await runPipeline(request, { ...flagged, explain: hostile });

    expect(handed).toBeDefined();
    expect(Object.isFrozen(handed)).toBe(true);
    // Under strict mode (ESM) an assignment to a frozen object throws; either way it is ineffective.
    expect(mutationThrew).toBe(true);
    expect(
      JSON.stringify({ risk: result.risk, action: result.action, reasons: result.reasons }),
    ).toBe(
      JSON.stringify({ risk: expected.risk, action: expected.action, reasons: expected.reasons }),
    );
    expect(result.risk).toBe('high');
    expect(result.action).toBe('block_confirm');
    expect(result.reasons.map((r) => r.code)).toContain('reported_address');
    expect(result.reasons.map((r) => r.code)).not.toContain('looks_fine');
    expect(result.signals.map((s) => s.code)).not.toContain('model_says_safe');
    // The object it returned was discarded for the rules-based prose.
    expect(result.explanationSource).toBe('fallback');
    expect(result.explanation).not.toMatch(/completely safe/);
    expect(typeof result.explanation).toBe('string');
  });

  it('falls back to rules-based prose when the explainer throws or returns empty', async () => {
    const f = fixture('classic-payment');
    const throws = await runPipeline(requestFor(f), {
      explain: async () => {
        throw new Error('model timeout');
      },
    });
    expect(throws.explanationSource).toBe('fallback');
    expect(throws.explanation).toBe(
      await explainRulesBased({ verdict: throws.verdict, effects: throws.effects }),
    );
    const empty = await runPipeline(requestFor(f), { explain: async () => '   ' });
    expect(empty.explanationSource).toBe('fallback');
    expect(empty.risk).toBe('low');
  });

  it('deep-freezes the effects handed to the explainer so stage-3 output cannot be corrupted', async () => {
    const f = fixture('classic-payment');
    let mutationThrew = false;
    const result = await runPipeline(requestFor(f), {
      explain: async ({ effects: fx }) => {
        const m = fx as unknown as {
          effects: Array<{ counterparty?: string }>;
          source: { operations: Array<{ amount?: string }> };
        };
        try {
          m.effects[0]!.counterparty = 'GHOSTILE';
          m.effects.push({ counterparty: 'GINJECTED' });
          m.source.operations[0]!.amount = '0';
        } catch {
          mutationThrew = true;
        }
        return 'fine';
      },
    });
    expect(mutationThrew).toBe(true);
    expect(Object.isFrozen(result.effects)).toBe(true);
    expect(Object.isFrozen(result.effects.effects)).toBe(true);
    expect(Object.isFrozen(result.effects.effects[0])).toBe(true);
    expect(Object.isFrozen(result.effects.source?.operations[0])).toBe(true);
    expect(result.effects.effects).toHaveLength(1);
    expect(result.effects.effects[0]?.counterparty).toBe(
      'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
    );
    expect(result.effects.source?.operations[0]?.amount).toBe('25.0000000');
  });

  it('abandons an explainer that never settles and falls back after the deadline', async () => {
    const f = fixture('classic-payment');
    const started = Date.now();
    const result = await runPipeline(requestFor(f), {
      explain: () => new Promise<string>(() => {}),
      explainTimeoutMs: 50,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.explanationSource).toBe('fallback');
    expect(result.explanation).toBe(
      await explainRulesBased({ verdict: result.verdict, effects: result.effects }),
    );
    expect(result.risk).toBe('low');
  });

  it('the explainer output reaches only the explanation field', async () => {
    const f = fixture('classic-payment');
    const result = await runPipeline(requestFor(f), { explain: async () => 'MARKER-PROSE' });
    expect(result.explanation).toBe('MARKER-PROSE');
    expect(result.explanationSource).toBe('explainer');
    const { explanation: _e, ...rest } = result;
    expect(JSON.stringify(rest)).not.toContain('MARKER-PROSE');
  });

  it('screens the demo flagged address on testnet through the default lookup', async () => {
    const [flaggedAddr] = [...DEMO_FLAGGED_ADDRESSES];
    const f = fixture('classic-payment');
    const request = requestFor(f);
    const sim = await ingest(request);
    const set = effects(sim, auth(sim));
    set.effects[0]!.counterparty = flaggedAddr!;
    const res = await screen(set, request);
    expect(res.outcome).toBe('flagged');
    expect(res.hits[0]?.source).toBe('demo-list');
  });
});
