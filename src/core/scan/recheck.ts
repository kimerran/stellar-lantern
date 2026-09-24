// Re-simulate immediately before submit (#121, Deliverable 3 slice 3) — the
// SOW §3.9 mitigation for a stale simulation (time-of-check / time-of-use).
//
// #84 scans once, when the review opens. Between then and the tap on Sign an
// arbitrary amount of time passes, and in that window the counterparty can be
// reported to the registry (our own D1 contract makes that fast — a defender
// flagging a drainer mid-attack is the registry's success case), simulation
// state can change, or a mini-app can ask again. Signing against a verdict
// of unbounded age while the badge asserts freshness is worse than not
// checking. So every confirm handler re-runs the pipeline on the exact XDR
// about to be signed, diffs the decision-bearing subset, and blocks on an
// escalation.
//
// IS THE XDR REVIEWED THE XDR SIGNED? Yes, byte-identical, on every screen —
// pinned before this diff was written. Send / Swap / Earn / Guardians / Apps
// build the transaction once, keep the string in state (`review.xdr`,
// `signReq.xdr`) and hand that same string to SIGN_AND_SUBMIT; CoSignRecovery
// signs the pasted string it scanned; SmartAccount adds the passkey auth
// signature to `review.xdr` without touching its operations. A mini-app
// never holds the XDR at all — it sends a payment *intent*, the wallet builds
// the transaction and a second intent replaces the pending review wholesale
// (src/core/miniapps/bridge.ts). So the diff below compares two scans of ONE
// transaction against two ledger states; sequence, fee and time bounds cannot
// differ, and are not looked at regardless.
//
// What IS compared — the decision-bearing subset:
//   - `risk` / `action`
//   - each address's registry outcome (not_flagged → flagged is the headline)
//   - net balance movement per address + asset (more out, or less in)
//   - token approvals (new, larger, or now unlimited)
// What is IGNORED, structurally — never read by the diff: the explainer
// sentence (the AI layer is non-deterministic and must never be able to block
// a transaction, the same rule as D2's frozen verdict), `reasons`, `tier`,
// `latencyMs`, and anything about the envelope itself.

import {
  runPipeline,
  scan,
  type Approval,
  type NetDelta,
  type PipelineDeps,
  type RegistryEntry,
  type RiskLevel,
  type ScanResult,
  type ScanVerdict,
} from '@lantern/scanner';
import {
  recheckDepsFor,
  toScanVerdict,
  usesLegacy,
  withoutRegistry,
  type WalletScanInput,
} from './wallet';

// ── The diff ─────────────────────────────────────────────────────────────────

export type DriftDirection = 'escalated' | 'de-escalated' | 'lateral';

export interface DriftChange {
  kind: 'risk' | 'screening' | 'delta' | 'approval';
  // The address the change is about (a counterparty, an approval's spender,
  // or the account whose balance moves). Absent for the overall risk.
  address?: string;
  // One plain-language line, for the review.
  detail: string;
  escalation: boolean;
}

export type VerdictDrift =
  | { drifted: false }
  | { drifted: true; changes: DriftChange[]; direction: DriftDirection };

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function flaggedLine(address: string, entry?: RegistryEntry): string {
  const what = entry ? `reported as ${entry.reason.toLowerCase()}` : 'reported to the registry';
  const count = entry && entry.reports > 1 ? ` (${entry.reports} reports)` : '';
  return `${short(address)} was ${what} while you were reviewing${count}.`;
}

// Compare two decimal strings exactly (no floats): -1 / 0 / 1.
export function cmpDecimal(a: string, b: string): number {
  const norm = (s: string) => {
    const neg = s.startsWith('-');
    const [w = '0', f = ''] = (neg ? s.slice(1) : s).split('.');
    return { neg, w, f };
  };
  const x = norm(a);
  const y = norm(b);
  const width = Math.max(x.f.length, y.f.length);
  const toInt = (v: { neg: boolean; w: string; f: string }) =>
    BigInt(`${v.neg ? '-' : ''}${v.w}${v.f.padEnd(width, '0')}`);
  const xi = toInt(x);
  const yi = toInt(y);
  return xi < yi ? -1 : xi > yi ? 1 : 0;
}

const assetLabel = (n: { asset: { code: string; issuer?: string; contractId?: string } }) =>
  n.asset.code;
const netKey = (n: NetDelta) =>
  `${n.address}|${n.asset.code}|${n.asset.issuer ?? ''}|${n.asset.contractId ?? ''}`;
const approvalKey = (a: Approval) =>
  `${a.owner}|${a.spender}|${a.asset.code}|${a.asset.issuer ?? ''}|${a.asset.contractId ?? ''}`;

