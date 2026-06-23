import {
  Account,
  Asset,
  BASE_FEE,
  Memo,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { BASE_RESERVE_XLM, FEE_BUFFER_XLM, MAX_MEMO_BYTES } from '@shared/constants';

export interface AssetRef {
  isNative: boolean;
  code?: string;
  issuer?: string;
}

export interface BuildTransferParams {
  sourceAccountId: string;
  sourceSequence: string;
  networkPassphrase: string;
  baseFee: string; // stroops, as string
  destination: string;
  destinationFunded: boolean;
  asset: AssetRef;
  amount: string; // decimal string, 7-dp
  memo?: string;
  timeoutSecs?: number;
}

function toAsset(ref: AssetRef): Asset {
  if (ref.isNative) return Asset.native();
  if (!ref.code || !ref.issuer) throw new Error('Non-native asset requires code and issuer.');
  return new Asset(ref.code, ref.issuer);
}

export function memoByteLength(memo: string): number {
  return new TextEncoder().encode(memo).length;
}

// Builds the *unsigned* transaction XDR. Signing happens in the worker only.
// - XLM to a non-existent account -> createAccount
// - otherwise -> payment
export function buildTransferXdr(params: BuildTransferParams): string {
  const {
    sourceAccountId,
    sourceSequence,
    networkPassphrase,
    baseFee,
    destination,
    destinationFunded,
    asset,
    amount,
    memo,
    timeoutSecs = 180,
  } = params;

  if (memo && memoByteLength(memo) > MAX_MEMO_BYTES) {
    throw new Error(`Memo must be ${MAX_MEMO_BYTES} bytes or fewer.`);
  }

  const source = new Account(sourceAccountId, sourceSequence);
  const builder = new TransactionBuilder(source, {
    fee: baseFee || BASE_FEE,
    networkPassphrase,
  });

  if (asset.isNative && !destinationFunded) {
    builder.addOperation(Operation.createAccount({ destination, startingBalance: amount }));
  } else {
    builder.addOperation(
      Operation.payment({ destination, asset: toAsset(asset), amount }),
    );
  }

  if (memo && memo.trim().length > 0) {
    builder.addMemo(Memo.text(memo));
  }

  return builder.setTimeout(timeoutSecs).build().toXDR();
}

// MAX spendable XLM = balance − (base reserve × (2 + subentries)) − fee buffer.
// The +2 covers the base account reserve (2 entries). Never strand the account
// below its minimum reserve. Returns a 7-dp string, clamped at 0.
export function computeMaxXlm(balance: string, subentryCount: number): string {
  const bal = Number(balance);
  const reserve = BASE_RESERVE_XLM * (2 + subentryCount);
  const max = bal - reserve - FEE_BUFFER_XLM;
  if (!Number.isFinite(max) || max <= 0) return '0';
  // floor to 7 decimals to avoid over-spend from rounding
  return (Math.floor(max * 1e7) / 1e7).toFixed(7).replace(/\.?0+$/, '');
}
