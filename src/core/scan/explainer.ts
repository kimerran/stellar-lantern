import type { DecodedOp, DecodedTx } from './types';
import { truncateAddress, formatAmount } from '@shared/format';

// Turn a decoded transaction into ONE low-reading-level sentence for the
// approval UI (spec §4.4). Rules-based today; a Tier 2 model could refine the
// wording for Soroban contract calls later.
export function explainTransaction(tx: DecodedTx | null): string {
  if (!tx || tx.operations.length === 0) {
    return 'This transaction could not be read. Only continue if you trust the source.';
  }

  if (tx.isSoroban) {
    const call = tx.operations.find((o) => o.type === 'invokeHostFunction' && o.contractFunction);
    if (call?.contractFunction) {
      const on = call.contractId ? ` (${truncateAddress(call.contractId, 4, 4)})` : '';
      return `This calls “${call.contractFunction}” on a smart contract${on} that may move funds or change permissions. Only continue if you trust it.`;
    }
    return 'This lets a smart contract move funds or change permissions on your account. Only continue if you trust it.';
  }

  const first = tx.operations[0]!;
  const to = first.destination ? truncateAddress(first.destination, 4, 4) : 'another account';
  const amount = first.amount ? formatAmount(first.amount) : '';
  const asset = first.assetCode ?? 'XLM';

  let sentence: string;
  switch (first.type) {
    case 'createAccount':
      sentence = `This creates and funds a new account ${to} with ${amount} XLM.`;
      break;
    case 'payment':
      sentence = `This sends ${amount} ${asset} to ${to}.`;
      break;
    case 'pathPaymentStrictSend':
    case 'pathPaymentStrictReceive':
      sentence = `This swaps assets and sends about ${amount} ${asset} to ${to}.`;
      break;
    case 'setOptions':
      sentence = describeSetOptions(first);
      break;
    default:
      sentence = `This performs a ${humanizeType(first.type)} operation.`;
  }

  if (tx.operations.length > 1) {
    sentence += ` It also includes ${tx.operations.length - 1} more operation${
      tx.operations.length - 1 > 1 ? 's' : ''
    }.`;
  }
  if (tx.memo) sentence += ` Memo: “${tx.memo}”.`;
  return sentence;
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

function humanizeType(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}
