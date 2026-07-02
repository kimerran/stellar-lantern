import { Address, TransactionBuilder, Memo } from '@stellar/stellar-sdk';
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
    case 'setOptions':
      return { type, ...decodeSetOptions(op) };
    case 'invokeHostFunction':
      return { type, ...decodeInvoke(op) };
    default:
      return { type };
  }
}

// Pull the contract address + function name out of a Soroban invokeHostFunction
// op, but only when the host function is an actual *contract invocation*
// (upload-wasm / create-contract host functions have no callable function, so
// they decode to just `{ type }` and still count as `isSoroban`). Defensive:
// any shape we don't recognise falls back to no extra fields.
function decodeInvoke(op: Record<string, unknown>): Partial<DecodedOp> {
  try {
    const func = op.func as
      | { switch?: () => { name?: string }; invokeContract?: () => unknown }
      | undefined;
    if (!func || typeof func.switch !== 'function' || typeof func.invokeContract !== 'function') {
      return {};
    }
    if (func.switch().name !== 'hostFunctionTypeInvokeContract') return {};
    const inv = func.invokeContract() as {
      contractAddress: () => unknown;
      functionName: () => { toString: () => string };
    };
    return {
      contractId: Address.fromScAddress(inv.contractAddress() as never).toString(),
      contractFunction: inv.functionName().toString(),
    };
  } catch {
    return {};
  }
}

// Pull the account-control fields out of a setOptions op. The SDK always
// exposes the keys but leaves unset ones `undefined`; we carry through only
// signer + threshold changes (what the scanner treats as high-impact) and
// preserve 0 (a real, dangerous value — e.g. masterWeight 0).
function decodeSetOptions(op: Record<string, unknown>): Partial<DecodedOp> {
  const out: Partial<DecodedOp> = {};
  const signer = op.signer as
    | { ed25519PublicKey?: unknown; sha256Hash?: unknown; preAuthTx?: unknown; weight?: unknown }
    | undefined;
  if (signer && typeof signer === 'object') {
    out.signerKey =
      typeof signer.ed25519PublicKey === 'string'
        ? signer.ed25519PublicKey
        : signer.sha256Hash != null
          ? 'hash-x signer'
          : signer.preAuthTx != null
            ? 'pre-authorized-tx signer'
            : 'signer';
    out.signerWeight = num(signer.weight);
  }
  out.masterWeight = num(op.masterWeight);
  out.lowThreshold = num(op.lowThreshold);
  out.medThreshold = num(op.medThreshold);
  out.highThreshold = num(op.highThreshold);
  return out;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
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
