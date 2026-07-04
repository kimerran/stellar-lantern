// Typed Soroban invoke-contract XDR builder — the "invoke builder" the
// Blend/Soroban integration (#21) needs, and the counterpart to the already
// merged `simulateTransaction` (#56). It turns a contract id + function + typed
// args into an *unsigned* `InvokeHostFunction` transaction XDR.
//
// The mini-app bridge (core/miniapps/bridge.ts) carries `InvokeIntent` args as
// bare strings and explicitly defers "typed ScVal construction … to the
// RPC-simulated invoke builder" — that typed construction lives here.
//
// SCOPE: this builds the PRE-simulation transaction. Resource fees / footprint
// come from `simulateTransaction` (#56); applying that estimate (assemble) and
// wiring to signing is a follow-up slice. No network here — pure builder.

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  Operation,
  TransactionBuilder,
  XdrLargeInt,
  xdr,
} from '@stellar/stellar-sdk';
import { isValidContractId } from '@core/wallet/wallet';

// A single typed argument for a contract invocation. `value` is always a string
// (the wire/UI representation); `type` tells us how to turn it into an ScVal.
export type InvokeArg = {
  type:
    | 'address'
    | 'symbol'
    | 'string'
    | 'bool'
    | 'u32'
    | 'i32'
    | 'u64'
    | 'i64'
    | 'u128'
    | 'i128'
    | 'bytes';
  value: string;
};

// Soroban symbols: ASCII alphanumeric + underscore, at most 32 chars — matches
// the bridge's `InvokeIntent` validation.
const SYMBOL_RE = /^[a-zA-Z0-9_]+$/;
const MAX_SYMBOL_LEN = 32;

// Inclusive integer bounds per Soroban integer type. Validated with BigInt so
// 64/128-bit ranges are exact — the SDK's `nativeToScVal` silently wraps an
// out-of-range u32 rather than rejecting it, so we guard before constructing.
const INT_BOUNDS: Record<string, { min: bigint; max: bigint }> = {
  u32: { min: 0n, max: 2n ** 32n - 1n },
  i32: { min: -(2n ** 31n), max: 2n ** 31n - 1n },
  u64: { min: 0n, max: 2n ** 64n - 1n },
  i64: { min: -(2n ** 63n), max: 2n ** 63n - 1n },
  u128: { min: 0n, max: 2n ** 128n - 1n },
  i128: { min: -(2n ** 127n), max: 2n ** 127n - 1n },
};

function parseIntArg(type: string, value: string): bigint {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`Invalid ${type} value: "${value}" is not an integer.`);
  }
  const n = BigInt(trimmed);
  const bounds = INT_BOUNDS[type];
  if (!bounds) throw new Error(`Unsupported integer type: "${type}".`);
  if (n < bounds.min || n > bounds.max) {
    throw new Error(`Invalid ${type} value: ${value} is out of range.`);
  }
  return n;
}

// Convert a single typed arg into an ScVal, throwing a clear Error on any bad
// value (non-numeric or out-of-range int, invalid C…/G… address, odd-length or
// non-hex bytes, over-long symbol).
export function argToScVal(arg: InvokeArg): xdr.ScVal {
  const { type, value } = arg;
  switch (type) {
    case 'address':
      try {
        // Accepts both account (G…) and contract (C…) addresses; throws on junk.
        return new Address(value.trim()).toScVal();
      } catch {
        throw new Error(`Invalid address value: "${value}".`);
      }
    case 'symbol':
      if (!SYMBOL_RE.test(value) || value.length > MAX_SYMBOL_LEN) {
        throw new Error(`Invalid symbol value: "${value}".`);
      }
      return nativeToScVal(value, { type: 'symbol' });
    case 'string':
      return xdr.ScVal.scvString(value);
    case 'bool':
      if (value !== 'true' && value !== 'false') {
        throw new Error(`Invalid bool value: "${value}" (expected "true" or "false").`);
      }
      return xdr.ScVal.scvBool(value === 'true');
    case 'u32':
    case 'i32':
      // 32-bit fits a JS number safely; construct via the SDK after range check.
      return nativeToScVal(Number(parseIntArg(type, value)), { type });
    case 'u64':
    case 'i64':
    case 'u128':
    case 'i128':
      // 64/128-bit go through XdrLargeInt to preserve full precision.
      return new XdrLargeInt(type, parseIntArg(type, value).toString()).toScVal();
    case 'bytes': {
      const hex = value.trim();
      if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
        throw new Error(`Invalid bytes value: "${value}" is not valid hex.`);
      }
      return xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'));
    }
    default:
      throw new Error(`Unsupported arg type: "${String(type)}".`);
  }
}

