import { Address, TransactionBuilder, Memo, type xdr } from '@stellar/stellar-sdk';
import type { DecodedOp, DecodedTx } from './types';
import { decodeScVal } from './scval';

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
      source: inner.source,
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
  // Per-op source override (the account the op acts for), when set (#54).
  const source = str(op.source);
  const base: DecodedOp = source ? { type, sourceAccount: source } : { type };
  switch (type) {
    case 'payment':
      return {
        ...base,
        destination: str(op.destination),
        amount: str(op.amount),
        assetCode: assetCode(op.asset),
        assetIssuer: assetIssuer(op.asset),
      };
    case 'createAccount':
      return {
        ...base,
        destination: str(op.destination),
        amount: str(op.startingBalance),
        assetCode: 'XLM',
      };
    case 'pathPaymentStrictSend':
      // Strict-send: spend an exact `sendAmount`, receive at least `destMin`.
      return {
        ...base,
        destination: str(op.destination),
        amount: str(op.sendAmount), // headline = what leaves the wallet
        assetCode: assetCode(op.sendAsset),
        assetIssuer: assetIssuer(op.sendAsset),
        sendAssetCode: assetCode(op.sendAsset),
        sendAssetIssuer: assetIssuer(op.sendAsset),
        sendAmount: str(op.sendAmount),
        destAssetCode: assetCode(op.destAsset),
        destAssetIssuer: assetIssuer(op.destAsset),
        destMin: str(op.destMin),
      };
    case 'pathPaymentStrictReceive':
      // Strict-receive: receive an exact `destAmount`, spend at most `sendMax`.
      return {
        ...base,
        destination: str(op.destination),
        amount: str(op.destAmount),
        assetCode: assetCode(op.destAsset),
        assetIssuer: assetIssuer(op.destAsset),
        sendAssetCode: assetCode(op.sendAsset),
        sendAssetIssuer: assetIssuer(op.sendAsset),
        sendAmount: str(op.sendMax),
        destAssetCode: assetCode(op.destAsset),
        destAssetIssuer: assetIssuer(op.destAsset),
      };
    case 'accountMerge':
      // accountMerge sends the ENTIRE remaining XLM balance to `destination` and
      // deletes this account. There is no explicit amount field (it's always
      // "everything"), so at least surface the merge target so it doesn't render
      // blank; the engine flags it as high-impact. (#127)
      return { ...base, destination: str(op.destination) };
    case 'setOptions':
      return { ...base, ...decodeSetOptions(op) };
    case 'invokeHostFunction':
      return { ...base, ...decodeInvoke(op) };
    default:
      return base;
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
      args: () => xdr.ScVal[];
    };
    return {
      contractId: Address.fromScAddress(inv.contractAddress() as never).toString(),
      contractFunction: inv.functionName().toString(),
      contractArgs: inv.args().map(decodeScVal),
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

// Issuer of a classic asset; undefined for native XLM.
function assetIssuer(asset: unknown): string | undefined {
  if (!asset || typeof asset !== 'object') return undefined;
  const a = asset as { issuer?: unknown; isNative?: () => boolean };
  if (typeof a.isNative === 'function' && a.isNative()) return undefined;
  return typeof a.issuer === 'string' ? a.issuer : undefined;
}

function memoText(memo: Memo | undefined): string | undefined {
  if (!memo || memo.type === 'none' || memo.value == null) return undefined;
  const v = memo.value;
  return typeof v === 'string' ? v : v.toString('utf8');
}
