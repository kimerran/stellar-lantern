import type { DecodedOp, DecodedTx } from './types';
import { truncateAddress, formatAmount } from './format';
import { describeDefiFunction } from './defi';
import {
  baseAccount,
  isRemoval,
  signingRequirements,
  sponsoredSetup,
  type SponsoredSetup,
} from './sponsorship';

// Turn a decoded transaction into ONE low-reading-level sentence for the
// approval UI (spec §4.4). Rules-based today; a Tier 2 model could refine the
// wording for Soroban contract calls later.
//
// `user` (optional) is the account reviewing it: when given, a multi-op
// explanation says which operations need *your* signature (#261).
export function explainTransaction(tx: DecodedTx | null, user?: string): string {
  if (!tx || tx.operations.length === 0) {
    return 'This transaction could not be read. Only continue if you trust the source.';
  }

  if (tx.isSoroban) {
    const call = tx.operations.find((o) => o.type === 'invokeHostFunction' && o.contractFunction);
    if (call?.contractFunction) {
      const on = call.contractId ? ` (${truncateAddress(call.contractId, 4, 4)})` : '';
      // For well-known DeFi/lending functions, lead with a friendly description
      // of the action; otherwise keep the generic wording (no regression).
      const action = describeDefiFunction(call.contractFunction);
      if (action) {
        return `${action} — calls “${call.contractFunction}” on a smart contract${on}. Only continue if you trust it.`;
      }
      return `This calls “${call.contractFunction}” on a smart contract${on} that may move funds or change permissions. Only continue if you trust it.`;
    }
    return 'This lets a smart contract move funds or change permissions on your account. Only continue if you trust it.';
  }

  if (tx.operations.length === 1) {
    // Single op: today's sentence, unchanged (pinned by
    // tests/scanner-explain-pinned.test.ts).
    let sentence = describeOp(tx.operations[0]!, tx);
    if (tx.memo) sentence += ` Memo: “${tx.memo}”.`;
    return sentence;
  }

  // Several ops (#261): the sponsored-setup pattern in one sentence when it
  // is exactly that, else every operation, one line each — never just the
  // first with a count of the rest.
  const setup = sponsoredSetup(tx);
  let text = setup ? describeSetup(setup, tx, user) : describeEach(tx, user);
  if (tx.memo) text += ` Memo: “${tx.memo}”.`;
  return text;
}

// One operation as one "This …" sentence.
function describeOp(op: DecodedOp, tx: DecodedTx): string {
  const to = op.destination ? truncateAddress(op.destination, 4, 4) : 'another account';
  const amount = op.amount ? formatAmount(op.amount) : '';
  const asset = op.assetCode ?? 'XLM';
  switch (op.type) {
    case 'createAccount':
      return `This creates and funds a new account ${to} with ${amount} XLM.`;
    case 'payment':
      return `This sends ${amount} ${asset} to ${to}.`;
    case 'pathPaymentStrictSend':
    case 'pathPaymentStrictReceive':
      return describeSwap(op);
    case 'setOptions':
      return describeSetOptions(op);
    case 'changeTrust':
      return describeTrust(op);
    case 'beginSponsoringFutureReserves': {
      const sponsor = opSourceOf(op, tx);
      const who = sponsor ? truncateAddress(sponsor, 4, 4) : 'The source account';
      const whom = op.sponsoredId ? truncateAddress(op.sponsoredId, 4, 4) : 'another account';
      return `This has ${who} pay the reserves for anything ${whom} adds next, until ${whom} ends the sponsorship.`;
    }
    case 'endSponsoringFutureReserves': {
      const sponsored = opSourceOf(op, tx);
      return `This ends the reserve sponsorship${sponsored ? ` for ${truncateAddress(sponsored, 4, 4)}` : ''}.`;
    }
    case 'revokeSponsorship':
      return describeRevoke(op);
    default:
      return `This performs a ${humanizeType(op.type)} operation.`;
  }
}

function opSourceOf(op: DecodedOp, tx: DecodedTx): string | undefined {
  return op.sourceAccount ?? tx.source;
}

// The largest trustline limit: changeTrust's default, i.e. "no limit".
const MAX_TRUST_LIMIT = '922337203685.4775807';

function describeTrust(op: DecodedOp): string {
  const code = op.assetCode ?? 'an asset';
  if (code === 'liquidity pool share') {
    return isRemoval(op)
      ? 'This removes a liquidity pool share trustline.'
      : 'This adds a liquidity pool share trustline.';
  }
  const issuer = op.assetIssuer ? ` (issuer ${truncateAddress(op.assetIssuer, 4, 4)})` : '';
  if (isRemoval(op)) return `This removes the ${code} trustline${issuer}.`;
  const limit =
    op.trustLimit && op.trustLimit !== MAX_TRUST_LIMIT
      ? `, with a limit of ${formatAmount(op.trustLimit)} ${code}`
      : '';
  return `This adds a ${code} trustline${issuer}${limit}, so the account can hold ${code}.`;
}

const REVOKED_ENTRY: Record<NonNullable<DecodedOp['revokeEntry']>, string> = {
  account: 'the account itself',
  trustline: 'a trustline',
  offer: 'an offer',
  data: 'a data entry',
  claimableBalance: 'a claimable balance',
  liquidityPool: 'a liquidity pool',
  signer: 'a signer',
};

function describeRevoke(op: DecodedOp): string {
  const entry =
    op.revokeEntry === 'trustline' && op.assetCode
      ? `the ${op.assetCode} trustline`
      : op.revokeEntry
        ? REVOKED_ENTRY[op.revokeEntry]
        : 'a ledger entry';
  if (!op.revokeAccount) return `This stops sponsoring the reserve for ${entry}.`;
  const of = truncateAddress(op.revokeAccount, 4, 4);
  return `This stops sponsoring the reserve for ${entry} of ${of}; that account must then hold the reserve itself.`;
}

