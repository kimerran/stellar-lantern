import { ACTION_FOR, type ScanContext, type ScanReason, type ScanVerdict } from './types';
import { decodeTransaction } from './decode';
import { explainTransaction } from './explainer';

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

  // Demo override: force a verdict so each UI state is reviewable.
  if (context.forceScenario) {
    return forced(context.forceScenario, explanation);
  }

  const dest = decoded?.primaryDestination;
  const amount = Number(decoded?.primaryAmount ?? '0');
  const spendable = Number(context.spendableXlm ?? '0');

  // ── Tier 0: rules + (mock) reputation ──
  if (dest && DEMO_FLAGGED_ADDRESSES.has(dest)) {
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
    reasons.push({
      code: 'contract_call',
      severity: 'medium',
      title: 'Smart contract call',
      detail: 'This interacts with a contract that may move funds or change permissions.',
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
