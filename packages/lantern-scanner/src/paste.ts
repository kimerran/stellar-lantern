import { ACTION_FOR, type MessageVerdict, type ScanReason } from './types';

// MOCK paste-to-check classifier (spec §4.5). Stand-in for the Tier 1 on-device
// message classifier (escalating to Tier 2 only when uncertain). Pure and
// synchronous. IMPORTANT: never persist the raw message — callers pass it in,
// we return only the decision.

interface Signal {
  code: string;
  severity: 'medium' | 'high';
  title: string;
  detail: string;
  re: RegExp;
}

const SIGNALS: Signal[] = [
  {
    code: 'seed_request',
    severity: 'high',
    title: 'Asks for your secret phrase',
    detail: 'No legitimate service ever needs your recovery phrase or secret key.',
    re: /\b(seed phrase|recovery phrase|secret key|private key|12[- ]?word|24[- ]?word|mnemonic)\b/i,
  },
  {
    code: 'giveaway',
    severity: 'high',
    title: 'Too-good-to-be-true giveaway',
    detail: 'Promises to multiply or double your crypto are a classic drainer pattern.',
    re: /\b(double|triple|2x|10x|free (crypto|xlm|tokens?)|giveaway|airdrop reward)\b/i,
  },
  {
    code: 'urgency',
    severity: 'medium',
    title: 'Artificial urgency',
    detail: 'Pressure to act “immediately” is designed to stop you from thinking.',
    re: /\b(immediately|urgent|right now|within \d+ ?(min|hour)|account (suspended|locked|frozen)|expires? (today|soon))\b/i,
  },
  {
    code: 'impersonation',
    severity: 'medium',
    title: 'Impersonates support',
    detail: 'Messages claiming to be “official support” asking you to act are usually fake.',
    re: /\b(support team|official|admin|wallet team|customer service|verify your (wallet|account))\b/i,
  },
  {
    code: 'link_action',
    severity: 'medium',
    title: 'Pushes a link / connect',
    detail: 'Be wary of links that ask you to “connect”, “validate”, or “sync” your wallet.',
    re: /\b(connect (your )?wallet|validate|sync|restore|click (here|the link)|https?:\/\/)\b/i,
  },
];

export function analyzeMessage(text: string): MessageVerdict {
  const trimmed = text.trim();
  const reasons: ScanReason[] = [];

  if (trimmed.length === 0) {
    return {
      risk: 'low',
      reasons: [],
      whatToDo: 'Paste a message, DM, or offer to check it for scam patterns.',
      tier: 1,
    };
  }

  for (const s of SIGNALS) {
    if (s.re.test(trimmed)) {
      reasons.push({ code: s.code, severity: s.severity, title: s.title, detail: s.detail });
    }
  }

  const high = reasons.filter((r) => r.severity === 'high').length;
  const medium = reasons.filter((r) => r.severity === 'medium').length;
  const risk: MessageVerdict['risk'] =
    high >= 1 ? 'high' : medium >= 2 ? 'high' : medium === 1 ? 'medium' : 'low';

  return {
    risk,
    reasons,
    whatToDo: guidance(risk),
    // A single medium signal is the "uncertain" case the real build escalates.
    tier: risk === 'medium' ? 2 : 1,
  };
}

function guidance(risk: MessageVerdict['risk']): string {
  switch (risk) {
    case 'high':
      return 'Do not reply, click links, or send anything. Never share your recovery phrase. Block and delete.';
    case 'medium':
      return 'Slow down. Verify the sender through an official channel before taking any action.';
    case 'low':
      return 'No obvious scam signals — but stay cautious and never share your recovery phrase.';
  }
}

// re-exported so callers can map risk → action consistently with tx scans.
export { ACTION_FOR };
