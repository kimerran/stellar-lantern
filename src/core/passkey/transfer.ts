// Passkey smart-account transfer pipeline (#53), split in two so the scan →
// approve gate sits between them (same discipline as Send.tsx — NO bypass lane):
//
//   preparePasskeyTransfer   → build SAC transfer + simulate + assemble.
//                              The returned XDR is what gets SCANNED and shown
//                              to the user for approval.
//   finalizePasskeyTransfer  → after approval: passkey-sign the auth entries,
//                              RE-simulate (the RPC now enforces the attached
//                              signature — a bad assertion fails here, before
//                              broadcast — and the footprint/fee get refreshed
//                              to include the __check_auth cost), re-assemble.
//
// Envelope signing (the ephemeral fee payer) and SUBMIT_ONLY stay with the
// caller. Injectable fetch + CredentialsApi throughout.

import { TransactionBuilder } from '@stellar/stellar-sdk';
import { assembleInvokeXdr } from '@core/stellar/invoke';
import { buildSacTransferXdr, nativeSacId } from '@core/stellar/sac';
import { simulateTransaction } from '@core/stellar/soroban';
import { signAuthEntriesWithPasskey } from './authEntry';
import type { CredentialsApi } from './webauthn';

export interface PreparePasskeyTransferParams {
  contractId: string; // the smart account (C…) — sender
  destination: string; // G… or C…
  amountStroops: string;
  feeSourceAccount: string; // funded fee payer (G…) — tx source
  feeSourceSequence: string;
  networkPassphrase: string;
  rpcUrl: string;
  fetchImpl?: typeof fetch;
}

export type PreparePasskeyTransferResult =
  | { ok: true; xdr: string; latestLedger: number }
  | { ok: false; error: string };

/**
 * Build → simulate → assemble a native-XLM SAC transfer out of the smart
 * account. The result carries the (unsigned) auth entries the simulation
 * demanded, plus the latest ledger — the caller derives the signature
 * expiration from it. Scan the returned XDR before asking the user to approve.
 */
export async function preparePasskeyTransfer(
  params: PreparePasskeyTransferParams,
): Promise<PreparePasskeyTransferResult> {
  let built: string;
  try {
    built = buildSacTransferXdr({
      sacId: nativeSacId(params.networkPassphrase),
      from: params.contractId,
      to: params.destination,
      amountStroops: params.amountStroops,
      sourceAccount: params.feeSourceAccount,
      sourceSequence: params.feeSourceSequence,
      networkPassphrase: params.networkPassphrase,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid transfer.' };
  }

  let sim;
  try {
    sim = await simulateTransaction(built, {
      rpcUrl: params.rpcUrl,
      ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Simulation request failed.' };
  }
  if (!sim.ok) return { ok: false, error: sim.error };
  if (!sim.transactionData) return { ok: false, error: 'Simulation returned no footprint data.' };
  if (typeof sim.latestLedger !== 'number') {
    return { ok: false, error: 'Simulation returned no ledger number.' };
  }

  try {
    const xdr = assembleInvokeXdr({
      builtXdr: built,
      networkPassphrase: params.networkPassphrase,
      minResourceFee: sim.minResourceFee,
      transactionData: sim.transactionData,
      ...(sim.auth ? { auth: sim.auth } : {}),
    });
    return { ok: true, xdr, latestLedger: sim.latestLedger };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not assemble the transaction.' };
  }
}

export interface FinalizePasskeyTransferParams {
  /** The approved XDR from preparePasskeyTransfer. */
  preparedXdr: string;
  smartAccountId: string;
  rpId: string;
  credentialId: Uint8Array;
  signatureExpirationLedger: number;
  networkPassphrase: string;
  rpcUrl: string;
  credentials?: CredentialsApi;
  fetchImpl?: typeof fetch;
}

export type FinalizePasskeyTransferResult =
  | { ok: true; xdr: string }
  | { ok: false; error: string };

/**
 * Passkey-sign the smart account's auth entries, re-simulate to enforce them
 * and refresh the footprint, and re-assemble. The returned XDR only needs the
 * fee payer's envelope signature before SUBMIT_ONLY.
 */
export async function finalizePasskeyTransfer(
  params: FinalizePasskeyTransferParams,
): Promise<FinalizePasskeyTransferResult> {
  let signedXdr: string;
  try {
    ({ xdr: signedXdr } = await signAuthEntriesWithPasskey({
      txXdr: params.preparedXdr,
      networkPassphrase: params.networkPassphrase,
      smartAccountId: params.smartAccountId,
      rpId: params.rpId,
      credentialId: params.credentialId,
      signatureExpirationLedger: params.signatureExpirationLedger,
      ...(params.credentials ? { credentials: params.credentials } : {}),
    }));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Passkey signing failed.' };
  }

  let sim;
  try {
    sim = await simulateTransaction(signedXdr, {
      rpcUrl: params.rpcUrl,
      ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Simulation request failed.' };
  }
  if (!sim.ok) return { ok: false, error: sim.error };
  if (!sim.transactionData) return { ok: false, error: 'Simulation returned no footprint data.' };

  try {
    // Keep OUR signed auth entries — the re-simulation's echo is not trusted.
    const { xdr: entriesXdr } = extractAuthEntries(signedXdr, params.networkPassphrase);
    const xdr = assembleInvokeXdr({
      builtXdr: signedXdr,
      networkPassphrase: params.networkPassphrase,
      minResourceFee: sim.minResourceFee,
      transactionData: sim.transactionData,
      auth: entriesXdr,
    });
    return { ok: true, xdr };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not assemble the transaction.' };
  }
}

// The signed entries, re-encoded, so assembleInvokeXdr re-attaches exactly them.
function extractAuthEntries(txXdr: string, networkPassphrase: string): { xdr: string[] } {
  const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase);
  if ('innerTransaction' in tx) throw new Error('Expected a plain transaction.');
  const op = tx.toEnvelope().v1().tx().operations()[0];
  if (!op) throw new Error('Transaction has no operations.');
  const entries = op.body().invokeHostFunctionOp().auth();
  return { xdr: entries.map((e) => e.toXDR('base64')) };
}
