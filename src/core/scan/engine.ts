import { ACTION_FOR, type DecodedOp, type ScanContext, type ScanReason, type ScanVerdict } from './types';
import { decodeTransaction } from './decode';
import { explainTransaction } from './explainer';
import { truncateAddress } from '@shared/format';

// ─────────────────────────────────────────────────────────────────────────────
// MOCK scan engine.
//
// This is a deterministic heuristic stub standing in for the real cascade
// (Tier 0 rules in the service worker, Tier 1 on-device model, Tier 2 server
// LLM — spec §3). The CONTRACT is real and stable; only the internals are
// mocked. Swap this file for the real tiers without touching the UI.
//
// Pure and synchronous so it's trivially unit-testable; the UI adds the small
// "scanning…" delay for realism.
// ─────────────────────────────────────────────────────────────────────────────

// Demo deny-list. Sending to one of these triggers a high-risk block so the
// gating UI can be reviewed end-to-end. (Valid StrKey addresses.)
export const DEMO_FLAGGED_ADDRESSES = new Set<string>([
  'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
]);

// Words seen in memos used by drainer / fake-airdrop scams.
const SCAM_MEMO_RE = /\b(seed|secret|recovery|phrase|password|verify|claim|airdrop|unlock|validate)\b/i;

const HIGH_BALANCE_SHARE = 0.9; // sending ≥90% of spendable balance
const MEDIUM_BALANCE_SHARE = 0.5;

export interface ScanInput {
  xdr: string;
  networkPassphrase: string;
  context: ScanContext;
}

export function scan({ xdr, networkPassphrase, context }: ScanInput): ScanVerdict {
  const decoded = decodeTransaction(xdr, networkPassphrase);
  const explanation = explainTransaction(decoded);
  const reasons: ScanReason[] = [];

  // Demo override: force a verdict so each UI state is reviewable. Gated behind
  // DEMO_AFFORDANCES so a production build can't be told to fake a scan result
  // (#81) — the whole branch dead-code-eliminates when the flag is off.
  if (__FEATURE_DEMO_AFFORDANCES__ && context.forceScenario) {
    return forced(context.forceScenario, explanation);
  }

  // Fail CLOSED on an undecodable payload. If decoding returned null the XDR is
  // malformed or uses something we don't support — none of the heuristics below
  // can run, and skipping them would collapse the verdict to a benign "low"
  // ("allow"), presenting a transaction we CANNOT understand as safe to sign
  // (audit #127). Instead surface a high-severity reason and route it straight
  // to the CONFIRM / press-and-hold gate. Return early, before any heuristic
  // that assumes a decoded tx.
  if (!decoded) {
    reasons.push({
      code: 'undecodable',
      severity: 'high',
      title: 'Couldn’t read this transaction',
      detail:
        'Lantern couldn’t decode this transaction and can’t verify it’s safe — do not sign unless you’re certain.',
    });
    return verdictFrom(reasons, explanation);
  }

  const dest = decoded?.primaryDestination;
  const amount = Number(decoded?.primaryAmount ?? '0');
  const spendable = Number(context.spendableXlm ?? '0');

  // ── Tier 0: rules + (mock) reputation ──
  // The hardcoded demo deny-list stands in for the real risk backend (#22); gate
  // it behind DEMO_AFFORDANCES so it (and its addresses) compile out of a store
  // build (#81). The real reputation feed replaces this branch later.
  if (__FEATURE_DEMO_AFFORDANCES__ && dest && DEMO_FLAGGED_ADDRESSES.has(dest)) {
    reasons.push({
      code: 'reported_address',
      severity: 'high',
      title: 'Reported address',
      detail: 'This recipient has been reported for scam activity by other users.',
    });
  }

  if (context.destinationFunded === false) {
    reasons.push({
      code: 'new_account',
      severity: 'medium',
      title: 'New account, no history',
      detail: 'This address has never received funds. Double-check it’s the right one.',
    });
  }

  if (spendable > 0 && amount >= spendable * HIGH_BALANCE_SHARE) {
    reasons.push({
      code: 'drains_balance',
      severity: 'high',
      title: 'Drains your balance',
      detail: 'This sends almost everything you can spend. Scams often push for the full amount.',
    });
  } else if (spendable > 0 && amount >= spendable * MEDIUM_BALANCE_SHARE) {
    reasons.push({
      code: 'large_share',
      severity: 'medium',
      title: 'Large share of balance',
      detail: 'This moves a big portion of your balance.',
    });
  }

  if (decoded?.memo && SCAM_MEMO_RE.test(decoded.memo)) {
    reasons.push({
      code: 'memo_language',
      severity: 'high',
      title: 'Suspicious memo',
      detail: 'The memo uses language common in scams (e.g. “verify”, “claim”, “seed”).',
    });
  }

  if (decoded?.isSoroban) {
    // Name the specific function + contract when the op is a contract
    // invocation (vs. an opaque wasm-upload / create-contract host function).
    const call = decoded.operations.find(
      (o) => o.type === 'invokeHostFunction' && o.contractFunction,
    );
    const detail = call?.contractFunction
      ? `This calls “${call.contractFunction}” on contract ${truncateAddress(call.contractId ?? '', 4, 4)}, which may move funds or change permissions.`
      : 'This interacts with a contract that may move funds or change permissions.';
    reasons.push({
      code: 'contract_call',
      severity: 'medium',
      title: 'Smart contract call',
      detail,
    });
  }

  // setOptions signer/threshold changes are irreversible, high-impact edits to
  // who controls the account (spec §4.1 / README "removing a signer, raising/
  // lowering thresholds"). A malicious request here is far more dangerous than a
  // one-off payment, so surface it as high before any signing prompt.
  const control = decoded?.operations.find(isAccountControlChange);
  if (control) {
    const losesControl = control.masterWeight === 0;
    reasons.push({
      code: 'account_control_change',
      severity: 'high',
      title: losesControl ? 'Gives up account control' : 'Changes account control',
      detail: losesControl
        ? 'This sets your own key’s weight to zero — you could permanently lose the ability to sign for this account. Only continue if you set this up yourself.'
        : 'This adds or removes a signer or changes the approval thresholds on your account — an irreversible, high-impact change. Only continue if you set this up yourself.',
    });
  }

  // A swap normally routes its proceeds back to the sender (a self-swap). One
  // that sends the swapped output to a DIFFERENT account is a "swap and send" —
  // the funds leave the wallet, and a drainer could disguise a transfer as a
  // swap. Flag it (a plain self-swap stays low-risk). (#71)
  const swap = decoded?.operations.find(
    (o) => o.type === 'pathPaymentStrictSend' || o.type === 'pathPaymentStrictReceive',
  );
  if (swap?.destination && swap.destination !== context.fromAddress) {
    reasons.push({
      code: 'swap_to_other',
      severity: 'medium',
      title: 'Swap sends funds elsewhere',
      detail: `The swapped funds go to ${truncateAddress(swap.destination, 4, 4)}, not back to your own wallet. Only continue if you meant to send them there.`,
    });
  }

  return verdictFrom(reasons, explanation);
}

