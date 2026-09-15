// Stage 5 — Verdict: the deterministic risk core (#58).
//
// A pure function of stage 3 effects + stage 4 screening (+ the ingest/auth
// results and the caller's context). No I/O, no clock, no randomness, no
// model: same inputs, same output, forever — "the deterministic core means
// the verdict is reproducible and auditable" (SOW). The AI layer (stage 6)
// receives the frozen result and can only return prose.
//
// Every reason has a signal with provenance (`ref`) back to the input it came
// from, so a reviewer can reconstruct the reasoning without re-running the
// scan. Warn-don't-block: low → allow, medium → warn, high → block_confirm;
// the user can always proceed after an explicit confirmation.
//
// This module must not import the explainer, the RPC client, the token
// resolver or anything that does I/O — tests/scanner-verdict.test.ts asserts
// it by reading this file.

import { ACTION_FOR, NOT_JUDGED } from './types';
import type {
  AuthTree,
  DecodedOp,
  EffectSet,
  NetDelta,
  RiskLevel,
  ScanReason,
  ScreenResult,
  Signal,
  SimulationResult,
  Verdict,
} from './types';
import { toStroops } from './decimal';
import { LONG_LIVED_ALLOWANCE_LEDGERS } from './token';

// What the XDR cannot tell the core: who is signing and what the wallet
// knows about the recipient and the balance. All optional but the signer.
export interface VerdictContext {
  fromAddress: string;
  destinationFunded?: boolean;
  spendableXlm?: string; // classic 7-decimal string
}

export interface VerdictInput {
  simulation: SimulationResult;
  auth: AuthTree;
  effects: EffectSet;
  screen: ScreenResult;
  context: VerdictContext;
}

const SEVERITY: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
const CONFIRM_TAIL = ' — do not sign unless you’re certain.';
const SCAM_MEMO_RE =
  /\b(seed|secret|recovery|phrase|password|verify|claim|airdrop|unlock|validate)\b/i;
// Sending ≥ 90 % of the spendable balance drains it; ≥ 50 % is a large share.
const HIGH_BALANCE_SHARE = 9n; // numerator over 10
const MEDIUM_BALANCE_SHARE = 5n;
const MODELED_OP_TYPES = new Set([
  'payment',
  'createAccount',
  'pathPaymentStrictSend',
  'pathPaymentStrictReceive',
  'accountMerge',
  'setOptions',
  'invokeHostFunction',
]);

