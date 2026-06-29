import { describe, it, expect, beforeEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { handle, lock } from '@core/session/handler';

function memoryKV(): KV {
  const store = new Map<string, string>();
  return {
    get: async (k) => (store.has(k) ? store.get(k)! : null),
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
}

describe('in-process session handler', () => {
  beforeEach(() => {
    __setKV(memoryKV());
    lock();
  });

  it('reports uninitialized + locked before any wallet exists', async () => {
    const res = await handle({ type: 'GET_STATUS' });
    expect(res).toEqual({ ok: true, data: { initialized: false, locked: true, address: null } });
  });

  it('creates a wallet, then unlock round-trips', async () => {
    const gen = await handle({ type: 'GENERATE_MNEMONIC', strength: 128 });
    if (!gen.ok) throw new Error('mnemonic gen failed');
    const mnemonic = (gen.data as { mnemonic: string }).mnemonic;

    const created = await handle({ type: 'CREATE_WALLET', mnemonic, password: 'pw-correct' });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('create wallet failed');
    const address = (created.data as { address: string }).address;
    expect(address).toMatch(/^G/);

    const afterCreate = await handle({ type: 'GET_STATUS' });
    expect(afterCreate.ok && afterCreate.data).toMatchObject({ initialized: true, locked: false });

    lock();
    const locked = await handle({ type: 'GET_STATUS' });
    expect(locked.ok && (locked.data as { locked: boolean }).locked).toBe(true);

    const bad = await handle({ type: 'UNLOCK', password: 'wrong' });
    expect(bad).toMatchObject({ ok: false, code: 'BAD_PASSWORD' });

    const good = await handle({ type: 'UNLOCK', password: 'pw-correct' });
    expect(good.ok && (good.data as { address: string }).address).toBe(address);
  });

  it('rejects signing while locked', async () => {
    const res = await handle({
      type: 'SIGN_AND_SUBMIT', xdr: 'x', networkPassphrase: 'p', horizonUrl: 'h',
    });
    expect(res).toMatchObject({ ok: false, code: 'LOCKED' });
  });
});