// "GSPO…NSOR pays to create your account and add a USDC trustline. You pay
// nothing." The issuer is named: a lookalike USDC is the trap here.
function describeSetup(setup: SponsoredSetup, tx: DecodedTx, user: string | undefined): string {
  const sponsor = truncateAddress(setup.sponsor, 4, 4);
  const mine = !user || baseAccount(user) === setup.sponsored;
  const target = mine ? 'your account' : `account ${truncateAddress(setup.sponsored, 4, 4)}`;
  const issuer = (t: SponsoredSetup['trustlines'][number]): string =>
    t.issuer ? ` (issuer ${truncateAddress(t.issuer, 4, 4)})` : '';
  const trust =
    setup.trustlines.length === 1
      ? `a ${setup.trustlines[0]!.code} trustline${issuer(setup.trustlines[0]!)}`
      : `trustlines for ${setup.trustlines
          .map((t) => `${t.code}${issuer(t)}`)
          .join(', ')
          .replace(/, ([^,]*)$/, ' and $1')}`;
  let sentence = setup.createsAccount
    ? `${sponsor} pays to create ${target} and add ${trust}.`
    : `${sponsor} pays the reserve to add ${trust} to ${target}.`;
  if (setup.createsAccount && setup.startingBalance && Number(setup.startingBalance) > 0) {
    sentence += ` It also starts the account with ${formatAmount(setup.startingBalance)} XLM.`;
  }
  const feePayer = tx.source ? baseAccount(tx.source) : setup.sponsor;
  const paysFee = feePayer === setup.sponsored;
  sentence += mine
    ? paysFee
      ? ' You pay only the network fee.'
      : ' You pay nothing.'
    : paysFee
      ? ' That account pays only the network fee.'
      : ' That account pays nothing.';
  return sentence;
}

// Every op, one line each. When the ops act for different accounts, each
// line says whose signature it needs — yours (when `user` is known) or
// whichever account's it is.
function describeEach(tx: DecodedTx, user: string | undefined): string {
  const signing = signingRequirements(tx, user ?? tx.source ?? '');
  const mixed = new Set(signing.ops.map((o) => o.source)).size > 1;
  const lines = tx.operations.map((op, i) => {
    let line =
      op.type === 'createAccount' && op.amount && Number(op.amount) === 0
        ? `This creates a new account ${op.destination ? truncateAddress(op.destination, 4, 4) : ''} with no starting balance.`
        : describeOp(op, tx);
    line = line.replace(/^This /, '');
    line = line.charAt(0).toUpperCase() + line.slice(1);
    if (mixed) {
      const s = signing.ops[i]!;
      const whose =
        user && s.byUser ? 'needs your signature' : `signed by ${truncateAddress(s.source, 4, 4)}`;
      line = `${line.replace(/\.$/, '')} — ${whose}.`;
    }
    return `${i + 1}. ${line}`;
  });
  return [`This transaction has ${tx.operations.length} operations:`, ...lines].join('\n');
}

// Spell out exactly what a setOptions op changes — the highest-stakes op type
// to get right (#23): naming the signer being added/removed with its weight,
// and any threshold / master-weight change, in plain language. Clauses are
// lowercase verb phrases so they read naturally after the "This " prefix.
function describeSetOptions(op: DecodedOp): string {
  const parts: string[] = [];

  if (op.signerKey) {
    const who = op.signerKey.startsWith('G') ? truncateAddress(op.signerKey, 4, 4) : op.signerKey;
    parts.push(
      op.signerWeight === 0
        ? `removes signer ${who}`
        : `adds signer ${who} with weight ${op.signerWeight ?? '?'}`,
    );
  }

  if (op.masterWeight !== undefined) {
    parts.push(
      op.masterWeight === 0
        ? 'removes your own key’s signing power'
        : `sets your own key’s weight to ${op.masterWeight}`,
    );
  }

  const thresholds: string[] = [];
  if (op.lowThreshold !== undefined) thresholds.push(`low ${op.lowThreshold}`);
  if (op.medThreshold !== undefined) thresholds.push(`medium ${op.medThreshold}`);
  if (op.highThreshold !== undefined) thresholds.push(`high ${op.highThreshold}`);
  if (thresholds.length > 0) parts.push(`sets the signing thresholds (${thresholds.join(', ')})`);

  if (parts.length === 0) {
    // Only non-signer/threshold fields changed (home domain, flags) — generic.
    return 'This changes account options. Only continue if you set this up yourself.';
  }

  const joined =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}` : parts[0];
  return `This ${joined}. Only continue if you set this up yourself.`;
}

// Name both sides of a swap + the slippage bound in plain language, e.g.
// "This swaps 100 XLM for at least 24.3 USDC." (strict-send) — not the generic
// payment wording (#71). Whether the proceeds leave the wallet (a swap-and-send)
// is a risk signal raised in the engine, which knows the source account.
function describeSwap(op: DecodedOp): string {
  const sendAmt = op.sendAmount ? formatAmount(op.sendAmount) : '';
  const sendCode = op.sendAssetCode ?? 'XLM';
  const destCode = op.destAssetCode ?? op.assetCode ?? 'XLM';
  if (op.type === 'pathPaymentStrictSend' && op.destMin) {
    return `This swaps ${sendAmt} ${sendCode} for at least ${formatAmount(op.destMin)} ${destCode}.`;
  }
  // strict-receive: an exact amount received, capped by how much is spent.
  const recvAmt = op.amount ? formatAmount(op.amount) : '';
  return `This swaps up to ${sendAmt} ${sendCode} for ${recvAmt} ${destCode}.`;
}

function humanizeType(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}