const short = (a: string): string => (a.length > 8 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

export function verdict(input: VerdictInput): Verdict {
  const { simulation, auth, effects, screen, context } = input;
  const reasons: ScanReason[] = [];
  const signals: Signal[] = [];
  // A reason always arrives with its signal; both carry the same `ref`, so
  // the reason points at the input that produced it.
  const reason = (r: ScanReason, signal: Omit<Signal, 'detail'> & { detail?: string }): void => {
    if (!reasons.some((x) => x.code === r.code)) {
      reasons.push(signal.ref ? { ...r, ref: signal.ref } : r);
    }
    signals.push({ detail: r.title, ...signal });
  };

  // ── Ingest / auth failure: always high ──────────────────────────────────
  if (!simulation.ok) {
    reason(ingestReason(simulation), {
      stage: 'ingest',
      code: simulation.outcome === 'unknown' ? 'unknown' : 'fail_closed',
      detail: `${simulation.failure ?? 'state_archived'}: ${simulation.error ?? 'archived state needs restoring'}`,
      ref: 'simulation',
    });
  } else {
    signals.push({
      stage: 'ingest',
      code: simulation.simulated ? 'simulated' : 'classic',
      detail: simulation.simulated
        ? `${simulation.auth.length} auth entries`
        : 'no simulation needed',
      ref: 'simulation',
    });
  }
  if (auth.unparseable > 0) {
    reason(
      {
        code: 'auth_unreadable',
        severity: 'high',
        title: 'Couldn’t read what this transaction authorises',
        detail:
          'Part of the authorisation this contract call requires couldn’t be decoded, so Lantern can’t tell what it permits' +
          CONFIRM_TAIL,
      },
      {
        stage: 'auth',
        code: 'fail_closed',
        detail: `${auth.unparseable} of ${simulation.auth.length} auth entries unparseable`,
        ref: 'auth.unparseable',
      },
    );
  } else {
    signals.push({
      stage: 'auth',
      code: auth.nestedCount > 0 ? 'nested_invocations' : 'flat',
      detail: `${auth.entries.length} entries, ${auth.calls.length} calls, ${auth.nestedCount} nested, depth ${auth.maxDepth}`,
      ref: 'auth.calls',
    });
  }
  signals.push({
    stage: 'effects',
    code: `coverage_${effects.coverage}`,
    detail: effects.effects.map((e) => e.kind).join(',') || 'none',
    ref: 'effects.coverage',
  });
  signals.push({
    stage: 'screen',
    code: screen.outcome,
    detail: `${screen.checked.length} checked, ${screen.hits.length} hits, ${screen.unknown.length} unknown`,
    ref: 'screen',
  });

  const decoded = simulation.decoded;
  const ops = decoded?.operations ?? [];
  const me = context.fromAddress;

  // ── Blacklisted counterparty (#57) ──────────────────────────────────────
  screen.hits.forEach((hit, i) => {
    const e = hit.entry;
    reason(
      {
        code: 'reported_address',
        severity: 'high',
        title: 'Reported address',
        detail: e
          ? `${short(hit.address)} is on the Lantern blacklist registry: reported as ${e.reason} by ${short(e.reporter)}, ${e.reports} report${e.reports === 1 ? '' : 's'}.`
          : `${short(hit.address)} has been reported as a scam address (${hit.source}).`,
      },
      { stage: 'screen', code: 'reported_address', detail: hit.address, ref: `screen.hits[${i}]` },
    );
  });
  // Unknown screening is its own, non-clean signal.
  screen.unknown.forEach((u, i) => {
    reason(
      {
        code: 'screen_unknown',
        severity: 'medium',
        title: 'Couldn’t check the recipient',
        detail:
          u.reason === 'archived'
            ? 'This recipient’s registry entry is archived, so whether it is still flagged can’t be read until it is restored — treat it as unverified.'
            : u.reason === 'no_registry'
              ? 'No reported-address registry is configured, so this recipient is unverified.'
              : 'The reported-address registry couldn’t be reached, so this recipient is unverified.',
      },
      {
        stage: 'screen',
        code: 'screen_unknown',
        detail: `${u.address}: ${u.reason}`,
        ref: `screen.unknown[${i}]`,
      },
    );
  });

  // ── Unknown / unfunded destination ──────────────────────────────────────
  if (context.destinationFunded === false) {
    reason(
      {
        code: 'new_account',
        severity: 'medium',
        title: 'New account, no history',
        detail: 'This address has never received funds. Double-check it’s the right one.',
      },
      {
        stage: 'verdict',
        code: 'new_account',
        detail: 'destinationFunded=false',
        ref: 'context.destinationFunded',
      },
    );
  }

  // ── Outflow vs balance (classic XLM the signer sends) ───────────────────
  const myXlm = effects.net.find((n) => n.address === me && isNativeXlm(n));
  if (myXlm && context.spendableXlm) {
    let spendable: bigint | null = null;
    try {
      spendable = toStroops(context.spendableXlm);
    } catch {
      spendable = null;
    }
    const out = toStroops(myXlm.out);
    if (spendable !== null && spendable > 0n) {
      const ref = `net[${short(me)}:XLM]`;
      if (myXlm.outIsTotal || out * 10n >= spendable * HIGH_BALANCE_SHARE) {
        reason(
          {
            code: 'drains_balance',
            severity: 'high',
            title: 'Drains your balance',
            detail:
              'This sends almost everything you can spend. Scams often push for the full amount.',
          },
          {
            stage: 'verdict',
            code: 'drains_balance',
            detail: `${myXlm.out} of ${context.spendableXlm} XLM`,
            ref,
          },
        );
      } else if (out * 10n >= spendable * MEDIUM_BALANCE_SHARE) {
        reason(
          {
            code: 'large_share',
            severity: 'medium',
            title: 'Large share of balance',
            detail: 'This moves a big portion of your balance.',
          },
          {
            stage: 'verdict',
            code: 'large_share',
            detail: `${myXlm.out} of ${context.spendableXlm} XLM`,
            ref,
          },
        );
      }
    }
  }

  // ── Unexpected outflow: value leaving the signer that the decoded effects
  // do not account for (simulation saw it, no declared delta explains it),
  // or that leaves through a call the signer did not make directly. ───────
  effects.observed.forEach((o, i) => {
    if (o.address !== me || o.direction !== 'out' || o.raw === undefined) return;
    const declared = effects.deltas
      .filter((d) => d.address === me && d.direction === 'out' && sameAsset(d, o))
      .reduce(
        (sum, d) =>
          sum + (d.raw !== undefined ? BigInt(d.raw) : d.amount ? toStroops(d.amount) : 0n),
        0n,
      );
    const observed = BigInt(o.raw);
    if (observed > declared) {
      reason(
        {
          code: 'unexpected_outflow',
          severity: 'high',
          title: 'Sends more than it shows',
          detail: `Simulation shows ${o.amount ?? o.raw} ${o.asset.code} leaving your account beyond what this transaction declares. Only continue if you understand why.`,
        },
        {
          stage: 'effects',
          code: 'unexpected_outflow',
          detail: `observed ${o.raw} > declared ${declared}`,
          ref: `observed[${i}]`,
        },
      );
    }
  });
  effects.deltas.forEach((d, i) => {
    if (d.address === me && d.direction === 'out' && (d.depth ?? 0) >= 1) {
      signals.push({
        stage: 'effects',
        code: 'nested_outflow',
        detail: `${d.amount ?? d.raw} ${d.asset.code} leaves via a depth-${d.depth} call`,
        ref: `deltas[${i}]`,
      });
    }
  });

  // ── Approvals (#55), weighted by expiry ─────────────────────────────────
  effects.approvals.forEach((ap, i) => {
    const longLived =
      simulation.latestLedger === undefined ||
      ap.expirationLedger - simulation.latestLedger > LONG_LIVED_ALLOWANCE_LEDGERS;
    const ref = `approvals[${i}]`;
    signals.push({
      stage: 'effects',
      code: ap.unlimited ? 'unlimited_allowance' : 'allowance',
      detail: `${ap.asset.code} → ${short(ap.spender)}, ${ap.amountScaled ?? `${ap.amount} (decimals unknown)`}, expires ledger ${ap.expirationLedger}${longLived ? ' (long-lived)' : ''}, depth ${ap.depth}`,
      ref,
    });
    if (longLived) {
      signals.push({
        stage: 'effects',
        code: 'long_lived_allowance',
        detail: `expires ledger ${ap.expirationLedger}, latest ${simulation.latestLedger ?? 'unknown'}`,
        ref,
      });
    }
    if (ap.unlimited) {
      reason(
        {
          code: 'unlimited_allowance',
          severity: 'high',
          title: 'Unlimited token allowance',
          detail: `This lets ${short(ap.spender)} spend an unlimited amount of your ${ap.asset.code}${longLived ? ' for a very long time' : ''}. Only continue if you fully trust that address.`,
        },
        { stage: 'verdict', code: 'unlimited_allowance', ref },
      );
    } else if (longLived) {
      reason(
        {
          code: 'long_lived_allowance',
          severity: 'medium',
          title: 'Long-lived token allowance',
          detail: `This lets ${short(ap.spender)} spend up to ${ap.amountScaled ?? ap.amount} ${ap.asset.code} for a very long time. Make sure that is intended.`,
        },
        { stage: 'verdict', code: 'long_lived_allowance', ref },
      );
    }
  });

  // ── Unverified contract (#56) ───────────────────────────────────────────
  if (effects.unverified.length > 0) {
    const first = effects.unverified[0]!;
    const more = effects.unverified.length - 1;
    const moved = effects.observed.length;
    reason(
      {
        code: 'unverified_contract',
        severity: 'medium',
        title: 'Unverified contract — semantics unknown',
        detail:
          `This calls “${first.functionName}” on contract ${short(first.contractId)}${more > 0 ? ` (and ${more} more call${more > 1 ? 's' : ''})` : ''}. Lantern doesn’t know what this function does` +
          (moved > 0
            ? `; simulation shows ${moved} balance change${moved > 1 ? 's' : ''} — review them before signing.`
            : '; simulation shows no balance changes, but that is not a guarantee.'),
      },
      {
        stage: 'effects',
        code: 'unverified_contract',
        detail: effects.unverified
          .map((u) => `${u.functionName}@${short(u.contractId)} d${u.depth}`)
          .join(', '),
        ref: 'unverified',
      },
    );
  }
  if (effects.observed.length > 0) {
    signals.push({
      stage: 'effects',
      code: 'observed_balance_changes',
      detail: effects.observed
        .map((d) => `${d.direction} ${d.amount ?? d.raw} ${d.asset.code} ${short(d.address)}`)
        .join(', '),
      ref: 'observed',
    });
  }

  // ── Account control ─────────────────────────────────────────────────────
  ops.forEach((op, i) => {
    if (!isAccountControlChange(op)) return;
    const losesControl = op.masterWeight === 0;
    reason(
      {
        code: 'account_control_change',
        severity: 'high',
        title: losesControl ? 'Gives up account control' : 'Changes account control',
        detail: losesControl
          ? 'This sets your own key’s weight to zero — you could permanently lose the ability to sign for this account. Only continue if you set this up yourself.'
          : 'This adds or removes a signer or changes the approval thresholds on your account — an irreversible, high-impact change. Only continue if you set this up yourself.',
      },
      { stage: 'verdict', code: 'account_control_change', ref: `ops[${i}]` },
    );
  });
  effects.closes.forEach((c, i) => {
    reason(
      {
        code: 'account_merge',
        severity: 'high',
        title: 'Transfers everything & closes this account',
        detail: `This transfers your entire XLM balance to ${short(c.destination)} and permanently closes this account. Only continue if you set this up yourself.`,
      },
      { stage: 'verdict', code: 'account_merge', detail: c.destination, ref: `closes[${i}]` },
    );
  });

  // ── Memo language, unrecognised ops, swap-and-send (kept from engine.ts) ─
  if (decoded?.memo && SCAM_MEMO_RE.test(decoded.memo)) {
    reason(
      {
        code: 'memo_language',
        severity: 'high',
        title: 'Suspicious memo',
        detail: 'The memo uses language common in scams (e.g. “verify”, “claim”, “seed”).',
      },
      { stage: 'verdict', code: 'memo_language', ref: 'memo' },
    );
  }
  ops.forEach((op, i) => {
    if (MODELED_OP_TYPES.has(op.type)) return;
    reason(
      {
        code: 'unrecognized_op',
        severity: 'medium',
        title: 'Unrecognized operation',
        detail: `This includes a “${humanizeOpType(op.type)}” operation Lantern can’t fully check. Review it carefully and only continue if you trust the source.`,
      },
      { stage: 'verdict', code: 'unrecognized_op', detail: op.type, ref: `ops[${i}]` },
    );
  });
  ops.forEach((op, i) => {
    const swap = op.type === 'pathPaymentStrictSend' || op.type === 'pathPaymentStrictReceive';
    if (!swap || !op.destination || op.destination === me) return;
    reason(
      {
        code: 'swap_to_other',
        severity: 'medium',
        title: 'Swap sends funds elsewhere',
        detail: `The swapped funds go to ${short(op.destination)}, not back to your own wallet. Only continue if you meant to send them there.`,
      },
      { stage: 'verdict', code: 'swap_to_other', detail: op.destination, ref: `ops[${i}]` },
    );
  });

  const risk = reasons.reduce<RiskLevel>(
    (worst, r) => (SEVERITY[r.severity] > SEVERITY[worst] ? r.severity : worst),
    'low',
  );
  return deepFreeze({ risk, action: ACTION_FOR[risk], reasons, signals, scope: NOT_JUDGED });
}

// One high-severity reason per ingest failure mode (#52). Distinguishable on
// purpose: "the network was down" and "this contract would fail" call for
// different next steps, and neither may ever read as a clean scan.
export function ingestReason(simulation: SimulationResult): ScanReason {
  if (simulation.outcome === 'unknown') {
    return {
      code: 'state_archived',
      severity: 'high',
      title: 'Couldn’t verify — state needs restoring',
      detail:
        'Some of the ledger state this contract call touches is archived, so what it would do can’t be verified until that state is restored' +
        CONFIRM_TAIL,
    };
  }
  switch (simulation.failure) {
    case 'undecodable':
      return {
        code: 'undecodable',
        severity: 'high',
        title: 'Couldn’t read this transaction',
        detail:
          'Lantern couldn’t decode this transaction and can’t verify it’s safe' + CONFIRM_TAIL,
      };
    case 'rpc_timeout':
      return {
        code: 'rpc_timeout',
        severity: 'high',
        title: 'The network didn’t answer in time',
        detail:
          'Soroban RPC didn’t respond before the deadline, so this contract call is unverified. Try again in a moment' +
          CONFIRM_TAIL,
      };
    case 'rpc_transport':
      return {
        code: 'rpc_unreachable',
        severity: 'high',
        title: 'Couldn’t reach the network',
        detail:
          'Soroban RPC couldn’t be reached, so this contract call is unverified — this is a connection problem, not a verdict on the transaction' +
          CONFIRM_TAIL,
      };
    case 'simulation_malformed':
      return {
        code: 'simulation_malformed',
        severity: 'high',
        title: 'The network’s answer couldn’t be read',
        detail:
          'Soroban RPC returned a response Lantern couldn’t interpret, so this contract call is unverified' +
          CONFIRM_TAIL,
      };
    case 'simulation_reverted':
      return {
        code: 'simulation_reverted',
        severity: 'high',
        title: 'This transaction would fail',
        detail:
          'Simulating this contract call reports it would fail on-chain, so Lantern can’t tell what it does' +
          CONFIRM_TAIL,
      };
    case 'simulation_unavailable':
    default:
      return {
        code: 'simulation_unavailable',
        severity: 'high',
        title: 'Couldn’t simulate this transaction',
        detail:
          'Lantern couldn’t simulate this contract call and can’t verify what it does' +
          CONFIRM_TAIL,
      };
  }
}

function isNativeXlm(n: NetDelta): boolean {
  return n.asset.code === 'XLM' && !n.asset.issuer;
}

function sameAsset(a: { asset: NetDelta['asset'] }, b: { asset: NetDelta['asset'] }): boolean {
  const key = (x: NetDelta['asset']) =>
    x.code === 'XLM' && !x.issuer
      ? 'XLM:native'
      : (x.contractId ?? `${x.code}:${x.issuer ?? 'native'}`);
  return key(a.asset) === key(b.asset);
}

// A setOptions op is a control change when it touches signers or any
// threshold (including masterWeight). Home-domain / flag-only edits are not.
function isAccountControlChange(op: DecodedOp): boolean {
  return (
    op.type === 'setOptions' &&
    (op.signerKey != null ||
      op.masterWeight != null ||
      op.lowThreshold != null ||
      op.medThreshold != null ||
      op.highThreshold != null)
  );
}

function humanizeOpType(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}
