import { describe, it, expect, beforeEach } from 'vitest';
import { Keypair, StrKey, hash } from '@stellar/stellar-sdk';
import { __setKV, type KV } from '@shared/kv';
import { handle, lock, SIGN_MESSAGE_PREFIX } from '@core/session/handler';

// FROZEN FORMAT (#265). `lantern:signMessage` (the mini-app bridge) answers with
// SIGN_MESSAGE's signature, and dApps verify it as Lantern's own scheme:
//
//   signature = base64( ed25519_sign( UTF-8("Lantern signed message:\n" + message) ) )
//
// unhashed, not SEP-53. Centient's sign-in depends on exactly this
// (lib/stellar/signature.ts in artisam-centient/centient, `scheme: "lantern"`).
// If this test fails, you have broken every dApp that signs users in through
// Lantern. Don't update the pinned values: SEP-53 goes in a new method
// (`lantern:signMessageSep53` / web-connect `signMessage`, #253), never here.
// Protocol: docs/mini-app-bridge.md.

// A fixed key: the ed25519 seed is 32 bytes of 0x07.
const SEED = Buffer.alloc(32, 7);
const KEYPAIR = Keypair.fromRawEd25519Seed(SEED);
const MESSAGE = 'Centient sign-in\nnonce: 3f2a9c1e-0b7d-4e55-9a61-7c2d8e4f1b90';

// The pinned answer. ed25519 is deterministic, so this never changes unless the
// signed bytes do.
const PINNED_ADDRESS = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const PINNED_SIGNATURE =
  'gjcodILf2PMv2oaOf3b6lOs3cKbIbJpu1F74p5s3l5LG1ja/NTOFsKug18iCBKUkgOMHUCp5e5fewthMbSclAw==';

// Centient's verifier, mirrored from lib/stellar/signature.ts (`verify` with
// scheme "lantern"): base64 signature of exactly 64 bytes, checked against the
// raw prefix + message bytes with the claimed G… address.
const LANTERN_PREFIX = Buffer.from('Lantern signed message:\n', 'utf8');
function centientVerifyLantern(publicKey: string, message: string, signature: string): boolean {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) return false;
  const sigBytes = Buffer.from(signature, 'base64');
  if (sigBytes.length !== 64) return false;
  const signed = Buffer.concat([LANTERN_PREFIX, Buffer.from(message, 'utf8')]);
  try {
    return Keypair.fromPublicKey(publicKey).verify(signed, sigBytes);
  } catch {
    return false;
  }
}

// SEP-53 for contrast: SHA-256("Stellar Signed Message:\n" + message).
function sep53Verify(publicKey: string, message: string, signature: string): boolean {
  const digest = hash(
    Buffer.concat([Buffer.from('Stellar Signed Message:\n', 'utf8'), Buffer.from(message, 'utf8')]),
  );
  return Keypair.fromPublicKey(publicKey).verify(digest, Buffer.from(signature, 'base64'));
}

function memoryKV(): KV {
  const store = new Map<string, string>();
  return {
    get: async (k) => (store.has(k) ? store.get(k)! : null),
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
}

async function signWithFixedKey(message: string): Promise<{ address: string; signature: string }> {
  const imported = await handle({ type: 'IMPORT_WALLET', input: KEYPAIR.secret(), password: 'pw' });
  if (!imported.ok) throw new Error(`import failed: ${imported.error}`);
  const res = await handle({ type: 'SIGN_MESSAGE', message });
  if (!res.ok) throw new Error(`sign failed: ${res.error}`);
  return {
    address: (imported.data as { address: string }).address,
    signature: (res.data as { signature: string }).signature,
  };
}

describe('lantern:signMessage format is frozen (#265)', () => {
  beforeEach(() => {
    __setKV(memoryKV());
    lock();
  });

  it('keeps the prefix', () => {
    expect(SIGN_MESSAGE_PREFIX).toBe('Lantern signed message:\n');
  });

  it('a fixed key and message give the pinned base64 signature', async () => {
    const { address, signature } = await signWithFixedKey(MESSAGE);
    expect(address).toBe(PINNED_ADDRESS);
    expect(signature).toBe(PINNED_SIGNATURE);
  });

  it("verifies the way Centient verifies (scheme 'lantern')", async () => {
    const { address, signature } = await signWithFixedKey(MESSAGE);
    expect(centientVerifyLantern(address, MESSAGE, signature)).toBe(true);
    expect(centientVerifyLantern(address, `${MESSAGE} `, signature)).toBe(false);
  });

  it('is not SEP-53 (that is a separate method, #253)', async () => {
    const { address, signature } = await signWithFixedKey(MESSAGE);
    expect(sep53Verify(address, MESSAGE, signature)).toBe(false);
  });
});