/**
 * What changed between the verdict the user reviewed and a fresh one for the
 * same transaction, on the decision-bearing fields only. `direction` is
 * `escalated` if ANY change is an escalation; otherwise `de-escalated` when
 * the risk fell or an address stopped being flagged; otherwise `lateral`.
 */
export function diffVerdicts(reviewed: ScanVerdict, fresh: ScanVerdict): VerdictDrift {
  const changes: DriftChange[] = [];
  // Tracked structurally, not by matching the copy: set only in the two
  // branches that are relief (risk fell; an address stopped being flagged).
  let relief = false;

  // Risk / action.
  if (
    RANK[fresh.risk] > RANK[reviewed.risk] ||
    (fresh.action === 'block_confirm' && reviewed.action !== 'block_confirm')
  ) {
    changes.push({
      kind: 'risk',
      detail: `The risk went from ${reviewed.risk} to ${fresh.risk} since you opened this review.`,
      escalation: true,
    });
  } else if (RANK[fresh.risk] < RANK[reviewed.risk]) {
    relief = true;
    changes.push({
      kind: 'risk',
      detail: `The risk went from ${reviewed.risk} to ${fresh.risk} since you opened this review.`,
      escalation: false,
    });
  }

  // Registry outcome per address. Missing on one side = unknown to that side.
  const before = new Map((reviewed.screening ?? []).map((s) => [s.address, s.answer]));
  const after = new Map((fresh.screening ?? []).map((s) => [s.address, s.answer]));
  for (const address of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(address)?.outcome ?? 'unknown';
    const a = after.get(address)?.outcome ?? 'unknown';
    if (a === b) continue;
    if (a === 'flagged') {
      changes.push({
        kind: 'screening',
        address,
        detail: flaggedLine(address, after.get(address)?.entry),
        escalation: true,
      });
    } else if (b === 'flagged') {
      relief = true;
      changes.push({
        kind: 'screening',
        address,
        detail: `${short(address)} is no longer flagged on the registry.`,
        escalation: false,
      });
    } else {
      changes.push({
        kind: 'screening',
        address,
        detail:
          a === 'unknown'
            ? `${short(address)} could not be checked against the registry this time.`
            : `${short(address)} now checks clean on the registry.`,
        escalation: false,
      });
    }
  }

  // Net movements: more leaving, or less arriving, is an escalation.
  if (reviewed.net && fresh.net) {
    const b = new Map(reviewed.net.map((n) => [netKey(n), n]));
    const a = new Map(fresh.net.map((n) => [netKey(n), n]));
    for (const key of new Set([...b.keys(), ...a.keys()])) {
      const x = b.get(key);
      const y = a.get(key);
      if (!x && y) {
        const moves = y.outIsTotal || cmpDecimal(y.out, '0') > 0;
        changes.push({
          kind: 'delta',
          address: y.address,
          detail: moves
            ? `${assetLabel(y)} would now leave ${short(y.address)}: ${y.outIsTotal ? 'the whole balance' : y.out}.`
            : `${short(y.address)} would now receive ${y.in} ${assetLabel(y)}.`,
          escalation: moves,
        });
        continue;
      }
      if (x && !y) {
        changes.push({
          kind: 'delta',
          address: x.address,
          detail: `${assetLabel(x)} no longer moves for ${short(x.address)}.`,
          escalation: false,
        });
        continue;
      }
      if (!x || !y) continue;
      const outUp = (y.outIsTotal && !x.outIsTotal) || cmpDecimal(y.out, x.out) > 0;
      const inDown = (x.inIsTotal && !y.inIsTotal) || cmpDecimal(y.in, x.in) < 0;
      if (outUp) {
        changes.push({
          kind: 'delta',
          address: y.address,
          detail: `More ${assetLabel(y)} would leave ${short(y.address)}: ${y.outIsTotal ? 'the whole balance' : y.out} instead of ${x.out}.`,
          escalation: true,
        });
      } else if (inDown) {
        changes.push({
          kind: 'delta',
          address: y.address,
          detail: `${short(y.address)} would receive less ${assetLabel(y)}: ${y.in} instead of ${x.in}.`,
          escalation: true,
        });
      } else if (cmpDecimal(y.out, x.out) !== 0 || cmpDecimal(y.in, x.in) !== 0) {
        changes.push({
          kind: 'delta',
          address: y.address,
          detail: `${assetLabel(y)} movement for ${short(y.address)} changed: out ${y.out}, in ${y.in}.`,
          escalation: false,
        });
      }
    }
  }

  // Approvals: new, larger, or now unlimited is an escalation.
  if (reviewed.approvals && fresh.approvals) {
    const b = new Map(reviewed.approvals.map((p) => [approvalKey(p), p]));
    const a = new Map(fresh.approvals.map((p) => [approvalKey(p), p]));
    for (const key of new Set([...b.keys(), ...a.keys()])) {
      const x = b.get(key);
      const y = a.get(key);
      if (!x && y) {
        changes.push({
          kind: 'approval',
          address: y.spender,
          detail: `${short(y.spender)} would now be allowed to spend ${y.unlimited ? 'an unlimited amount of' : (y.amountScaled ?? y.amount)} ${assetLabel(y)}.`,
          escalation: true,
        });
        continue;
      }
      if (x && !y) {
        changes.push({
          kind: 'approval',
          address: x.spender,
          detail: `The allowance for ${short(x.spender)} is no longer part of this transaction.`,
          escalation: false,
        });
        continue;
      }
      if (!x || !y) continue;
      if ((y.unlimited && !x.unlimited) || cmpDecimal(y.amount, x.amount) > 0) {
        changes.push({
          kind: 'approval',
          address: y.spender,
          detail: y.unlimited
            ? `The allowance for ${short(y.spender)} became unlimited.`
            : `The allowance for ${short(y.spender)} grew to ${y.amountScaled ?? y.amount} ${assetLabel(y)}.`,
          escalation: true,
        });
      } else if (cmpDecimal(y.amount, x.amount) < 0) {
        changes.push({
          kind: 'approval',
          address: y.spender,
          detail: `The allowance for ${short(y.spender)} shrank to ${y.amountScaled ?? y.amount} ${assetLabel(y)}.`,
          escalation: false,
        });
      }
    }
  }

  if (changes.length === 0) return { drifted: false };
  if (changes.some((c) => c.escalation)) return { drifted: true, changes, direction: 'escalated' };
  return { drifted: true, changes, direction: relief ? 'de-escalated' : 'lateral' };
}

