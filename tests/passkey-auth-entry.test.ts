// Passkey signing of Soroban auth entries (#53): the payload hash must be
// exactly what Soroban feeds __check_auth (cross-checked against the SDK's own
// authorizeEntry), and signAuthEntriesWithPasskey must attach a verifying
// WebAuthn assertion in the contract's Signature ScVal shape.
import { describe, expect, it } from 'vitest';
import {
  Account,
  Address,
  authorizeEntry,
  hash,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import {
  authEntryPayloadHash,
  passkeySignatureScVal,
  signAuthEntriesWithPasskey,
} from '@core/passkey/authEntry';
import { webauthnSignedMessage } from '@core/passkey/assertion';
import type { CredentialsApi, PasskeyAssertion } from '@core/passkey/webauthn';

const PASSPHRASE = Networks.TESTNET;
const SMART_ACCOUNT = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';
const OTHER_CONTRACT = 'CB64D3G7SM2RTH6JSGG34DDTFTQ5CFDKVDZJZSODMCX4NJ2HV2KN7OHT';
const CREDENTIAL_ID = new Uint8Array([10, 20, 30, 40]);
const EXPIRATION = 424242;

function makeEntry(address: string, nonce: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(address).toScAddress(),
        nonce: xdr.Int64.fromString(nonce),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(OTHER_CONTRACT).toScAddress(),
          functionName: 'transfer',
          args: [xdr.ScVal.scvSymbol('x')],
        }),
      ),
      subInvocations: [],
    }),
  });
}

function wrapInTx(entries: xdr.SorobanAuthorizationEntry[]): string {
  const source = Keypair.random().publicKey();
  return new TransactionBuilder(new Account(source, '7'), {
    fee: '100',
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(OTHER_CONTRACT).toScAddress(),
            functionName: 'transfer',
            args: [],
          }),
        ),
        auth: entries,
      }),
    )
    .setTimeout(180)
    .build()
    .toXDR();
}

// Minimal raw(r‖s) → DER (test-only; authenticators return DER signatures).
function rawToDer(raw: Uint8Array): Uint8Array {
  const derInt = (b: Uint8Array): number[] => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = Array.from(b.subarray(i));
    if ((v[0]! & 0x80) !== 0) v = [0x00, ...v];
    return [0x02, v.length, ...v];
  };
  const content = [...derInt(raw.subarray(0, 32)), ...derInt(raw.subarray(32, 64))];
  return new Uint8Array([0x30, content.length, ...content]);
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const authenticatorKeys = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

/** A fake authenticator that signs whatever challenge it is asked (or a fixed wrong one). */
function fakeAuthenticator(opts: { wrongChallenge?: Uint8Array } = {}): CredentialsApi {
  return {
    create: async () => {
      throw new Error('not used in these tests');
    },
    get: async (options) => {
      const pk = options.publicKey!;
      const asked = new Uint8Array(pk.challenge as ArrayBuffer | Uint8Array as Uint8Array);
      const challenge = opts.wrongChallenge ?? asked;
      const clientDataJSON = new TextEncoder().encode(
        JSON.stringify({ type: 'webauthn.get', challenge: b64url(challenge), origin: 'https://lantern.test' }),
      );
      const authData = new Uint8Array(37);
      authData.set(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lantern.test'))), 0);
      authData[32] = 0x05;
      const cdjHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
      const message = new Uint8Array(authData.length + cdjHash.length);
      message.set(authData, 0);
      message.set(cdjHash, authData.length);
      const raw = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, authenticatorKeys.privateKey, message),
      );
      return {
        rawId: Uint8Array.from(CREDENTIAL_ID).buffer,
        response: {
          authenticatorData: authData.buffer,
          clientDataJSON: clientDataJSON.buffer,
          signature: rawToDer(raw).buffer,
        },
      } as unknown as Credential;
    },
  };
}

describe('authEntryPayloadHash', () => {
  it('matches what the SDK itself signs in authorizeEntry (oracle)', async () => {
    // Use an ed25519 (G…) credential so authorizeEntry can sign with a Keypair,
    // and capture the preimage its signing callback receives.
    const kp = Keypair.random();
    const entry = makeEntry(kp.publicKey(), '987654321');
    let captured: xdr.HashIdPreimage | null = null;
    await authorizeEntry(
      entry,
      async (preimage) => {
        captured = preimage;
        return kp.sign(hash(preimage.toXDR()));
      },
      EXPIRATION,
      PASSPHRASE,
    );
    expect(captured).not.toBeNull();
    // Our function over the same (entry, expiration) must produce the same hash.
    entry.credentials().address().signatureExpirationLedger(EXPIRATION);
    const ours = authEntryPayloadHash(entry, PASSPHRASE);
    expect(Buffer.from(ours).toString('hex')).toBe(hash(captured!.toXDR()).toString('hex'));
  });
});

