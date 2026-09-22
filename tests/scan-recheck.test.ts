import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Account, Asset, BASE_FEE, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  entryLedgerKey,
  runPipeline,
  TESTNET_REGISTRY_ID,
  type RawSimulation,
  type ScanResult,
  type ScanVerdict,
  type ScreenAnswer,
} from '@lantern/scanner';
import {
  recheckDepsFor,
  resetWalletScanDeps,
  scanTx,
  toScanVerdict,
  type WalletScanInput,
} from '@core/scan/wallet';
import {
  cmpDecimal,
  decideRecheck,
  diffVerdicts,
  RECHECK_TIMEOUT_MS,
  recheckFailureOf,
  recheckTelemetry,
  recheckTx,
  type RecheckResult,
} from '@core/scan/recheck';
import { txRecheckedEvent } from '@core/telemetry/emits';
import { validateEvent } from '@core/telemetry/validate';
import sendSrc from '../src/popup/screens/Send.tsx?raw';
import appsSrc from '../src/popup/screens/Apps.tsx?raw';
import swapSrc from '../src/popup/screens/Swap.tsx?raw';
import earnSrc from '../src/popup/screens/Earn.tsx?raw';
import guardiansSrc from '../src/popup/screens/Guardians.tsx?raw';
import smartSrc from '../src/popup/screens/SmartAccount.tsx?raw';
import coSignSrc from '../src/popup/screens/CoSignRecovery.tsx?raw';
import hookSrc from '../src/popup/hooks/useRecheck.ts?raw';
import recheckSrc from '../src/core/scan/recheck.ts?raw';

// The re-check before submit (#121, SOW §3.9): the diff on the decision-
// bearing subset, the branch table a confirm handler follows, the TTL-cache
// bypass, and the hard timeout. Offline: recorded fixtures + stub screeners.

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
  for (const [path, value] of Object.entries(ON_DISK)) {
    if (path.endsWith(`/${name}.json`) && typeof value.xdr === 'string') return value;
  }
  throw new Error(`no fixture named ${name}`);
}
const recorded = (f: Fixture) => async (xdr: string) => {
  if (xdr !== f.xdr) throw new Error('unexpected XDR');
  if (!f.simulation) throw new Error('no recorded simulation');
  return f.simulation;
};

const FLAGGED = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const ENTRY = {
  subject: FLAGGED,
  reporter: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
  reason: 'Scam',
  status: 'Active' as const,
  reports: 3,
  reportedAt: 1,
  updatedAt: 1,
  evidence: '00'.repeat(32),
  index: 0,
};
const notFlagged = async (_a: string): Promise<ScreenAnswer> => ({ outcome: 'not_flagged', source: 'stub' });
const flagged = async (address: string): Promise<ScreenAnswer> =>
  address === FLAGGED
    ? { outcome: 'flagged', source: 'registry', entry: ENTRY }
    : { outcome: 'not_flagged', source: 'stub' };
const rpcDown = async (_a: string): Promise<ScreenAnswer> => ({
  outcome: 'unknown',
  reason: 'rpc_error',
  source: 'registry',
});

function input(f: Fixture, extra: Record<string, unknown> = {}): WalletScanInput {
  return {
    xdr: f.xdr,
    networkPassphrase: f.networkPassphrase,
    rpcUrl: 'https://rpc.invalid',
    context: { network: 'TESTNET' as const, fromAddress: f.source, destinationFunded: true, ...extra },
  };
}

const base: ScanVerdict = {
  risk: 'low',
  action: 'allow',
  reasons: [],
  explanation: 'This sends 25 XLM.',
  checkedBy: 'Lantern',
  tier: 1,
  latencyMs: 300,
  screening: [{ address: FLAGGED, answer: { outcome: 'not_flagged', source: 'stub' } }],
  net: [],
  approvals: [],
};

beforeEach(() => resetWalletScanDeps());
afterEach(() => vi.unstubAllGlobals());

