import { describe, it, expect, beforeEach } from 'vitest';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { __setKV, type KV } from '@shared/kv';
import { handle, lock, SIGN_MESSAGE_PREFIX } from '@core/session/handler';
import { buildTransferXdr } from '@core/stellar/tx';

// A funded destination so buildTransferXdr emits a payment (any valid G-address).
const DEST = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';

async function createUnlockedWallet(password = 'pw'): Promise<string> {
  const gen = await handle({ type: 'GENERATE_MNEMONIC', strength: 128 });
  if (!gen.ok) throw new Error('mnemonic gen failed');
  const mnemonic = (gen.data as { mnemonic: string }).mnemonic;
  const created = await handle({ type: 'CREATE_WALLET', mnemonic, password });
  if (!created.ok) throw new Error('create wallet failed');
  return (created.data as { address: string }).address;
}

function unsignedPaymentXdr(source: string): string {
  return buildTransferXdr({
    sourceAccountId: source,
    sourceSequence: '1',
    networkPassphrase: Networks.TESTNET,
    baseFee: '100',
    destination: DEST,
    destinationFunded: true,
    asset: { isNative: true },
    amount: '10',
  });
}

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
    expect(res).toEqual({
      ok: true,
      data: { initialized: false, locked: true, address: null, biometricEnabled: false, biometricAvailable: false },
    });
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

  it('rejects SIGN_MESSAGE while locked', async () => {
    const res = await handle({ type: 'SIGN_MESSAGE', message: 'hello' });
    expect(res).toMatchObject({ ok: false, code: 'LOCKED' });
  });

  it('rejects SIGN_ONLY while locked', async () => {
    const res = await handle({ type: 'SIGN_ONLY', xdr: 'x', networkPassphrase: Networks.TESTNET });
    expect(res).toMatchObject({ ok: false, code: 'LOCKED' });
  });

  it('SUBMIT_ONLY is broadcast-only — not gated on an unlocked session', async () => {
    // Locked (beforeEach) + a malformed XDR: unlike SIGN_AND_SUBMIT it must NOT
    // reject with LOCKED (it never touches the key), it just fails to parse.
    const res = await handle({
      type: 'SUBMIT_ONLY',
      xdr: 'not-a-real-xdr',
      networkPassphrase: Networks.TESTNET,
      horizonUrl: 'https://horizon-testnet.stellar.org',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).not.toBe('LOCKED');
  });

  it('SIGN_ONLY signs the tx with the wallet key and returns it unsubmitted', async () => {
    const address = await createUnlockedWallet();
    const xdr = unsignedPaymentXdr(address);
    // Sanity: the input is unsigned.
    expect(TransactionBuilder.fromXDR(xdr, Networks.TESTNET).signatures).toHaveLength(0);

    const res = await handle({ type: 'SIGN_ONLY', xdr, networkPassphrase: Networks.TESTNET });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { signedXdr } = res.data as { signedXdr: string };

    const signed = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    expect(signed.signatures).toHaveLength(1);
    // The signature is really the wallet's, over this tx's signing hash.
    const sig = signed.signatures[0]!.signature();
    expect(Keypair.fromPublicKey(address).verify(signed.hash(), sig)).toBe(true);
  });

  it('SIGN_ONLY appends to existing signatures (co-signing primitive)', async () => {
    const address = await createUnlockedWallet();
    const xdr = unsignedPaymentXdr(address);
    const first = await handle({ type: 'SIGN_ONLY', xdr, networkPassphrase: Networks.TESTNET });
    if (!first.ok) throw new Error('first sign failed');
    const onceSigned = (first.data as { signedXdr: string }).signedXdr;

    // Feed the already-signed envelope back in — a second signer adds their
    // signature rather than replacing the first.
    const second = await handle({ type: 'SIGN_ONLY', xdr: onceSigned, networkPassphrase: Networks.TESTNET });
    if (!second.ok) throw new Error('co-sign failed');
    const twiceSigned = (second.data as { signedXdr: string }).signedXdr;
    expect(TransactionBuilder.fromXDR(twiceSigned, Networks.TESTNET).signatures).toHaveLength(2);
  });

  it('returns a domain-separated signature verifiable with the public key', async () => {
    const gen = await handle({ type: 'GENERATE_MNEMONIC', strength: 128 });
    if (!gen.ok) throw new Error('mnemonic gen failed');
    const mnemonic = (gen.data as { mnemonic: string }).mnemonic;
    const created = await handle({ type: 'CREATE_WALLET', mnemonic, password: 'pw' });
    if (!created.ok) throw new Error('create wallet failed');
    const address = (created.data as { address: string }).address;

    const message = 'Sign in to BlockHub at 2026-06-30';
    const res = await handle({ type: 'SIGN_MESSAGE', message });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const signature = (res.data as { signature: string }).signature;

    // Verify against the domain-separated bytes with the account's public key.
    const bytes = Buffer.from(`${SIGN_MESSAGE_PREFIX}${message}`, 'utf8');
    expect(Keypair.fromPublicKey(address).verify(bytes, Buffer.from(signature, 'base64'))).toBe(true);
    // A different message must NOT verify against the same signature.
    expect(
      Keypair.fromPublicKey(address).verify(Buffer.from('other', 'utf8'), Buffer.from(signature, 'base64')),
    ).toBe(false);
  });
});
