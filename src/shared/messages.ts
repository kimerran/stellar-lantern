import { isNativePlatform } from './kv';

// The single messaging contract between the popup and the background worker.
// All cross-context calls go through this discriminated union (AGENT §5).

export type WalletStatus = {
  initialized: boolean; // a vault exists in storage
  locked: boolean; // no unlocked session in the worker
  address: string | null;
};

export type Request =
  | { type: 'GET_STATUS' }
  | { type: 'GENERATE_MNEMONIC'; strength: 128 | 256 }
  | { type: 'CREATE_WALLET'; mnemonic: string; password: string }
  | { type: 'IMPORT_WALLET'; input: string; password: string }
  | { type: 'UNLOCK'; password: string }
  | { type: 'LOCK' }
  | { type: 'PING' } // resets the auto-lock idle timer
  | { type: 'SIGN_AND_SUBMIT'; xdr: string; networkPassphrase: string; horizonUrl: string }
  | { type: 'RESET_WALLET' };

// Every response is a Result so the UI can branch on success without try/catch.
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: ErrorCode };

export type ErrorCode = 'LOCKED' | 'BAD_PASSWORD' | 'NOT_INITIALIZED' | 'VALIDATION' | 'NETWORK';

export type ResponseMap = {
  GET_STATUS: WalletStatus;
  GENERATE_MNEMONIC: { mnemonic: string };
  CREATE_WALLET: { address: string };
  IMPORT_WALLET: { address: string };
  UNLOCK: { address: string };
  LOCK: { ok: true };
  PING: { ok: true };
  SIGN_AND_SUBMIT: { hash: string };
  RESET_WALLET: { ok: true };
};

export type ResponseFor<R extends Request> = Result<ResponseMap[R['type']]>;

// On the extension, messages go to the background worker. On native there is no
// worker — load the in-process handler lazily so its wallet logic is split into
// a chunk the extension popup bundle never loads.
export async function sendMessage<R extends Request>(req: R): Promise<ResponseFor<R>> {
  if (isNativePlatform()) {
    const { handle } = await import('@core/session/handler');
    return (await handle(req)) as ResponseFor<R>;
  }
  return (await chrome.runtime.sendMessage(req)) as ResponseFor<R>;
}
