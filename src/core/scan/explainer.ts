import type { DecodedTx } from './types';
import { truncateAddress, formatAmount } from '@shared/format';

// Turn a decoded transaction into ONE low-reading-level sentence for the
// approval UI (spec §4.4). Rules-based today; a Tier 2 model could refine the
// wording for Soroban contract calls later.
export function explainTransaction(tx: DecodedTx | null): string {
  if (!tx || tx.operations.length === 0) {
    return 'This transaction could not be read. Only continue if you trust the source.';
  }

  if (tx.isSoroban) {
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

function humanizeType(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}
