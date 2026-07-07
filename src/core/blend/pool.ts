// Blend Capital pool call-shape encoder (#21). Turns a "supply N of asset X to
// earn yield" / "withdraw N of asset X" intent into the *pre-simulation*
// `invokeHostFunction` XDR for Blend's pool `submit` entrypoint, ready to feed
// `simulateTransaction` (#56) → `assembleInvokeXdr` (#64) → sign.
//
// Why this can't reuse the generic scalar `InvokeArg` path (`buildInvokeContractXdr`
// #61): Blend's `submit` takes a `Vec<Request>` where each `Request` is a struct
// `{ address: Address, amount: i128, request_type: u32 }` — a NESTED ScVal (a vec
// of maps) that the flat scalar arg schema can't express. So this module builds
// the ScVals for that shape directly, then hands off to the same simulate/assemble
// pipeline as every other invoke.
//
// Blend pool ABI (blend-contracts-v2, pool/src/pool/actions.rs):
//   fn submit(from: Address, spender: Address, to: Address, requests: Vec<Request>)
//   struct Request { address: Address, amount: i128, request_type: u32 }
// For a self-service wallet supply/withdraw, from = spender = to = the user's own
// account (which is also the transaction source).
//
// SCOPE (#21 MVP): supply-to-earn and withdraw only — borrowing / collateral /
// liquidation are explicitly out of scope, so we map "supply" to the plain
// `Supply` request (non-collateral, freely withdrawable) and "withdraw" to
// `Withdraw`. Pure/offline: no network, no signing. Resource fees + footprint are
// applied later by the simulate/assemble step.

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  XdrLargeInt,
  xdr,
} from '@stellar/stellar-sdk';
import { isValidContractId, isValidPublicKey } from '@core/wallet/wallet';

// Blend `RequestType` enum → its on-chain u32 discriminant
// (blend-contracts-v2 `RequestType::from_u32`). The full set is kept for
// reference/decoding even though only Supply/Withdraw are built here.
export const BLEND_REQUEST_TYPE = {
  Supply: 0,
  Withdraw: 1,
  SupplyCollateral: 2,
  WithdrawCollateral: 3,
  Borrow: 4,
  Repay: 5,
  FillUserLiquidationAuction: 6,
  FillBadDebtAuction: 7,
  FillInterestAuction: 8,
  DeleteLiquidationAuction: 9,
} as const;

export const BLEND_SUBMIT_FN = 'submit';

// The two actions this wallet surface supports for the yield MVP.
export type BlendAction = 'supply' | 'withdraw';

const ACTION_REQUEST_TYPE: Record<BlendAction, number> = {
  supply: BLEND_REQUEST_TYPE.Supply,
  withdraw: BLEND_REQUEST_TYPE.Withdraw,
};

// i128 upper bound — amounts are unsigned base units (>0), so we range-check
// against the positive i128 max (the on-chain `amount` is i128).
const I128_MAX = 2n ** 127n - 1n;

export interface BuildBlendSubmitParams {
  /** Blend pool contract (C…) the request is submitted to. */
  poolId: string;
  /** The user's own account (G…) — used as from = spender = to AND the tx source. */
  userAddress: string;
  /** Reserve asset token contract (C…) being supplied/withdrawn. */
  reserveAssetId: string;
  /** Amount in the asset's base units (i128, > 0) — the UI converts from human input. */
  amount: string;
  /** supply → Supply request; withdraw → Withdraw request. */
  action: BlendAction;
  /** Current sequence number of `userAddress`. */
  sourceSequence: string;
  networkPassphrase: string;
  /** Classic inclusion fee (stroops). Resource fee is added later by assemble. */
  fee?: string;
  timeoutSecs?: number;
}

function parseAmount(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid amount: "${value}" must be a positive integer in base units.`);
  }
  const n = BigInt(trimmed);
  if (n <= 0n) throw new Error('Amount must be greater than zero.');
  if (n > I128_MAX) throw new Error(`Invalid amount: ${value} is out of range.`);
  return n;
}

// Build the `Request` struct as a Soroban ScMap. Rust structs serialize as a map
// keyed by field symbol in ascending key order — "address" < "amount" <
// "request_type" — so the entries MUST be in that order for the host to decode it.
function requestScVal(reserveAssetId: string, amount: bigint, requestType: number): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('address'),
      val: new Address(reserveAssetId).toScVal(),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('amount'),
      val: new XdrLargeInt('i128', amount.toString()).toScVal(),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('request_type'),
      val: xdr.ScVal.scvU32(requestType),
    }),
  ]);
}

/**
 * Build the *unsigned, pre-simulation* XDR for a Blend pool `submit` supply or
 * withdraw of a single reserve asset. Validates the pool + asset contract ids and
 * the user account, then constructs `submit(from, spender, to, [Request])` with
 * from=spender=to=`userAddress`. The returned XDR still needs simulate + assemble
 * (for footprint/auth/resource fee) before it can be signed — feed it to
 * `simulateTransaction` → `assembleInvokeXdr`, or route the whole thing through the
 * (typed-arg) pipeline's simulate/assemble tail.
 */
export function buildBlendSubmitXdr(params: BuildBlendSubmitParams): string {
  const {
    poolId,
    userAddress,
    reserveAssetId,
    amount,
    action,
    sourceSequence,
    networkPassphrase,
    fee,
    timeoutSecs = 180,
  } = params;

  if (!isValidContractId(poolId)) throw new Error('Invalid Blend pool address.');
  if (!isValidContractId(reserveAssetId)) throw new Error('Invalid reserve asset address.');
  if (!isValidPublicKey(userAddress)) throw new Error('Invalid account address.');
  const requestType = ACTION_REQUEST_TYPE[action];
  if (requestType === undefined) throw new Error(`Unsupported Blend action: "${String(action)}".`);

  const amt = parseAmount(amount);

  const userScVal = new Address(userAddress.trim()).toScVal();
  const requests = xdr.ScVal.scvVec([requestScVal(reserveAssetId.trim(), amt, requestType)]);

  const contract = new Contract(poolId.trim());
  const source = new Account(userAddress.trim(), sourceSequence);
  return new TransactionBuilder(source, { fee: fee || BASE_FEE, networkPassphrase })
    .addOperation(
      contract.call(
        BLEND_SUBMIT_FN,
        userScVal, // from
        userScVal, // spender
        userScVal, // to
        requests,
      ),
    )
    .setTimeout(timeoutSecs)
    .build()
    .toXDR();
}