export interface BuildInvokeParams {
  sourceAccount: string;
  sourceSequence: string;
  contractId: string; // C… contract address
  functionName: string; // Soroban symbol
  args: InvokeArg[];
  networkPassphrase: string;
  fee?: string; // stroops, as string
  timeoutSecs?: number;
}

// Build the *unsigned* XDR for a single-op Soroban `invokeHostFunction`
// contract call. Validates the contract id (C…) and function name (Soroban
// symbol), converts each typed arg to an ScVal, and returns base64 XDR. This is
// the pre-simulation transaction: signing happens in the worker; resource fees
// / footprint are applied later from `simulateTransaction` (#56).
export function buildInvokeContractXdr(params: BuildInvokeParams): string {
  const {
    sourceAccount,
    sourceSequence,
    contractId,
    functionName,
    args,
    networkPassphrase,
    fee,
    timeoutSecs = 180,
  } = params;

  if (!isValidContractId(contractId)) {
    throw new Error('Invalid contract address.');
  }
  if (!SYMBOL_RE.test(functionName) || functionName.length > MAX_SYMBOL_LEN) {
    throw new Error('Invalid contract function name.');
  }

  const scVals = args.map(argToScVal);
  const contract = new Contract(contractId.trim());

  const source = new Account(sourceAccount, sourceSequence);
  return new TransactionBuilder(source, { fee: fee || BASE_FEE, networkPassphrase })
    .addOperation(contract.call(functionName, ...scVals))
    .setTimeout(timeoutSecs)
    .build()
    .toXDR();
}

export interface AssembleInvokeParams {
  // The pre-simulation XDR from `buildInvokeContractXdr`.
  builtXdr: string;
  networkPassphrase: string;
  // From `simulateTransaction` (#56): the resource-fee estimate, the prepared
  // footprint (base64 `SorobanTransactionData`), and any auth entries the call
  // requires (base64 `SorobanAuthorizationEntry`, empty for no-auth calls).
  minResourceFee: string;
  transactionData: string;
  auth?: string[];
  // Classic inclusion fee (per op), default `BASE_FEE`.
  inclusionFee?: string;
}

/**
 * Apply a `simulateTransaction` (#56) result to a pre-simulation invoke tx,
 * producing the *ready-to-sign* XDR. This is the "assemble" step between build
 * (#61) and signing: it attaches the simulated **footprint** (`SorobanTransactionData`)
 * and **auth entries** to the invoke op and sets the total fee to
 * `inclusion + minResourceFee` (a Soroban tx pays a classic inclusion fee plus the
 * resource fee). Source account, sequence and timebounds are preserved.
 *
 * Pure/offline. NOTE: the inputs come from a live Soroban RPC simulation; this
 * function is unit-tested against constructed fixtures, but the assembled tx is
 * only truly validated by a real RPC round-trip (submitting a simulated call).
 */
export function assembleInvokeXdr(params: AssembleInvokeParams): string {
  const { builtXdr, networkPassphrase, minResourceFee, transactionData, auth = [], inclusionFee } =
    params;
  if (!transactionData) {
    throw new Error('Simulation is missing footprint data (transactionData); cannot assemble.');
  }

  const tx = TransactionBuilder.fromXDR(builtXdr, networkPassphrase);
  if ('innerTransaction' in tx) {
    throw new Error('assembleInvokeXdr expects a plain transaction, not a fee-bump.');
  }
  if (tx.operations.length !== 1) {
    throw new Error('assembleInvokeXdr expects a single-operation invoke transaction.');
  }
  const op = tx.operations[0];
  if (!op || op.type !== 'invokeHostFunction') {
    throw new Error('assembleInvokeXdr expects an invokeHostFunction operation.');
  }

  const sorobanData = xdr.SorobanTransactionData.fromXDR(transactionData, 'base64');
  const authEntries = auth.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64'));
  const fee = (BigInt(inclusionFee ?? BASE_FEE) + BigInt(minResourceFee)).toString();

  const source = new Account(tx.source, (BigInt(tx.sequence) - 1n).toString());
  const builder = new TransactionBuilder(source, { fee, networkPassphrase })
    .addOperation(
      Operation.invokeHostFunction({
        func: op.func,
        auth: authEntries,
        ...(op.source ? { source: op.source } : {}),
      }),
    )
    .setSorobanData(sorobanData);
  if (tx.timeBounds) {
    builder.setTimebounds(Number(tx.timeBounds.minTime), Number(tx.timeBounds.maxTime));
  } else {
    builder.setTimeout(180);
  }
  return builder.build().toXDR();
}
