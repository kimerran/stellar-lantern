import { TransactionBuilder, Memo } from '@stellar/stellar-sdk';
import type { DecodedOp, DecodedTx } from './types';

// Decode a Stellar transaction XDR into a display/scan summary (spec §4.1).
// Pure: no network, no chrome. Returns null if the XDR can't be parsed.
export function decodeTransaction(xdr: string, networkPassphrase: string): DecodedTx | null {
  try {
    const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
    // Fee-bump or plain tx both expose `.operations` once unwrapped.
    const inner = 'innerTransaction' in tx ? tx.innerTransaction : tx;
    const ops = (inner.operations ?? []) as unknown as Array<Record<string, unknown>>;

    const operations: DecodedOp[] = ops.map((op) => mapOp(op));
    const memo = memoText(inner.memo as Memo | undefined);
    const isSoroban = operations.some((o) => o.type === 'invokeHostFunction');

    // The "primary" transfer is the first value-moving op, used for headline copy.
    const primary = operations.find((o) => o.amount != null) ?? operations[0];

    return {
      operations,
      memo,
      isSoroban,
      primaryDestination: primary?.destination,
      primaryAmount: primary?.amount,
      primaryAssetCode: primary?.assetCode,
    };
  } catch {
    return null;
  }
}

function mapOp(op: Record<string, unknown>): DecodedOp {
  const type = String(op.type ?? 'unknown');
  switch (type) {
    case 'payment':
      return {
        type,
        destination: str(op.destination),
        amount: str(op.amount),
        assetCode: assetCode(op.asset),
      };
    case 'createAccount':
      return {
        type,
        destination: str(op.destination),
        amount: str(op.startingBalance),
        assetCode: 'XLM',
      };
    case 'pathPaymentStrictSend':
    case 'pathPaymentStrictReceive':
      return {
        type,
        destination: str(op.destination),
        amount: str(op.destAmount ?? op.sendAmount),
        assetCode: assetCode(op.destAsset),
      };
    default:
      return { type };
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function assetCode(asset: unknown): string | undefined {
  if (!asset || typeof asset !== 'object') return undefined;
  const a = asset as { code?: string; isNative?: () => boolean };
  if (typeof a.isNative === 'function' && a.isNative()) return 'XLM';
  return a.code ?? 'XLM';
}

function memoText(memo: Memo | undefined): string | undefined {
  if (!memo || memo.type === 'none' || memo.value == null) return undefined;
  const v = memo.value;
  return typeof v === 'string' ? v : v.toString('utf8');
}