// ── The headline case ────────────────────────────────────────────────────────

describe('an address reported between review and confirm', () => {
  it('produces direction: escalated and blocks the submit', async () => {
    const f = fixture('classic-payment-to-flagged');
    const reviewed = await scanTx(input(f), { screen: notFlagged });
    expect(reviewed.risk).toBe('low');

    const result = await recheckTx(reviewed, input(f), { depsOverride: { screen: flagged } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdict.risk).toBe('high');
    expect(result.drift).toMatchObject({ drifted: true, direction: 'escalated' });
    if (!result.drift.drifted) return;
    const screening = result.drift.changes.find((c) => c.kind === 'screening');
    expect(screening).toMatchObject({ address: FLAGGED, escalation: true });
    expect(screening?.detail).toMatch(/reported as scam while you were reviewing \(3 reports\)/);

    const decision = decideRecheck(reviewed, result, false);
    expect(decision.proceed).toBe(false);
    expect(decision.state.kind).toBe('escalated');
    // The review re-renders with the FRESH verdict — which now carries the
    // high-risk gate the user has not satisfied.
    expect(decision.verdict.action).toBe('block_confirm');
  });

  it('the high-risk gate cannot be satisfied by a pre-escalation confirmation', async () => {
    // Even if the user had typed CONFIRM (or held the button) on the reviewed
    // verdict, the decision is `proceed: false` and `acknowledged` — the
    // "couldn't re-check, sign anyway" flag — is irrelevant to an escalation.
    const f = fixture('classic-payment-to-flagged');
    const reviewed = await scanTx(input(f), { screen: notFlagged });
    const result = await recheckTx(reviewed, input(f), { depsOverride: { screen: flagged } });
    expect(decideRecheck(reviewed, result, true).proceed).toBe(false);
    // And every confirm handler wipes the typed CONFIRM when it aborts, so
    // the fresh verdict's gate starts empty.
    for (const [name, src] of Object.entries({ sendSrc, appsSrc, swapSrc, earnSrc, guardiansSrc, smartSrc, coSignSrc })) {
      expect(src, name).toMatch(/if \(!rc\.proceed\) \{\s*setConfirmText\(''\);/);
    }
  });
});

// ── Things that must never count as drift ────────────────────────────────────

describe('what the diff ignores', () => {
  it('a changed explainer sentence alone is drifted: false — the AI layer cannot block', () => {
    const fresh: ScanVerdict = {
      ...base,
      explanation: 'A completely different sentence from a non-deterministic model.',
      reasons: [{ code: 'x', severity: 'high', title: 'Made up', detail: 'by the explainer' }],
      tier: 2,
      latencyMs: 9_000,
    };
    expect(diffVerdicts(base, fresh)).toEqual({ drifted: false });
  });

  it('sequence number, fee and time-bound differences alone are drifted: false', async () => {
    const source = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
    const build = (seq: string, fee: string, timeout: number) =>
      new TransactionBuilder(new Account(source, seq), { fee, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({ destination: FLAGGED, asset: Asset.native(), amount: '25' }))
        .setTimeout(timeout)
        .build()
        .toXDR();
    const ctx = { network: 'TESTNET' as const, fromAddress: source, destinationFunded: true };
    const a = await scanTx({ xdr: build('1', BASE_FEE, 180), networkPassphrase: Networks.TESTNET, context: ctx }, { screen: notFlagged });
    const b = await scanTx({ xdr: build('999', '5000', 30), networkPassphrase: Networks.TESTNET, context: ctx }, { screen: notFlagged });
    expect(a.net).toHaveLength(2);
    expect(diffVerdicts(a, b)).toEqual({ drifted: false });
  });

  it('never reads the sentence, the sequence, the fee or the time bounds', () => {
    // Property reads of the ignored fields — mentions in comments don't count.
    for (const field of ['.explanation', '.sequence', '.timeBounds', '.fee', '.latencyMs', '.reasons', '.tier']) {
      const uses = recheckSrc.split('\n').filter((l) => !l.trim().startsWith('//') && l.includes(field));
      expect(uses, field).toEqual([]);
    }
  });
});

// ── The rest of the decision-bearing subset ──────────────────────────────────

describe('net movements and approvals', () => {
  const xlm = { code: 'XLM', decimals: 7 };
  const net = (address: string, out: string, inn: string) => ({
    address,
    asset: xlm,
    in: inn,
    inAtLeast: false,
    inIsTotal: false,
    out,
    outUpTo: false,
    outIsTotal: false,
  });
  const me = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';

  it('more leaving, or less arriving, escalates; less leaving is lateral', () => {
    const reviewed = { ...base, net: [net(me, '25', '0'), net(FLAGGED, '0', '25')] };
    expect(diffVerdicts(reviewed, { ...base, net: [net(me, '26', '0'), net(FLAGGED, '0', '25')] })).toMatchObject({
      direction: 'escalated',
      changes: [{ kind: 'delta', address: me, escalation: true }],
    });
    expect(diffVerdicts(reviewed, { ...base, net: [net(me, '25', '0'), net(FLAGGED, '0', '24')] })).toMatchObject({
      direction: 'escalated',
    });
    expect(diffVerdicts(reviewed, { ...base, net: [net(me, '20', '0'), net(FLAGGED, '0', '25')] })).toMatchObject({
      direction: 'lateral',
    });
    // A new outflow the review never showed.
    expect(diffVerdicts(reviewed, { ...base, net: [...reviewed.net, { ...net(me, '5', '0'), asset: { code: 'USDC', decimals: 7 } }] })).toMatchObject({
      direction: 'escalated',
    });
  });

  it('a new, larger or now-unlimited allowance escalates', () => {
    const approval = {
      owner: me,
      spender: 'CDNCUDGEUEPOEJOOKQGKXN3RBMBCLVBFRLSHUD6O7WVSMECTQRCW656Z',
      asset: xlm,
      amount: '1000000000',
      amountScaled: '100',
      expirationLedger: 1,
      unlimited: false,
      opIndex: 0,
      depth: 0,
    };
    expect(diffVerdicts(base, { ...base, approvals: [approval] })).toMatchObject({ direction: 'escalated' });
    const reviewed = { ...base, approvals: [approval] };
    expect(diffVerdicts(reviewed, { ...base, approvals: [{ ...approval, unlimited: true }] })).toMatchObject({
      direction: 'escalated',
      changes: [{ kind: 'approval', detail: expect.stringMatching(/became unlimited/) }],
    });
    expect(diffVerdicts(reviewed, { ...base, approvals: [{ ...approval, amount: '2000000000', amountScaled: '200' }] })).toMatchObject({
      direction: 'escalated',
    });
    expect(diffVerdicts(reviewed, { ...base, approvals: [{ ...approval, amount: '1', amountScaled: '0.0000001' }] })).toMatchObject({
      direction: 'lateral',
    });
    expect(diffVerdicts(reviewed, { ...base, approvals: [] })).toMatchObject({ direction: 'lateral' });
  });

  it('a flag that lifted, or a risk that fell, is de-escalated', () => {
    const reviewedHigh: ScanVerdict = {
      ...base,
      risk: 'high',
      action: 'block_confirm',
      screening: [{ address: FLAGGED, answer: { outcome: 'flagged', source: 'registry', entry: ENTRY } }],
    };
    expect(diffVerdicts(reviewedHigh, base)).toMatchObject({ direction: 'de-escalated' });
  });

  it('cmpDecimal is exact', () => {
    expect(cmpDecimal('25', '25.0')).toBe(0);
    expect(cmpDecimal('25.0000001', '25')).toBe(1);
    expect(cmpDecimal('-1', '0')).toBe(-1);
    expect(cmpDecimal('123456789012345678901234567890.5', '123456789012345678901234567890.4')).toBe(1);
  });
});

// ── The branch table ─────────────────────────────────────────────────────────

describe('decideRecheck — what the confirm handler does next', () => {
  const failed = { ok: false as const, failure: 'timeout' as const, latencyMs: 2_500 };

  it('re-scan failure on a previously-low transaction requires an explicit confirm', () => {
    const first = decideRecheck(base, failed, false);
    expect(first).toMatchObject({ proceed: false, state: { kind: 'failed', refused: false } });
    const second = decideRecheck(base, failed, true);
    expect(second).toMatchObject({ proceed: true, verdict: base });
  });

  it('re-scan failure on a previously-high transaction refuses, acknowledged or not', () => {
    const high: ScanVerdict = { ...base, risk: 'high', action: 'block_confirm' };
    expect(decideRecheck(high, failed, false)).toMatchObject({ proceed: false, state: { refused: true } });
    expect(decideRecheck(high, failed, true)).toMatchObject({ proceed: false, state: { refused: true } });
  });

  it('no drift, lateral and de-escalated all proceed with the fresh verdict rendered', () => {
    const fresh = { ...base, explanation: 'fresh' };
    for (const drift of [
      { drifted: false as const },
      { drifted: true as const, direction: 'lateral' as const, changes: [] },
      { drifted: true as const, direction: 'de-escalated' as const, changes: [] },
    ]) {
      const d = decideRecheck(base, { ok: true, verdict: fresh, drift, latencyMs: 1 }, false);
      expect(d.proceed).toBe(true);
      expect(d.verdict).toBe(fresh);
      expect(d.state.kind).toBe('passed');
    }
  });

  it('the hook only remembers an acknowledgement for the same xdr, and never for high', () => {
    expect(hookSrc).toMatch(/acknowledgedXdr\.current === input\.xdr/);
    // The retry re-runs the re-check and hands the acknowledgement to the
    // pure decision — it never short-circuits recheckTx().
    expect(hookSrc).toMatch(/decideRecheck\(reviewed, result, acknowledged\)/);
    expect(hookSrc).not.toMatch(/return \{ proceed: true, verdict: reviewed/);
    expect(hookSrc).toMatch(/decision\.state\.kind === 'failed' && !decision\.state\.refused \? input\.xdr : null/);
  });
});

// ── Failure detection, timeout, telemetry ────────────────────────────────────

describe('a re-check that could not look is a failure, not an escalation', () => {
  it('registry unreachable on a previously-known address → failed (rpc), not escalated', async () => {
    const f = fixture('classic-payment-to-flagged');
    const reviewed = await scanTx(input(f), { screen: notFlagged });
    const result = await recheckTx(reviewed, input(f), { depsOverride: { screen: rpcDown } });
    expect(result).toMatchObject({ ok: false, failure: 'rpc' });
  });

  it('RPC down for a Soroban transaction → failed, not the pipeline\'s fail-closed high', async () => {
    const f = fixture('sac-transfer');
    const reviewed = await scanTx(input(f), { simulate: recorded(f), screen: notFlagged });
    const result = await recheckTx(reviewed, input(f), {
      depsOverride: {
        simulate: async () => {
          throw Object.assign(new Error('down'), { kind: 'transport' });
        },
        screen: notFlagged,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['rpc', 'timeout', 'error']).toContain(result.failure);
  });

  it('recheckFailureOf reads the simulation failure and the screen reasons', () => {
    const fresh = (over: Partial<ScanResult['simulation']>, answers: ScanResult['screen']['answers'] = []) =>
      ({ simulation: { failure: undefined, ...over }, screen: { answers } }) as unknown as ScanResult;
    expect(recheckFailureOf(base, fresh({ failure: 'rpc_timeout' }))).toBe('timeout');
    expect(recheckFailureOf(base, fresh({ failure: 'rpc_transport' }))).toBe('rpc');
    // The contract would now revert: that is a real change, not a failure.
    expect(recheckFailureOf(base, fresh({ failure: 'simulation_reverted' }))).toBeNull();
    expect(recheckFailureOf(base, fresh({}, [{ address: FLAGGED, answer: { outcome: 'unknown', reason: 'timeout', source: 'registry' } }]))).toBe('timeout');
    // An address that was already unknown at review is not a new failure.
    const unknownBefore = { ...base, screening: [{ address: FLAGGED, answer: { outcome: 'unknown' as const, reason: 'archived', source: 'registry' } }] };
    expect(recheckFailureOf(unknownBefore, fresh({}, [{ address: FLAGGED, answer: { outcome: 'unknown', reason: 'rpc_error', source: 'registry' } }]))).toBeNull();
  });

  it('a hung screener hits the hard timeout', async () => {
    expect(RECHECK_TIMEOUT_MS).toBe(2_500);
    const f = fixture('classic-payment-to-flagged');
    const reviewed = await scanTx(input(f), { screen: notFlagged });
    const hang = () => new Promise<ScreenAnswer>(() => {});
    const started = Date.now();
    const result = await recheckTx(reviewed, input(f), { depsOverride: { screen: hang }, timeoutMs: 40 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result).toMatchObject({ ok: false, failure: 'timeout' });
  });

  it('tx_rechecked carries drifted + direction only, and validates', () => {
    const cases: Array<[RecheckResult, ReturnType<typeof recheckTelemetry>]> = [
      [{ ok: false, failure: 'timeout', latencyMs: 1 }, { drifted: false, direction: 'failed' }],
      [{ ok: true, verdict: base, drift: { drifted: false }, latencyMs: 1 }, { drifted: false, direction: 'none' }],
      [
        { ok: true, verdict: base, drift: { drifted: true, direction: 'de-escalated', changes: [] }, latencyMs: 1 },
        { drifted: true, direction: 'de_escalated' },
      ],
    ];
    for (const [result, expected] of cases) {
      const t = recheckTelemetry(result);
      expect(t).toEqual(expected);
      expect(validateEvent({ ...txRecheckedEvent(t), ts: 1 })).toBe(true);
    }
    expect(validateEvent({ name: 'tx_rechecked', props: { drifted: true, direction: 'escalated', address: FLAGGED }, ts: 1 })).toBe(false);
  });

  it('PUBLIC (legacy engine) re-checks synchronously and never drifts', async () => {
    const f = fixture('classic-payment-to-flagged');
    const pub: WalletScanInput = {
      xdr: f.xdr,
      networkPassphrase: Networks.PUBLIC,
      context: { network: 'PUBLIC', fromAddress: f.source, destinationFunded: true },
    };
    const reviewed = await scanTx(pub);
    const result = await recheckTx(reviewed, pub);
    expect(result).toMatchObject({ ok: true, drift: { drifted: false } });
  });
});

// ── The TTL-cache bypass ─────────────────────────────────────────────────────

describe('the re-check bypasses the screener TTL cache for this transaction', () => {
  it('scanTx answers from the 60 s cache; recheckTx sees the report that landed after', async () => {
    const f = fixture('classic-payment-to-flagged');
    const rpcUrl = 'https://rpc.stub.invalid';
    // A fake Soroban RPC whose registry answer for FLAGGED flips mid-test:
    // the recorded hot-read body (a live Active entry) once `reported`.
    const hot = ON_DISK[Object.keys(ON_DISK).find((p) => p.endsWith('/registry-hot-read.json'))!] as unknown as {
      keys: { flagged: string };
      response: { result: { latestLedger: number; entries: Array<{ key: string; xdr: string; liveUntilLedgerSeq?: number }> } };
    };
    const live = hot.response.result.entries.find((e) => e.key === hot.keys.flagged)!;
    expect(live.key).toBe(entryLedgerKey(TESTNET_REGISTRY_ID, FLAGGED));
    let reported = false;
    const seen: string[] = [];
    const fetchStub = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}') as { method: string; params: { keys: string[] } };
      seen.push(body.method);
      if (body.method !== 'getLedgerEntries') throw new Error(`unexpected ${body.method}`);
      const entries = reported && body.params.keys.includes(live.key) ? [live] : [];
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: { latestLedger: hot.response.result.latestLedger, entries } }),
      };
    });
    vi.stubGlobal('fetch', fetchStub);

    const inp = { ...input(f), rpcUrl };
    const reviewed = await scanTx(inp);
    expect(reviewed.screening?.find((s) => s.address === FLAGGED)?.answer.outcome).toBe('not_flagged');
    const reads = seen.length;

    reported = true;
    // The shared screener still answers from its cache — no new read.
    const stale = await scanTx(inp);
    expect(stale.screening?.find((s) => s.address === FLAGGED)?.answer.outcome).toBe('not_flagged');
    expect(seen.length).toBe(reads);

    // The re-check's screener has no TTL: it reads again and sees the report.
    const fresh = await recheckTx(reviewed, inp);
    expect(seen.length).toBeGreaterThan(reads);
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.verdict.screening?.find((s) => s.address === FLAGGED)?.answer.outcome).toBe('flagged');
    expect(fresh.drift).toMatchObject({ direction: 'escalated' });
    // …and it did not write into the shared cache either: the shared screener
    // still returns its cached answer.
    const after = await scanTx(inp);
    expect(after.screening?.find((s) => s.address === FLAGGED)?.answer.outcome).toBe('not_flagged');
    // Same token cache, separate screener — the recheck deps are distinct.
    expect(recheckDepsFor(rpcUrl).screen).not.toBe(recheckDepsFor(rpcUrl).resolveToken);
  });
});

