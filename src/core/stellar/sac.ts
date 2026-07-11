// Stellar Asset Contract (SAC) helpers for the passkey smart account (#53).
// A smart account is a C… contract address: Horizon can't show its balances and
// classic payments can't reach it — value moves through the asset's SAC
// `transfer(from, to, amount)`. XLM held by a contract lives in a SAC
// `Balance(address)` contract-data entry, which we read directly via
// `getLedgerEntries` (no funded source account needed, unlike a simulation).
//
// Pure builders + injectable-fetch reads, mirroring soroban.ts / invoke.ts.

import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  scValToNative,
  TransactionBuilder,
  XdrLargeInt,
  xdr,
} from '@stellar/stellar-sdk';
import { isValidContractId } from '@core/wallet/wallet';
import { getLedgerEntries } from './soroban';

const I128_MAX = 2n ** 127n - 1n;
const DEFAULT_TIMEOUT_SECS = 180;

/** The native-XLM SAC contract id (deterministic per network). */
export function nativeSacId(networkPassphrase: string): string {
  return Asset.native().contractId(networkPassphrase);
}

function addressScVal(value: string, what: string): xdr.ScVal {
  try {
    return new Address(value.trim()).toScVal();
  } catch {
    throw new Error(`Invalid ${what}: expected a G… or C… address.`);
  }
}

/** Base64 LedgerKey for a SAC `Balance(holder)` contract-data entry. */
export function sacBalanceKeyXdr(sacId: string, holderContractId: string): string {
  if (!isValidContractId(sacId)) throw new Error('Invalid SAC contract id.');
  if (!isValidContractId(holderContractId)) throw new Error('Invalid holder contract id.');
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(sacId).toScAddress(),
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Balance'),
        new Address(holderContractId).toScVal(),
      ]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  ).toXDR('base64');
}

export interface SacContractBalanceParams {
  holderContractId: string; // C… (the smart account)
  networkPassphrase: string;
  rpcUrl: string;
  fetchImpl?: typeof fetch;
}

export type SacBalanceResult = { ok: true; stroops: bigint } | { ok: false; error: string };

/**
 * The holder contract's native-XLM balance in stroops. A missing entry means
 * the contract has simply never held XLM → 0n, not an error.
 */
export async function sacContractBalance(params: SacContractBalanceParams): Promise<SacBalanceResult> {
  const sacId = nativeSacId(params.networkPassphrase);
  const keyXdr = sacBalanceKeyXdr(sacId, params.holderContractId);
  let res;
  try {
    res = await getLedgerEntries([keyXdr], {
      rpcUrl: params.rpcUrl,
      ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Balance lookup failed.' };
  }
  if (!res.ok) return res;
  const entry = res.entries.find((e) => e.keyXdr === keyXdr) ?? res.entries[0];
  if (!entry) return { ok: true, stroops: 0n };

  try {
    const data = xdr.LedgerEntryData.fromXDR(entry.xdr, 'base64');
    const value = scValToNative(data.contractData().val()) as { amount?: unknown };
    if (typeof value?.amount !== 'bigint') {
      return { ok: false, error: 'Unexpected balance entry shape.' };
    }
    return { ok: true, stroops: value.amount };
  } catch {
    return { ok: false, error: 'Unreadable balance entry.' };
  }
}

export interface BuildSacTransferParams {
  sacId: string; // C… of the asset's SAC (nativeSacId for XLM)
  from: string; // G… or C… — the smart account when sending out
  to: string; // G… or C…
  amountStroops: string; // positive integer, in stroops
  sourceAccount: string; // fee-paying tx source (G…)
  sourceSequence: string;
  networkPassphrase: string;
  fee?: string;
  timeoutSecs?: number;
}

/**
 * Build the *unsigned, pre-simulation* XDR for a SAC `transfer(from, to,
 * amount)`. When `from` is the smart account, simulation returns an auth entry
 * for it — which `signAuthEntriesWithPasskey` then signs.
 */
export function buildSacTransferXdr(params: BuildSacTransferParams): string {
  if (!isValidContractId(params.sacId)) throw new Error('Invalid SAC contract id.');
  const amount = params.amountStroops.trim();
  if (!/^\d+$/.test(amount)) throw new Error('Invalid amount: expected a positive integer (stroops).');
  const n = BigInt(amount);
  if (n <= 0n || n > I128_MAX) throw new Error('Invalid amount: out of range.');

  const args = [
    addressScVal(params.from, 'sender'),
    addressScVal(params.to, 'destination'),
    new XdrLargeInt('i128', amount).toScVal(),
  ];
  return new TransactionBuilder(new Account(params.sourceAccount.trim(), params.sourceSequence), {
    fee: params.fee || BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(new Contract(params.sacId.trim()).call('transfer', ...args))
    .setTimeout(params.timeoutSecs ?? DEFAULT_TIMEOUT_SECS)
    .build()
    .toXDR();
}