// ── The re-check itself ──────────────────────────────────────────────────────

// Hard ceiling on the critical path (#121 §3): typical ≤ 1.5 s, and past this
// the re-check is treated as failed — never as a silent pass.
export const RECHECK_TIMEOUT_MS = 2_500;

// `unverified`: the fresh screening still could not read a counterparty
// (registry unreachable, entry archived, no registry) — the transaction would
// be signed against an unscreened recipient, so it takes the same explicit
// second confirm as a re-check that could not look at all (#148).
export type RecheckFailure = 'timeout' | 'rpc' | 'error' | 'unverified';

export type RecheckResult =
  | { ok: true; verdict: ScanVerdict; drift: VerdictDrift; latencyMs: number }
  | { ok: false; failure: RecheckFailure; latencyMs: number };

// A fresh run that could not actually look is a failure, not a verdict — the
// pipeline fails closed to `high` when the RPC is down, and the registry
// answers `unknown` on a transport error, and either would otherwise read as
// an "escalation" and block a legitimate transaction with a misleading reason.
//
// A counterparty whose fresh screening is `unknown` is always a failure, even
// when it was already unknown at review (#148): `screen_unknown` is only a
// medium/warn verdict, so the review offers a plain one-tap Confirm & Send,
// and skipping it here let an unverified recipient sign on the first tap.
// Transport reasons on an address that WAS known keep their precise failure
// (`timeout` / `rpc`); anything else is `unverified`. unknown → flagged never
// reaches this branch (the fresh answer is `flagged`, so the diff escalates),
// and unknown → clean has no unknown answer, so it passes on the first tap.
export function recheckFailureOf(reviewed: ScanVerdict, fresh: ScanResult): RecheckFailure | null {
  const f = fresh.simulation.failure;
  if (f === 'rpc_timeout') return 'timeout';
  if (f === 'rpc_transport' || f === 'simulation_malformed') return 'rpc';
  const before = new Map((reviewed.screening ?? []).map((s) => [s.address, s.answer]));
  let unverified = false;
  for (const { address, answer } of fresh.screen.answers) {
    if (answer.outcome !== 'unknown') continue;
    const was = before.get(address)?.outcome;
    if (was !== undefined && was !== 'unknown') {
      if (answer.reason === 'timeout') return 'timeout';
      if (answer.reason === 'rpc_error' || answer.reason === 'malformed') return 'rpc';
    }
    unverified = true;
  }
  return unverified ? 'unverified' : null;
}

/**
 * Re-run the scanner on the exact XDR about to be signed and diff it against
 * the verdict the user reviewed. Bounded by RECHECK_TIMEOUT_MS. Never throws.
 * `depsOverride` is a test seam; the wallet uses `recheckDepsFor(rpcUrl)`,
 * whose screener has no TTL cache (see wallet.ts).
 */
