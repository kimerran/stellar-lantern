import { describe, it, expect, beforeEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { handle, lock } from '@core/session/handler';
import { __setBiometricStore } from '@core/crypto/biometric-store';
import type { BiometricStore } from '@core/crypto/biometric-unlock';

function memoryKV(): KV {
  const store = new Map<string, string>();
  return {
    get: async (k) => (store.has(k) ? store.get(k)! : null),
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
}

// A fake biometric-gated key store; `unlocked` simulates passing the prompt.
function fakeStore(state = { unlocked: true }) {
  let key: Uint8Array | null = null;
  const store: BiometricStore = {
    isAvailable: async () => true,
    setKey: async (k) => void (key = k),
    getKey: async () => (state.unlocked ? key : null),
    clearKey: async () => void (key = null),
  };
  return { store, state, hasKey: () => key != null, dropKey: () => (key = null) };
}

async function createWallet(password = 'pw'): Promise<string> {
  const gen = await handle({ type: 'GENERATE_MNEMONIC', strength: 128 });
  const mnemonic = (gen as { data: { mnemonic: string } }).data.mnemonic;
  const created = await handle({ type: 'CREATE_WALLET', mnemonic, password });
  return (created as { data: { address: string } }).data.address;
}

describe('handler — biometric unlock', () => {
  let fs: ReturnType<typeof fakeStore>;
  beforeEach(() => {
    __setKV(memoryKV());
    fs = fakeStore({ unlocked: true });
    __setBiometricStore(fs.store);
    lock();
  });

  it('enable → lock → biometric unlock recovers the session', async () => {
    const address = await createWallet('s3cret');
    expect(await handle({ type: 'ENABLE_BIOMETRIC', password: 's3cret' })).toEqual({
      ok: true,
      data: { ok: true },
    });
    expect(fs.hasKey()).toBe(true);

    const status = await handle({ type: 'GET_STATUS' });
    expect((status as { data: { biometricEnabled: boolean } }).data.biometricEnabled).toBe(true);

    lock();
    const unlocked = await handle({ type: 'BIOMETRIC_UNLOCK' });
    expect(unlocked).toEqual({ ok: true, data: { address } });
    // session is really unlocked now
    expect((await handle({ type: 'GET_STATUS' }) as { data: { locked: boolean } }).data.locked).toBe(false);
  });

  it('rejects enrolling with the wrong password (BAD_PASSWORD, nothing stored)', async () => {
    await createWallet('right');
    const res = await handle({ type: 'ENABLE_BIOMETRIC', password: 'wrong' });
    expect(res).toMatchObject({ ok: false, code: 'BAD_PASSWORD' });
    expect(fs.hasKey()).toBe(false);
    expect((await handle({ type: 'GET_STATUS' }) as { data: { biometricEnabled: boolean } }).data.biometricEnabled).toBe(false);
  });

  it('BIOMETRIC_UNLOCK before enrolment → NOT_ENROLLED', async () => {
    await createWallet();
    lock();
    expect(await handle({ type: 'BIOMETRIC_UNLOCK' })).toMatchObject({ ok: false, code: 'NOT_ENROLLED' });
  });

  it('a dismissed biometric prompt → BIOMETRIC_CANCELLED (stays locked)', async () => {
    await createWallet('pw');
    await handle({ type: 'ENABLE_BIOMETRIC', password: 'pw' });
    lock();
    fs.state.unlocked = false; // user cancels
    expect(await handle({ type: 'BIOMETRIC_UNLOCK' })).toMatchObject({ ok: false, code: 'BIOMETRIC_CANCELLED' });
    expect((await handle({ type: 'GET_STATUS' }) as { data: { locked: boolean } }).data.locked).toBe(true);
  });

  it('a key that no longer matches the blob → BIOMETRIC_FAILED', async () => {
    await createWallet('pw');
    await handle({ type: 'ENABLE_BIOMETRIC', password: 'pw' });
    lock();
    fs.dropKey();
    fs.store.setKey(new Uint8Array(32)); // rotated key
    expect(await handle({ type: 'BIOMETRIC_UNLOCK' })).toMatchObject({ ok: false, code: 'BIOMETRIC_FAILED' });
  });

  it('disable clears enrolment', async () => {
    await createWallet('pw');
    await handle({ type: 'ENABLE_BIOMETRIC', password: 'pw' });
    expect(await handle({ type: 'DISABLE_BIOMETRIC' })).toEqual({ ok: true, data: { ok: true } });
    expect(fs.hasKey()).toBe(false);
    lock();
    expect(await handle({ type: 'BIOMETRIC_UNLOCK' })).toMatchObject({ ok: false, code: 'NOT_ENROLLED' });
  });

  it('RESET_WALLET purges the biometric envelope (#127)', async () => {
    await createWallet('pw');
    await handle({ type: 'ENABLE_BIOMETRIC', password: 'pw' });
    expect(fs.hasKey()).toBe(true);

    expect(await handle({ type: 'RESET_WALLET' })).toEqual({ ok: true, data: { ok: true } });

    // The wrapping key is gone from the native store AND the KV enrolment flag
    // is cleared — a fresh state, no stale wrapped password lingering.
    expect(fs.hasKey()).toBe(false);
    expect((await handle({ type: 'GET_STATUS' }) as { data: { biometricEnabled: boolean } }).data.biometricEnabled).toBe(false);
  });

  it('RESET_WALLET still succeeds when nothing is enrolled (fail-soft)', async () => {
    await createWallet('pw');
    expect(await handle({ type: 'RESET_WALLET' })).toEqual({ ok: true, data: { ok: true } });
    expect(fs.hasKey()).toBe(false);
  });

  it('IMPORT_WALLET overwrite purges a prior wallet’s biometric enrolment (#127)', async () => {
    await createWallet('pw');
    await handle({ type: 'ENABLE_BIOMETRIC', password: 'pw' });
    expect(fs.hasKey()).toBe(true);

    // Re-import over the existing vault — a different wallet with a new password.
    const mnemonic = (await handle({ type: 'GENERATE_MNEMONIC', strength: 128 }) as { data: { mnemonic: string } }).data.mnemonic;
    const imported = await handle({ type: 'IMPORT_WALLET', input: mnemonic, password: 'new-pw' });
    expect(imported).toMatchObject({ ok: true });

    // The old wallet's wrapped password must not persist over the new vault.
    expect(fs.hasKey()).toBe(false);
    expect((await handle({ type: 'GET_STATUS' }) as { data: { biometricEnabled: boolean } }).data.biometricEnabled).toBe(false);
  });
});
