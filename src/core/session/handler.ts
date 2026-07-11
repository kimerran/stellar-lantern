import '@shared/polyfills'; // must be first — sets Buffer/process/global before Stellar loads
import { Keypair, Horizon, TransactionBuilder } from '@stellar/stellar-sdk';
import type { Request, Result, ResponseMap } from '@shared/messages';
import { getSettings, getVault, setVault, clearVault } from '@shared/storage';
import { getKV } from '@shared/kv';
import { encryptSecret, decryptSecret, WrongPasswordError } from '@core/crypto/vault';
import {
  biometricUnlock,
  enableBiometricUnlock,
  disableBiometricUnlock,
  isBiometricEnabled,
} from '@core/crypto/biometric-unlock';
import { getBiometricStore } from '@core/crypto/biometric-store';
import {
  generateMnemonic,
  importFromInput,
  keypairFromMnemonic,
  keypairFromStoredSecret,
  InvalidImportError,
} from '@core/wallet/wallet';

// The decrypted keypair lives ONLY here, never in storage, never in the popup.
interface UnlockedSession {
  keypair: Keypair;
  unlockedAt: number;
}

let session: UnlockedSession | null = null;
let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

async function armAutoLock(): Promise<void> {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  const { autoLockMinutes } = await getSettings();
  // 0 / non-positive means "never auto-lock" — arming setTimeout(0) would lock
  // the wallet immediately, so leave the timer disarmed instead.
  if (!(autoLockMinutes > 0)) {
    autoLockTimer = null;
    return;
  }
  autoLockTimer = setTimeout(() => lock(), autoLockMinutes * 60_000);
}

export function lock(): void {
  session = null;
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

function ok<K extends keyof ResponseMap>(data: ResponseMap[K]): Result<ResponseMap[K]> {
  return { ok: true, data };
}

// Map a fail-soft biometricUnlock reason to a typed Result the UI branches on to
// fall back to the password field.
function biometricFailure(reason: 'not-enrolled' | 'cancelled' | 'failed'): Result<never> {
  switch (reason) {
    case 'not-enrolled':
      return { ok: false, error: 'Biometric unlock isn’t set up.', code: 'NOT_ENROLLED' };
    case 'cancelled':
      return { ok: false, error: 'Biometric check was cancelled.', code: 'BIOMETRIC_CANCELLED' };
    case 'failed':
      return { ok: false, error: 'Biometric unlock failed — use your password.', code: 'BIOMETRIC_FAILED' };
  }
}

async function dispatch(req: Request): Promise<Result<unknown>> {
  switch (req.type) {
    case 'GET_STATUS': {
      const vault = await getVault();
      return ok<'GET_STATUS'>({
        initialized: vault !== null,
        locked: session === null,
        address: session?.keypair.publicKey() ?? vault?.address ?? null,
        // Gated behind BIOMETRIC_UNLOCK (#81): a build with the flag off reports
        // biometric fully unavailable, so the Unlock screen never offers it —
        // keeping the in-progress (#23 M2a) surface out of store builds.
        biometricEnabled: __FEATURE_BIOMETRIC_UNLOCK__ && (await isBiometricEnabled(await getKV())),
        biometricAvailable: __FEATURE_BIOMETRIC_UNLOCK__ && (await getBiometricStore().isAvailable()),
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

    case 'ENABLE_BIOMETRIC': {
      // Enrol biometric unlock. Re-verify the password against the vault BEFORE
      // wrapping it, so a wrong password can never be enrolled (decryptSecret
      // throws WrongPasswordError → BAD_PASSWORD).
      const vault = await getVault();
      if (!vault) return { ok: false, error: 'No wallet found.', code: 'NOT_INITIALIZED' };
      await decryptSecret(vault.cipher, req.password);
      await enableBiometricUnlock(req.password, { store: getBiometricStore(), kv: await getKV() });
      return ok<'ENABLE_BIOMETRIC'>({ ok: true });
    }

    case 'BIOMETRIC_UNLOCK': {
      const vault = await getVault();
      if (!vault) return { ok: false, error: 'No wallet found.', code: 'NOT_INITIALIZED' };
      const result = await biometricUnlock({ store: getBiometricStore(), kv: await getKV() });
      if (!result.ok) return biometricFailure(result.reason);
      // Recovered password still runs the normal vault decrypt — a bad envelope
      // can't yield access.
      const secret = await decryptSecret(vault.cipher, result.password);
      const keypair = keypairFromStoredSecret(secret);
      session = { keypair, unlockedAt: Date.now() };
      await armAutoLock();
      return ok<'BIOMETRIC_UNLOCK'>({ address: keypair.publicKey() });
    }

    case 'DISABLE_BIOMETRIC': {
      await disableBiometricUnlock({ store: getBiometricStore(), kv: await getKV() });
      return ok<'DISABLE_BIOMETRIC'>({ ok: true });
    }

    case 'LOCK': {
      lock();
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

    case 'SIGN_ONLY': {
      if (!session) {
        return { ok: false, error: 'Wallet is locked.', code: 'LOCKED' };
      }
      await armAutoLock();
      // Sign but DO NOT submit — hand the signed XDR back to the caller. Any
      // signatures already on the envelope are preserved (fromXDR keeps them,
      // sign() appends ours), so this doubles as a co-signing primitive: a
      // guardian adds their signature to a partially-signed recovery tx without
      // broadcasting it, and SEP-10 signs a challenge tx that is returned, never
      // submitted. Consumers: guardian recovery (#23), anchor SEP-10 auth (#24).
      const tx = TransactionBuilder.fromXDR(req.xdr, req.networkPassphrase);
      tx.sign(session.keypair);
      return ok<'SIGN_ONLY'>({ signedXdr: tx.toXDR() });
    }

    case 'SUBMIT_ONLY': {
      // Broadcast an ALREADY-signed transaction without adding our signature.
      // Used by guardian recovery (#23): the recovering device collects K
      // guardian co-signatures and submits the merged tx — but its own key is
      // NOT a signer on the account being recovered, so signing here would
      // attach an unused signature and Horizon would reject the tx
      // (tx_bad_auth_extra). No unlock needed — this only broadcasts.
      const tx = TransactionBuilder.fromXDR(req.xdr, req.networkPassphrase);
      const server = new Horizon.Server(req.horizonUrl);
      const res = await server.submitTransaction(tx);
      return ok<'SUBMIT_ONLY'>({ hash: res.hash });
    }

    case 'SIGN_MESSAGE': {
      if (!session) {
        return { ok: false, error: 'Wallet is locked.', code: 'LOCKED' };
      }
      await armAutoLock();
      // Domain-separate the input so a signed "message" can never be a valid
      // transaction signature. Sign the UTF-8 bytes; return base64.
      const bytes = Buffer.from(`${SIGN_MESSAGE_PREFIX}${req.message}`, 'utf8');
      const signature = session.keypair.sign(bytes).toString('base64');
      return ok<'SIGN_MESSAGE'>({ signature });
    }

    case 'RESET_WALLET': {
      lock();
      await clearVault();
      return ok<'RESET_WALLET'>({ ok: true });
    }
  }
}

// Prefix that domain-separates wallet-signed messages from transaction envelopes.
export const SIGN_MESSAGE_PREFIX = 'Lantern signed message:\n';

// Public entry point. Never throws — converts errors to readable Results so
// both the service worker and the in-process (mobile) caller can rely on it.
export async function handle(req: Request): Promise<Result<unknown>> {
  try {
    return await dispatch(req);
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
