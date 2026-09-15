import { describe, it, expect } from 'vitest';
import {
  auth,
  effects,
  ingest,
  screen,
  resolveTokenMetadata,
  metadataFromLedgerEntries,
  verdict,
  NOT_JUDGED,
  type AuthTree,
  type EffectSet,
  type RawLedgerEntries,
  type RawSimulation,
  type ScanRequest,
  type ScreenResult,
  type SimulationResult,
  type VerdictInput,
} from '@lantern/scanner';
import verdictSrc from '../packages/lantern-scanner/src/verdict.ts?raw';

// Stage 5 — Verdict: the deterministic risk core (#58). Pure, synchronous,
// no I/O, no clock, no model. Every named signal fires in isolation from a
// minimal input; the corpus is snapshotted so a verdict change in CI is a
// decision, not a surprise.

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
const FIXTURES = Object.entries(ON_DISK)
  .filter(([, v]) => 'xdr' in v)
  .map(([p, v]) => [p.replace(/^.*\//, '').replace(/\.json$/, ''), v as Fixture] as const)
  .sort(([a], [b]) => a.localeCompare(b));
const META = Object.entries(ON_DISK).find(([p]) => p.endsWith('/token-metadata.json'))![1] as {
  response: RawLedgerEntries;
};

const ME = 'GAMNECU4TYT4H7IBKGFXKJW3YACZSZTQUF2NOZSZECMYQ72RSB7USRNK';
const DEST = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const XLM = { code: 'XLM', decimals: 7 };

// ── Minimal inputs ───────────────────────────────────────────────────────────
const okSim = (over: Partial<SimulationResult> = {}): SimulationResult => ({
  ok: true,
  outcome: 'ok',
  decoded: {
    source: ME,
    operations: [{ type: 'payment', destination: DEST, amount: '1.0000000', assetCode: 'XLM' }],
    isSoroban: false,
  },
  simulated: false,
  auth: [],
  footprint: { readOnly: [], readWrite: [] },
  events: [],
  stateChanges: [],
  ...over,
});
const emptyAuth = (over: Partial<AuthTree> = {}): AuthTree => ({
  entries: [],
  calls: [],
  roots: [],
  nestedCount: 0,
  maxDepth: 0,
  unparseable: 0,
  analyzed: true,
  ...over,
});
const emptyEffects = (over: Partial<EffectSet> = {}): EffectSet => ({
  source: null,
  effects: [],
  deltas: [],
  net: [],
  closes: [],
  contractsTouched: [],
  approvals: [],
  unverified: [],
  observed: [],
  observedNet: [],
  coverage: 'full',
  ...over,
});
const cleanScreen = (over: Partial<ScreenResult> = {}): ScreenResult => ({
  outcome: 'clean',
  checked: [DEST],
  hits: [],
  unknown: [],
  answers: [],
  ...over,
});
const base = (over: Partial<VerdictInput> = {}): VerdictInput => ({
  simulation: okSim(),
  auth: emptyAuth(),
  effects: emptyEffects(),
  screen: cleanScreen(),
  context: { fromAddress: ME },
  ...over,
});
const codes = (v: ReturnType<typeof verdict>) => v.reasons.map((r) => r.code);

// ── Purity ───────────────────────────────────────────────────────────────────
describe('verdict: pure', () => {
  it('100 calls on one input give identical output, and the input is untouched', () => {
    const input = base({
      screen: cleanScreen({ outcome: 'flagged', hits: [{ address: DEST, source: 'registry' }] }),
    });
    const before = JSON.stringify(input);
    const first = JSON.stringify(verdict(input));
    for (let i = 0; i < 100; i += 1) expect(JSON.stringify(verdict(input))).toBe(first);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('imports nothing async, no explainer, no RPC, no model, no clock', () => {
    for (const forbidden of [
      /from '\.\/explainer'/,
      /from '\.\/rpc'/,
      /from '\.\/engine'/,
      /from '\.\/defi'/,
      /from '\.\/registry'/,
      /\basync\b/,
      /\bawait\b/,
      /\bfetch\b/,
      /\bDate\b/,
      /Math\.random/,
      /setTimeout/,
      /\bPromise\b/,
    ]) {
      expect(verdictSrc, String(forbidden)).not.toMatch(forbidden);
    }
    // And the token import is the constant only.
    expect(verdictSrc).toMatch(/import \{ LONG_LIVED_ALLOWANCE_LEDGERS \} from '\.\/token'/);
  });

  it('is deeply frozen and says what is not judged', () => {
    const v = verdict(base());
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.reasons)).toBe(true);
    expect(v.scope).toBe(NOT_JUDGED);
    expect(v.scope).toBe('effects shown, terms not judged');
  });
});

// ── Each named signal, in isolation ──────────────────────────────────────────
describe('verdict: signals', () => {
  it('nothing fires → low / allow, with the stage audit trail', () => {
    const v = verdict(base());
    expect(v.risk).toBe('low');
    expect(v.action).toBe('allow');
    expect(v.reasons).toEqual([]);
    expect(v.signals.map((s) => `${s.stage}:${s.code}`)).toEqual([
      'ingest:classic',
      'auth:flat',
      'effects:coverage_full',
      'screen:clean',
    ]);
  });

  it('ingest failure → high / block_confirm, per mode', () => {
    for (const [failure, code] of [
      ['undecodable', 'undecodable'],
      ['simulation_unavailable', 'simulation_unavailable'],
      ['rpc_timeout', 'rpc_timeout'],
      ['rpc_transport', 'rpc_unreachable'],
      ['simulation_malformed', 'simulation_malformed'],
      ['simulation_reverted', 'simulation_reverted'],
    ] as const) {
      const v = verdict(
        base({ simulation: okSim({ ok: false, outcome: 'failed', failure, error: 'x' }) }),
      );
      expect(v.risk).toBe('high');
      expect(v.action).toBe('block_confirm');
      expect(codes(v)).toEqual([code]);
      expect(v.signals[0]).toMatchObject({
        stage: 'ingest',
        code: 'fail_closed',
        ref: 'simulation',
      });
    }
    const archived = verdict(base({ simulation: okSim({ ok: false, outcome: 'unknown' }) }));
    expect(archived.risk).toBe('high');
    expect(codes(archived)).toEqual(['state_archived']);
  });

  it('auth failure → high', () => {
    const v = verdict(base({ auth: emptyAuth({ unparseable: 1 }) }));
    expect(v.risk).toBe('high');
    expect(codes(v)).toEqual(['auth_unreadable']);
    expect(v.signals.find((s) => s.stage === 'auth')).toMatchObject({
      code: 'fail_closed',
      ref: 'auth.unparseable',
    });
  });

  it('blacklisted counterparty → high, with the registry entry in the copy and provenance to the hit', () => {
    const v = verdict(
      base({
        screen: cleanScreen({
          outcome: 'flagged',
          hits: [
            {
              address: DEST,
              source: 'registry',
              entry: {
                subject: DEST,
                reporter: ME,
                reason: 'Scam',
                status: 'Active',
                evidence: '00',
                reportedAt: 1,
                updatedAt: 1,
                reports: 4,
                index: 0,
              },
            },
          ],
        }),
      }),
    );
    expect(v.risk).toBe('high');
    expect(v.action).toBe('block_confirm');
    expect(v.reasons[0]).toMatchObject({ code: 'reported_address', severity: 'high' });
    expect(v.reasons[0]?.detail).toMatch(/reported as Scam by GAMN…SRNK, 4 reports/);
    expect(v.signals.find((s) => s.code === 'reported_address')?.ref).toBe('screen.hits[0]');
  });

  it('unknown screening → medium, never low, for every reason', () => {
    for (const reason of ['archived', 'rpc_error', 'timeout', 'no_registry', 'malformed']) {
      const v = verdict(
        base({ screen: cleanScreen({ outcome: 'unknown', unknown: [{ address: DEST, reason }] }) }),
      );
      expect(v.risk).toBe('medium');
      expect(v.action).toBe('warn');
      expect(codes(v)).toEqual(['screen_unknown']);
      expect(v.signals.find((s) => s.code === 'screen_unknown')?.ref).toBe('screen.unknown[0]');
    }
  });

  it('unknown / unfunded destination → medium', () => {
    const v = verdict(base({ context: { fromAddress: ME, destinationFunded: false } }));
    expect(v.risk).toBe('medium');
    expect(codes(v)).toEqual(['new_account']);
    expect(v.signals.find((s) => s.code === 'new_account')?.ref).toBe('context.destinationFunded');
  });

  it('outflow vs balance: drains (≥ 90 %) is high, large share (≥ 50 %) is medium, exact arithmetic', () => {
    const net = (out: string, outIsTotal = false) =>
      emptyEffects({
        net: [
          {
            address: ME,
            asset: XLM,
            in: '0.0000000',
            inAtLeast: false,
            inIsTotal: false,
            out,
            outUpTo: false,
            outIsTotal,
          },
        ],
      });
    const ctx = { fromAddress: ME, spendableXlm: '100.0000000' };
    expect(codes(verdict(base({ effects: net('90.0000000'), context: ctx })))).toEqual([
      'drains_balance',
    ]);
    expect(verdict(base({ effects: net('90.0000000'), context: ctx })).risk).toBe('high');
    expect(codes(verdict(base({ effects: net('89.9999999'), context: ctx })))).toEqual([
      'large_share',
    ]);
    expect(codes(verdict(base({ effects: net('50.0000000'), context: ctx })))).toEqual([
      'large_share',
    ]);
    expect(codes(verdict(base({ effects: net('49.9999999'), context: ctx })))).toEqual([]);
    expect(codes(verdict(base({ effects: net('0.0000000', true), context: ctx })))).toEqual([
      'drains_balance',
    ]);
    expect(
      verdict(base({ effects: net('90.0000000'), context: ctx })).signals.find(
        (s) => s.code === 'drains_balance',
      )?.ref,
    ).toBe('net[GAMN…SRNK:XLM]');
  });

  it('unexpected outflow: simulation shows more leaving than the effects declare → high', () => {
    const observed = [
      {
        address: ME,
        direction: 'out' as const,
        asset: XLM,
        amount: '5.0000000',
        raw: '50000000',
        bound: 'exact' as const,
        opIndex: 0,
        source: 'simulation' as const,
      },
    ];
    const declared = [
      {
        address: ME,
        direction: 'out' as const,
        asset: XLM,
        amount: '1.0000000',
        raw: '10000000',
        bound: 'exact' as const,
        opIndex: 0,
        source: 'token' as const,
      },
    ];
    const v = verdict(base({ effects: emptyEffects({ observed, deltas: declared }) }));
    expect(v.risk).toBe('high');
    expect(codes(v)).toEqual(['unexpected_outflow']);
    expect(v.signals.find((s) => s.code === 'unexpected_outflow')).toMatchObject({
      ref: 'observed[0]',
      detail: 'observed 50000000 > declared 10000000',
    });
    // Declared ≥ observed: nothing fires.
    const ok = verdict(base({ effects: emptyEffects({ observed: declared, deltas: observed }) }));
    expect(codes(ok)).toEqual([]);
    // A nested outflow is a signal with provenance, not a reason.
    const nested = verdict(
      base({ effects: emptyEffects({ deltas: [{ ...declared[0]!, depth: 2 }] }) }),
    );
    expect(codes(nested)).toEqual([]);
    expect(nested.signals.find((s) => s.code === 'nested_outflow')?.ref).toBe('deltas[0]');
  });

  it('approval: unlimited → high; bounded but long-lived → medium; bounded short-lived → signal only', () => {
    const ap = (amount: string, unlimited: boolean, expirationLedger: number) =>
      emptyEffects({
        approvals: [
          {
            owner: ME,
            spender: DEST,
            asset: { code: 'USDC', decimals: 7 },
            amount,
            amountScaled: null,
            expirationLedger,
            unlimited,
            opIndex: 0,
            depth: 0,
          },
        ],
      });
    const sim = okSim({ simulated: true, latestLedger: 1_000_000 });
    const unlimited = verdict(
      base({
        simulation: sim,
        effects: ap('170141183460469231731687303715884105727', true, 1_000_100),
      }),
    );
    expect(unlimited.risk).toBe('high');
    expect(codes(unlimited)).toEqual(['unlimited_allowance']);
    expect(unlimited.signals.find((s) => s.code === 'unlimited_allowance')?.ref).toBe(
      'approvals[0]',
    );
    const longLived = verdict(
      base({ simulation: sim, effects: ap('1000000', false, 1_000_000 + 7_000_000) }),
    );
    expect(longLived.risk).toBe('medium');
    expect(codes(longLived)).toEqual(['long_lived_allowance']);
    const short = verdict(base({ simulation: sim, effects: ap('1000000', false, 1_000_100) }));
    expect(short.risk).toBe('low');
    expect(short.signals.map((s) => s.code)).toContain('allowance');
    // Unbounded horizon (no latestLedger) counts as long-lived.
    const noLedger = verdict(
      base({ simulation: okSim({ simulated: true }), effects: ap('1000000', false, 5) }),
    );
    expect(codes(noLedger)).toEqual(['long_lived_allowance']);
  });

  it('unverified contract → medium', () => {
    const v = verdict(
      base({
        effects: emptyEffects({
          coverage: 'partial',
          unverified: [
            {
              label: 'unverified contract — semantics unknown',
              contractId: 'CC4KSBTTPCKZUYBXB47SSZGXTKO6G23Y6LJOIR6YCOJVTGJZEYJCHBOH',
              functionName: 'submit',
              args: [],
              depth: 0,
            },
          ],
        }),
      }),
    );
    expect(v.risk).toBe('medium');
    expect(codes(v)).toEqual(['unverified_contract']);
    expect(v.reasons[0]?.detail).toMatch(/no balance changes, but that is not a guarantee/);
    expect(v.signals.find((s) => s.code === 'unverified_contract')?.ref).toBe('unverified');
  });

  it('account control: setOptions signer/threshold → high; masterWeight 0 says so', () => {
    const ops = (op: object) =>
      okSim({
        decoded: { source: ME, operations: [{ type: 'setOptions', ...op }], isSoroban: false },
      });
    const signer = verdict(base({ simulation: ops({ signerKey: DEST, signerWeight: 1 }) }));
    expect(signer.risk).toBe('high');
    expect(signer.reasons[0]).toMatchObject({
      code: 'account_control_change',
      title: 'Changes account control',
    });
    expect(signer.signals.find((s) => s.code === 'account_control_change')?.ref).toBe('ops[0]');
    const loses = verdict(base({ simulation: ops({ masterWeight: 0 }) }));
    expect(loses.reasons[0]?.title).toBe('Gives up account control');
    // A home-domain-only setOptions is not a control change.
    expect(codes(verdict(base({ simulation: ops({}) })))).toEqual([]);
  });

  it('account merge → high, with the target', () => {
    const v = verdict(
      base({ effects: emptyEffects({ closes: [{ address: ME, destination: DEST, opIndex: 0 }] }) }),
    );
    expect(v.risk).toBe('high');
    expect(codes(v)).toEqual(['account_merge']);
    expect(v.reasons[0]?.detail).toMatch(/GDVE…ZA57/);
    expect(v.signals.find((s) => s.code === 'account_merge')?.ref).toBe('closes[0]');
  });

  it('memo language → high; unrecognised op → medium; swap to another account → medium', () => {
    const memo = verdict(
      base({
        simulation: okSim({
          decoded: { source: ME, operations: [], isSoroban: false, memo: 'verify your seed' },
        }),
      }),
    );
    expect(codes(memo)).toEqual(['memo_language']);
    expect(memo.risk).toBe('high');
    const unrec = verdict(
      base({
        simulation: okSim({
          decoded: { source: ME, operations: [{ type: 'setTrustLineFlags' }], isSoroban: false },
        }),
      }),
    );
    expect(codes(unrec)).toEqual(['unrecognized_op']);
    expect(unrec.reasons[0]?.detail).toMatch(/set trust line flags/);
    const swap = verdict(
      base({
        simulation: okSim({
          decoded: {
            source: ME,
            operations: [{ type: 'pathPaymentStrictSend', destination: DEST }],
            isSoroban: false,
          },
        }),
      }),
    );
    expect(codes(swap)).toEqual(['swap_to_other']);
    const selfSwap = verdict(
      base({
        simulation: okSim({
          decoded: {
            source: ME,
            operations: [{ type: 'pathPaymentStrictSend', destination: ME }],
            isSoroban: false,
          },
        }),
      }),
    );
    expect(codes(selfSwap)).toEqual([]);
  });

  it('warn-don’t-block: the action follows the worst severity', () => {
    const v = verdict(
      base({
        context: { fromAddress: ME, destinationFunded: false },
        screen: cleanScreen({ outcome: 'flagged', hits: [{ address: DEST, source: 'registry' }] }),
      }),
    );
    expect(v.risk).toBe('high');
    expect(v.action).toBe('block_confirm');
    expect(codes(v)).toEqual(['reported_address', 'new_account']);
  });

  it('every reason has a signal with provenance', () => {
    const v = verdict(
      base({
        auth: emptyAuth({ unparseable: 1 }),
        context: { fromAddress: ME, destinationFunded: false },
        screen: cleanScreen({
          outcome: 'unknown',
          unknown: [{ address: DEST, reason: 'timeout' }],
        }),
        effects: emptyEffects({ closes: [{ address: ME, destination: DEST, opIndex: 0 }] }),
      }),
    );
    expect(v.reasons.length).toBeGreaterThanOrEqual(4);
    for (const r of v.reasons) {
      expect(typeof r.ref, r.code).toBe('string');
      expect(
        v.signals.some((s) => s.ref === r.ref),
        `${r.code} → ${r.ref}`,
      ).toBe(true);
    }
  });
});

// ── Corpus snapshots ─────────────────────────────────────────────────────────
describe('verdict: corpus snapshots', () => {
  const recordedResolver = async (id: string) => metadataFromLedgerEntries(META.response, id);
  const registryClean = async () => ({ outcome: 'not_flagged' as const, source: 'registry' });

  for (const [name, f] of FIXTURES) {
    it(`${name}`, async () => {
      const request: ScanRequest = {
        xdr: f.xdr,
        networkPassphrase: f.networkPassphrase,
        context: {
          network: 'TESTNET',
          fromAddress: f.source,
          destinationFunded: true,
          spendableXlm: '1000.0000000',
        },
      };
      const sim = await ingest(
        request,
        f.simulation ? { simulate: async () => f.simulation! } : {},
      );
      const tree = auth(sim);
      const set = effects(sim, tree, request, await resolveTokenMetadata(tree, recordedResolver));
      const scr = await screen(set, request, { screen: registryClean });
      const v = verdict({
        simulation: sim,
        auth: tree,
        effects: set,
        screen: scr,
        context: request.context,
      });
      expect({
        risk: v.risk,
        action: v.action,
        reasons: v.reasons.map((r) => `${r.severity}:${r.code}`),
        signals: v.signals.map((s) => `${s.stage}:${s.code}${s.ref ? '@' + s.ref : ''}`),
      }).toMatchSnapshot();
    });
  }
});