export async function recheckTx(
  reviewed: ScanVerdict,
  input: WalletScanInput,
  opts: { depsOverride?: PipelineDeps; timeoutMs?: number; now?: () => number } = {},
): Promise<RecheckResult> {
  const now = opts.now ?? (() => performance.now());
  const started = now();
  const done = () => Math.max(0, Math.round(now() - started));

  // The legacy engine (PUBLIC, demo forceScenario) is synchronous and reads
  // nothing live: nothing can have drifted. Same verdict back, immediately —
  // marked exactly as scanTx() marks it, because the screens render THIS
  // verdict after a re-check. Without the mark the badge would flip back to
  // "Checked by Lantern" at the moment of signing (D3 QA plan §10.1).
  if (usesLegacy(input)) {
    const legacy = scan({
      xdr: input.xdr,
      networkPassphrase: input.networkPassphrase,
      context: input.context,
    });
    const verdict = input.context.network === 'PUBLIC' ? withoutRegistry(legacy) : legacy;
    return { ok: true, verdict, drift: diffVerdicts(reviewed, verdict), latencyMs: done() };
  }

  const deps = opts.depsOverride ?? (input.rpcUrl ? recheckDepsFor(input.rpcUrl) : {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), opts.timeoutMs ?? RECHECK_TIMEOUT_MS);
  });
  try {
    const raced = await Promise.race([
      runPipeline(
        { xdr: input.xdr, networkPassphrase: input.networkPassphrase, context: input.context },
        deps,
      ).catch(() => 'error' as const),
      expired,
    ]);
    if (raced === 'timeout') return { ok: false, failure: 'timeout', latencyMs: done() };
    if (raced === 'error') return { ok: false, failure: 'error', latencyMs: done() };
    const failure = recheckFailureOf(reviewed, raced);
    if (failure) return { ok: false, failure, latencyMs: done() };
    const latencyMs = done();
    const verdict = toScanVerdict(raced, latencyMs);
    return { ok: true, verdict, drift: diffVerdicts(reviewed, verdict), latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

// ── The decision a confirm handler makes ─────────────────────────────────────

export type RecheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  // Proceed with the fresh verdict rendered (no drift, de-escalated, lateral).
  | { kind: 'passed'; drift: VerdictDrift }
  // Abort: something got worse. The screen re-renders with `verdict` and the
  // user must confirm again — including the high-risk gate if it now applies.
  | { kind: 'escalated'; changes: DriftChange[] }
  // Could not re-check. `refused` when the reviewed verdict was already
  // high: fail closed. Otherwise the next confirm on the same XDR proceeds.
  | { kind: 'failed'; failure: RecheckFailure; refused: boolean };

export interface RecheckDecision {
  proceed: boolean;
  // The verdict the screen should now render — fresh when there is one.
  verdict: ScanVerdict;
  state: RecheckState;
}

/**
 * Turn a re-check result into what the confirm handler does next. Pure, so
 * the branch table in #121 §2 is unit-tested without a DOM:
 *   no drift / de-escalated / lateral → proceed, render fresh
 *   escalated                          → abort, render fresh, fresh confirm
 *   failed, reviewed was high          → refuse
 *   failed, otherwise                  → abort once; `acknowledged` proceeds
 */
export function decideRecheck(
  reviewed: ScanVerdict,
  result: RecheckResult,
  acknowledged: boolean,
): RecheckDecision {
  if (!result.ok) {
    const refused = reviewed.action === 'block_confirm';
    if (!refused && acknowledged) {
      return {
        proceed: true,
        verdict: reviewed,
        state: { kind: 'failed', failure: result.failure, refused },
      };
    }
    return {
      proceed: false,
      verdict: reviewed,
      state: { kind: 'failed', failure: result.failure, refused },
    };
  }
  if (result.drift.drifted && result.drift.direction === 'escalated') {
    return {
      proceed: false,
      verdict: result.verdict,
      state: { kind: 'escalated', changes: result.drift.changes },
    };
  }
  return { proceed: true, verdict: result.verdict, state: { kind: 'passed', drift: result.drift } };
}

// The `tx_rechecked` telemetry shape for a result (#121 §4).
export function recheckTelemetry(result: RecheckResult): {
  drifted: boolean;
  direction: 'none' | 'escalated' | 'de_escalated' | 'lateral' | 'failed';
} {
  if (!result.ok) return { drifted: false, direction: 'failed' };
  if (!result.drift.drifted) return { drifted: false, direction: 'none' };
  return {
    drifted: true,
    direction: result.drift.direction === 'de-escalated' ? 'de_escalated' : result.drift.direction,
  };
}
