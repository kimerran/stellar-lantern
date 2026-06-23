import type { HistoryItem, HistoryPage } from '@shared/types';
import type { NetworkConfig } from '@shared/constants';
import { getServer } from '@core/stellar/client';

// Minimal shape of the Horizon payment-type operation records we consume. Kept
// explicit (not `any`) so direction classification is unit-testable.
export interface RawOperation {
  id: string;
  type: string;
  transaction_hash: string;
  created_at: string;
  transaction_successful?: boolean;
  // payment
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  // create_account
  funder?: string;
  account?: string;
  starting_balance?: string;
  // path payment (swap)
  source_amount?: string;
  source_asset_code?: string;
  source_asset_type?: string;
}

function assetCodeOf(type?: string, code?: string): string {
  if (!type || type === 'native') return 'XLM';
  return code ?? 'ASSET';
}

// Pure classifier — maps one Horizon operation to a display model relative to
// the wallet address. No network, no chrome.
export function toHistoryItem(op: RawOperation, walletAddress: string): HistoryItem {
  const base = {
    id: op.id,
    hash: op.transaction_hash,
    createdAt: op.created_at,
    successful: op.transaction_successful ?? true,
  };

  if (op.type === 'create_account') {
    const incoming = op.account === walletAddress;
    const amount = op.starting_balance ?? '0';
    return {
      ...base,
      direction: incoming ? 'received' : 'create',
      title: incoming ? 'Received XLM' : 'Created Account',
      counterparty: incoming ? (op.funder ?? null) : (op.account ?? null),
      amount,
      signedAmount: incoming ? `+${amount}` : `-${amount}`,
      assetCode: 'XLM',
    };
  }

  if (op.type === 'path_payment_strict_send' || op.type === 'path_payment_strict_receive') {
    const incoming = op.to === walletAddress;
    const amount = op.amount ?? '0';
    const code = assetCodeOf(op.asset_type, op.asset_code);
    return {
      ...base,
      direction: 'swap',
      title: 'Swap',
      counterparty: incoming ? (op.from ?? null) : (op.to ?? null),
      amount,
      signedAmount: incoming ? `+${amount}` : `-${amount}`,
      assetCode: code,
    };
  }

  // default: payment
  const incoming = op.to === walletAddress;
  const amount = op.amount ?? '0';
  const code = assetCodeOf(op.asset_type, op.asset_code);
  return {
    ...base,
    direction: incoming ? 'received' : 'sent',
    title: incoming ? `Received ${code}` : `Sent ${code}`,
    counterparty: incoming ? (op.from ?? null) : (op.to ?? null),
    amount,
    signedAmount: incoming ? `+${amount}` : `-${amount}`,
    assetCode: code,
  };
}

// Fetch one page of payment-type operations, newest first. Pass a cursor for
// pagination (Load More).
export async function fetchHistory(
  network: NetworkConfig,
  address: string,
  cursor?: string,
  limit = 20,
): Promise<HistoryPage> {
  const server = getServer(network);
  let builder = server.payments().forAccount(address).order('desc').limit(limit).join('transactions');
  if (cursor) builder = builder.cursor(cursor);

  const page = await builder.call();
  const records = page.records as unknown as RawOperation[];
  const items = records.map((op) => toHistoryItem(op, address));
  const nextCursor = records.length === limit ? records[records.length - 1]!.id : null;
  return { items, nextCursor };
}
