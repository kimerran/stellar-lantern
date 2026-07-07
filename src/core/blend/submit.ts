// Blend supply/withdraw preparation (#21): the build → simulate → assemble
// pipeline for a pool `submit`, mirroring `prepareInvoke` (#65) but for Blend's
// nested `Request` call shape (which the scalar `InvokeArg` path can't express, so
// `prepareInvoke` can't be reused here). Produces a *ready-to-sign* XDR the Earn
// screen hands to the existing scan → approve → SIGN_AND_SUBMIT path.
//
// Pure/offline: the `fetch` is injectable so the whole pipeline is unit-testable
// without a live RPC. Every failure (bad input, RPC/network error, contract would
// revert, missing footprint) comes back as `{ ok: false, error }` rather than
// throwing, so the caller surfaces one thing.

import { simulateTransaction } from '@core/stellar/soroban';
import { assembleInvokeXdr } from '@core/stellar/invoke';
import { buildBlendSubmitXdr, type BlendAction } from './pool';

/**
 * Convert a human amount (e.g. "1.5") into integer base units for a token with
 * `decimals` decimal places (e.g. 7 → "15000000"). Throws on a malformed amount,
 * too many decimal places, or a non-positive result — the i128 base-unit string
 * `buildBlendSubmitXdr` expects.
 */
export function toBaseUnits(human: string, decimals: number): string {
  const t = human.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error('Enter a valid amount.');
  const [intPart, fracPart = ''] = t.split('.');
  if (fracPart.length > decimals) {
    throw new Error(`Use at most ${decimals} decimal place${decimals === 1 ? '' : 's'}.`);
  }
  const combined = `${intPart}${fracPart.padEnd(decimals, '0')}`.replace(/^0+/, '');
  if (combined === '') throw new Error('Amount must be greater than zero.');
  return combined;
}

export interface PrepareBlendSubmitParams {
  poolId: string;
  userAddress: string;
  reserveAssetId: string;
  amount: string; // base units (i128), > 0 — use `toBaseUnits` to derive from human input
  action: BlendAction;
  sourceSequence: string;
  networkPassphrase: string;
  rpcUrl: string; // Soroban RPC (NetworkConfig.sorobanRpcUrl)
  fetchImpl?: typeof fetch;
  inclusionFee?: string;
}

export type PrepareBlendResult = { ok: true; xdr: string } | { ok: false; error: string };

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * Build a Blend `submit` supply/withdraw, simulate it against a Soroban RPC to get
 * the footprint + auth + resource fee, and assemble the ready-to-sign XDR.
 */
export async function prepareBlendSubmit(
  params: PrepareBlendSubmitParams,
): Promise<PrepareBlendResult> {
  let built: string;
  try {
    built = buildBlendSubmitXdr({
      poolId: params.poolId,
      userAddress: params.userAddress,
      reserveAssetId: params.reserveAssetId,
      amount: params.amount,
      action: params.action,
      sourceSequence: params.sourceSequence,
      networkPassphrase: params.networkPassphrase,
    });
  } catch (e) {
    return { ok: false, error: errMessage(e, 'Invalid supply request.') };
  }

  let sim;
  try {
    sim = await simulateTransaction(built, {
      rpcUrl: params.rpcUrl,
      ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    });
  } catch (e) {
    return { ok: false, error: errMessage(e, 'Simulation request failed.') };
  }
  if (!sim.ok) return { ok: false, error: sim.error };
  if (!sim.transactionData) {
    return { ok: false, error: 'Simulation returned no footprint data.' };
  }

  try {
    const xdr = assembleInvokeXdr({
      builtXdr: built,
      networkPassphrase: params.networkPassphrase,
      minResourceFee: sim.minResourceFee,
      transactionData: sim.transactionData,
      ...(sim.auth ? { auth: sim.auth } : {}),
      ...(params.inclusionFee !== undefined ? { inclusionFee: params.inclusionFee } : {}),
    });
    return { ok: true, xdr };
  } catch (e) {
    return { ok: false, error: errMessage(e, 'Could not assemble the transaction.') };
  }
}