function verdictFrom(reasons: ScanReason[], explanation: string): ScanVerdict {
  const risk = highestSeverity(reasons);
  // A medium-risk contract call is the kind of "uncertain" case that the real
  // build would escalate to Tier 2; we label the tier accordingly for the demo.
  const escalated = reasons.some((r) => r.code === 'contract_call') && risk !== 'high';
  return {
    risk,
    action: ACTION_FOR[risk],
    reasons,
    explanation,
    checkedBy: 'Lantern',
    tier: risk === 'low' ? 0 : escalated ? 2 : 1,
    latencyMs: mockLatency(risk),
  };
}

// A setOptions op is a control change when it touches signers or any threshold
// (including masterWeight). Home-domain / flag-only setOptions are ignored here.
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

function highestSeverity(reasons: ScanReason[]): 'low' | 'medium' | 'high' {
  if (reasons.some((r) => r.severity === 'high')) return 'high';
  if (reasons.some((r) => r.severity === 'medium')) return 'medium';
  return 'low';
}

function mockLatency(risk: 'low' | 'medium' | 'high'): number {
  return risk === 'low' ? 38 : risk === 'medium' ? 120 : 340;
}

function forced(risk: 'low' | 'medium' | 'high', explanation: string): ScanVerdict {
  const samples: Record<typeof risk, ScanReason[]> = {
    low: [],
    medium: [
      {
        code: 'new_account',
        severity: 'medium',
        title: 'New account, no history',
        detail: 'This address has never received funds. Double-check it’s the right one.',
      },
    ],
    high: [
      {
        code: 'reported_address',
        severity: 'high',
        title: 'Reported address',
        detail: 'This recipient has been reported for scam activity by other users.',
      },
    ],
  };
  return verdictFrom(samples[risk], explanation);
}

// Sample verdicts for the demo "preview the warnings" gallery (no real tx).
export function sampleVerdict(risk: 'low' | 'medium' | 'high'): ScanVerdict {
  return forced(
    risk,
    risk === 'low'
      ? 'This sends 12 XLM to GBK4…X9V2.'
      : risk === 'medium'
        ? 'This sends 480 XLM to a brand-new account GD3R…7K2P.'
        : 'This sends 9,950 XLM to GA7Q…VSGZ.',
  );
}