// ── Wiring ───────────────────────────────────────────────────────────────────

describe('every confirm handler re-checks the exact XDR it signs', () => {
  it('seven screens call recheck.guard before signing and render the notice', () => {
    for (const [name, src] of Object.entries({ sendSrc, appsSrc, swapSrc, earnSrc, guardiansSrc, smartSrc, coSignSrc })) {
      expect(src, name).toMatch(/await recheck\.guard\(/);
      expect(src, name).toMatch(/<RecheckNotice state=\{recheck\.state\} \/>/);
      // The guard runs BEFORE the sign message, in source order.
      const guardAt = src.indexOf('await recheck.guard(');
      const signAt = src.search(/type: 'SIGN_AND_SUBMIT'|type: 'SIGN_ONLY'|finalizePasskeyTransfer\(\{/);
      expect(guardAt, name).toBeGreaterThan(0);
      expect(signAt, name).toBeGreaterThan(guardAt);
    }
  });

  it('the reviewed XDR is the signed XDR (pinned in the module header)', () => {
    expect(recheckSrc).toMatch(/IS THE XDR REVIEWED THE XDR SIGNED\? Yes, byte-identical/);
    expect(sendSrc).toMatch(/xdr: review\.xdr/);
    expect(appsSrc).toMatch(/xdr: signReq\.xdr/);
    expect(coSignSrc).toMatch(/xdr: xdr\.trim\(\)/);
    expect(smartSrc).toMatch(/preparedXdr: review\.xdr/);
  });

  it('toScanVerdict carries net + approvals for the diff', async () => {
    const f = fixture('sep41-approve');
    const result = await runPipeline(
      { xdr: f.xdr, networkPassphrase: f.networkPassphrase, context: { network: 'TESTNET', fromAddress: f.source } },
      { simulate: recorded(f), screen: notFlagged },
    );
    const v = toScanVerdict(result, 1);
    expect(v.approvals?.length).toBeGreaterThan(0);
    expect(v.net).toBeDefined();
  });
});