describe('passkeySignatureScVal', () => {
  it('emits the Signature struct map with keys in ascending order', () => {
    const assertion: PasskeyAssertion = {
      authenticatorData: new Uint8Array([1]),
      clientDataJSON: new Uint8Array([2]),
      signature: new Uint8Array(64).fill(3),
    };
    const scval = passkeySignatureScVal(assertion);
    const keys = scval.map()!.map((e) => e.key().sym().toString());
    expect(keys).toEqual(['authenticator_data', 'client_data_json', 'signature']);
    expect(scval.map()!.map((e) => e.val().switch().name)).toEqual(['scvBytes', 'scvBytes', 'scvBytes']);
  });
});

describe('signAuthEntriesWithPasskey', () => {
  it('signs only the smart-account entry, sets expiration, and the assertion verifies', async () => {
    const txXdr = wrapInTx([makeEntry(SMART_ACCOUNT, '111'), makeEntry(OTHER_CONTRACT, '222')]);
    const { xdr: outXdr, signed } = await signAuthEntriesWithPasskey({
      txXdr,
      networkPassphrase: PASSPHRASE,
      smartAccountId: SMART_ACCOUNT,
      rpId: 'lantern.test',
      credentialId: CREDENTIAL_ID,
      signatureExpirationLedger: EXPIRATION,
      credentials: fakeAuthenticator(),
    });
    expect(signed).toBe(1);

    const envelope = xdr.TransactionEnvelope.fromXDR(outXdr, 'base64');
    const auth = envelope.v1().tx().operations()[0]!.body().invokeHostFunctionOp().auth();
    const mine = auth[0]!.credentials().address();
    const other = auth[1]!.credentials().address();

    expect(mine.signatureExpirationLedger()).toBe(EXPIRATION);
    expect(other.signature().switch().name).toBe('scvVoid'); // untouched

    const map = mine.signature().map()!;
    const bytes = (i: number): Uint8Array => new Uint8Array(map[i]!.val().bytes());
    expect(map.map((e) => e.key().sym().toString())).toEqual([
      'authenticator_data',
      'client_data_json',
      'signature',
    ]);

    // The clientDataJSON's challenge is the payload hash of the SIGNED entry.
    const payload = authEntryPayloadHash(auth[0]!, PASSPHRASE);
    const clientData = JSON.parse(new TextDecoder().decode(bytes(1))) as { challenge: string };
    expect(clientData.challenge).toBe(b64url(payload));

    // And the signature verifies over authenticatorData ‖ SHA-256(clientDataJSON).
    const message = await webauthnSignedMessage(bytes(0), bytes(1));
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      authenticatorKeys.publicKey,
      bytes(2),
      message,
    );
    expect(ok).toBe(true);
  });

  it('throws when no entry belongs to the smart account', async () => {
    const txXdr = wrapInTx([makeEntry(OTHER_CONTRACT, '5')]);
    await expect(
      signAuthEntriesWithPasskey({
        txXdr,
        networkPassphrase: PASSPHRASE,
        smartAccountId: SMART_ACCOUNT,
        rpId: 'lantern.test',
        credentialId: CREDENTIAL_ID,
        signatureExpirationLedger: EXPIRATION,
        credentials: fakeAuthenticator(),
      }),
    ).rejects.toThrow(/No authorization entry/);
  });

  it('rejects an authenticator that signed a different challenge', async () => {
    const txXdr = wrapInTx([makeEntry(SMART_ACCOUNT, '6')]);
    await expect(
      signAuthEntriesWithPasskey({
        txXdr,
        networkPassphrase: PASSPHRASE,
        smartAccountId: SMART_ACCOUNT,
        rpId: 'lantern.test',
        credentialId: CREDENTIAL_ID,
        signatureExpirationLedger: EXPIRATION,
        credentials: fakeAuthenticator({ wrongChallenge: new Uint8Array(32).fill(9) }),
      }),
    ).rejects.toThrow(/different challenge/);
  });
});
