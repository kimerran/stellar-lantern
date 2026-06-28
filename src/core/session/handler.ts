import { Keypair, Horizon, TransactionBuilder } from '@stellar/stellar-sdk';
import type { Request, Result, ResponseMap } from '@shared/messages';
import { getSettings, getVault, setVault, clearVault } from '@shared/storage';
import { encryptSecret, decryptSecret, WrongPasswordError } from '@core/crypto/vault';
import {
  generateMnemonic,
  importFromInput,
  keypairFromMnemonic,
  keypairFromStoredSecret,
  InvalidImportError,
} from '@core/wallet/wallet';

// ───────────────────────── In-memory unlocked session ─────────────────────────
// Host-agnostic wallet request handler. The decrypted keypair lives ONLY in this
// module's memory — never in storage, never in the UI. Both hosts reuse it:
//   • MV3 extension — runs inside the service worker (src/background).
//   • Android (Capacitor) — runs in the single app JS context (src/mobile).
// Storage and messaging are abstracted (see shared/storage, shared/messages), so
// nothing here is browser-extension-specific.

interface UnlockedSession {
  keypair: Keypair;
  unlockedAt: number;
}

let session: UnlockedSession | null = null;
let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

async function armAutoLock(): Promise<void> {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  const { autoLockMinutes } = await getSettings();
  autoLockTimer = setTimeout(() => lockSession(), autoLockMinutes * 60_000);
}

/** Drop the in-memory session (called on lock, reset, and host start/stop). */
export function lockSession(): void {
  session = null;
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

function ok<K extends keyof ResponseMap>(data: ResponseMap[K]): Result<ResponseMap[K]> {
  return { ok: true, data };
}

async function handle(req: Request): Promise<Result<unknown>> {
  switch (req.type) {
    case 'GET_STATUS': {
      const vault = await getVault();
      return ok<'GET_STATUS'>({
        initialized: vault !== null,
        locked: session === null,
        address: session?.keypair.publicKey() ?? vault?.address ?? null,
      });
    }

    case 'GENERATE_MNEMONIC': {
      return ok<'GENERATE_MNEMONIC'>({ mnemonic: generateMnemonic(req.strength) });
    }

    case 'CREATE_WALLET': {
      const keypair = keypairFromMnemonic(req.mnemonic);
      const cipher = await encryptSecret(req.mnemonic, req.password);
      const address = keypair.publicKey();
      await setVault({ version: 1, address, cipher });
      session = { keypair, unlockedAt: Date.now() };
      await armAutoLock();
      return ok<'CREATE_WALLET'>({ address });
    }

    case 'IMPORT_WALLET': {
      const { keypair, secretToStore } = importFromInput(req.input);
      const cipher = await encryptSecret(secretToStore, req.password);
      const address = keypair.publicKey();
      await setVault({ version: 1, address, cipher });
      session = { keypair, unlockedAt: Date.now() };
      await armAutoLock();
      return ok<'IMPORT_WALLET'>({ address });
    }

    case 'UNLOCK': {
      const vault = await getVault();
      if (!vault) return { ok: false, error: 'No wallet found.', code: 'NOT_INITIALIZED' };
      const secret = await decryptSecret(vault.cipher, req.password);
      const keypair = keypairFromStoredSecret(secret);
      session = { keypair, unlockedAt: Date.now() };
      await armAutoLock();
      return ok<'UNLOCK'>({ address: keypair.publicKey() });
    }

    case 'LOCK': {
      lockSession();
      return ok<'LOCK'>({ ok: true });
    }

    case 'PING': {
      if (session) await armAutoLock();
      return ok<'PING'>({ ok: true });
    }

    case 'SIGN_AND_SUBMIT': {
      if (!session) {
        return { ok: false, error: 'Wallet is locked.', code: 'LOCKED' };
      }
      await armAutoLock();
      const tx = TransactionBuilder.fromXDR(req.xdr, req.networkPassphrase);
      tx.sign(session.keypair);
      const server = new Horizon.Server(req.horizonUrl);
      const res = await server.submitTransaction(tx);
      return ok<'SIGN_AND_SUBMIT'>({ hash: res.hash });
    }

    case 'RESET_WALLET': {
      lockSession();
      await clearVault();
      return ok<'RESET_WALLET'>({ ok: true });
    }
  }
}

/**
 * Handle a request, converting any thrown error into a readable Result so the
 * UI can branch without try/catch. This is the single entry point both hosts
 * route messages to.
 */
export async function dispatch(req: Request): Promise<Result<unknown>> {
  try {
    return await handle(req);
  } catch (err) {
    return toErrorResult(err);
  }
}

// Convert thrown errors into readable Results. Never leak secrets or raw XDR.
function toErrorResult(err: unknown): Result<never> {
  if (err instanceof WrongPasswordError) {
    return { ok: false, error: 'Incorrect password.', code: 'BAD_PASSWORD' };
  }
  if (err instanceof InvalidImportError) {
    return { ok: false, error: err.message, code: 'VALIDATION' };
  }
  const horizonReason = extractHorizonError(err);
  if (horizonReason) return { ok: false, error: horizonReason, code: 'NETWORK' };

  const message = err instanceof Error ? err.message : 'Something went wrong.';
  return { ok: false, error: message };
}

function extractHorizonError(err: unknown): string | null {
  const e = err as {
    response?: { data?: { extras?: { result_codes?: { operations?: string[]; transaction?: string } } } };
  };
  const codes = e?.response?.data?.extras?.result_codes;
  if (!codes) return null;
  const op = codes.operations?.find((c) => c && c !== 'op_success');
  const reason = op ?? codes.transaction;
  if (!reason) return null;
  return humanizeResultCode(reason);
}

function humanizeResultCode(code: string): string {
  const map: Record<string, string> = {
    op_underfunded: 'Insufficient balance for this payment.',
    op_no_destination: 'The destination account does not exist.',
    op_no_trust: 'The destination has no trustline for this asset.',
    op_line_full: "The destination's balance limit for this asset is full.",
    op_low_reserve: 'Amount is below the minimum account reserve.',
    tx_insufficient_fee: 'Network fee too low — please retry.',
    tx_bad_seq: 'Transaction sequence was stale — please retry.',
  };
  return map[code] ?? `Transaction failed: ${code}`;
}
