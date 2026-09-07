// Passkey smart account (#53, Milestone 2b of #23): a Soroban custom account
// whose sole signer is a WebAuthn passkey (NIST P-256 / secp256r1). The account
// is seed-phrase-free — there is no Ed25519 key at all. Authorization is a
// WebAuthn *assertion*: the authenticator signs
// `authenticator_data ‖ SHA-256(client_data_json)`, and the payload we actually
// authorize (Soroban's 32-byte signature payload hash) rides inside
// `client_data_json` as the base64url `"challenge"` field.
//
// `__check_auth` therefore verifies two things:
//   1. the P-256 signature over the reconstructed WebAuthn message, against the
//      public key bound at construction (secp256r1_verify traps on failure);
//   2. that the clientDataJSON's challenge IS this auth entry's payload —
//      otherwise a valid assertion over some other payload could be replayed.
//
// Kept deliberately minimal for the MVP: one signer, bound once in the
// constructor. Signer rotation / guardian co-signers are the documented
// follow-up (see docs/passkey-smart-account.md).

#![no_std]
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    symbol_short, Bytes, BytesN, Env, Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    ClientDataTooLong = 2,
    ChallengeNotFound = 3,
    ChallengeMismatch = 4,
}

/// The WebAuthn assertion pieces the wallet submits as the auth-entry
/// signature. Field names/order must match the wallet's ScVal map
/// (`passkeySignatureScVal` in core/passkey/authEntry.ts).
#[contracttype]
#[derive(Clone)]
pub struct Signature {
    pub authenticator_data: Bytes,
    pub client_data_json: Bytes,
    pub signature: BytesN<64>,
}

const PK: Symbol = symbol_short!("pk");
const MAX_CLIENT_DATA: usize = 1024;
const B64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// 32 bytes -> the 43-char unpadded base64url string WebAuthn uses for the
// challenge (32 = 10 whole 3-byte groups + 2 remainder bytes -> 40 + 3 chars).
fn base64url_43(src: &[u8; 32]) -> [u8; 43] {
    let mut out = [0u8; 43];
    let (mut i, mut o) = (0usize, 0usize);
    while i + 3 <= 32 {
        let n = ((src[i] as u32) << 16) | ((src[i + 1] as u32) << 8) | (src[i + 2] as u32);
        out[o] = B64URL[(n >> 18) as usize & 63];
        out[o + 1] = B64URL[(n >> 12) as usize & 63];
        out[o + 2] = B64URL[(n >> 6) as usize & 63];
        out[o + 3] = B64URL[n as usize & 63];
        i += 3;
        o += 4;
    }
    let n = ((src[30] as u32) << 16) | ((src[31] as u32) << 8);
    out[40] = B64URL[(n >> 18) as usize & 63];
    out[41] = B64URL[(n >> 12) as usize & 63];
    out[42] = B64URL[(n >> 6) as usize & 63];
    out
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[contract]
pub struct PasskeyAccount;

#[contractimpl]
impl PasskeyAccount {
    /// Bind the passkey's 65-byte uncompressed SEC1 public key as THE signer.
    /// Runs once at deploy (CreateContractV2 constructor args).
    pub fn __constructor(env: Env, public_key: BytesN<65>) {
        env.storage().instance().set(&PK, &public_key);
    }
}

#[contractimpl]
impl CustomAccountInterface for PasskeyAccount {
    type Error = Error;
    type Signature = Signature;

    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        sig: Signature,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let pk: BytesN<65> = env
            .storage()
            .instance()
            .get(&PK)
            .ok_or(Error::NotInitialized)?;

        // The authenticator signs authenticator_data ‖ SHA-256(client_data_json).
        // secp256r1_verify traps on a bad signature, which fails the auth.
        let client_data_hash = env.crypto().sha256(&sig.client_data_json);
        let mut message = sig.authenticator_data.clone();
        message.append(&Bytes::from_array(&env, &client_data_hash.to_array()));
        let digest = env.crypto().sha256(&message);
        env.crypto().secp256r1_verify(&pk, &digest, &sig.signature);

        // The signed challenge must be exactly base64url(signature_payload).
        let len = sig.client_data_json.len() as usize;
        if len > MAX_CLIENT_DATA {
            return Err(Error::ClientDataTooLong);
        }
        let mut buf = [0u8; MAX_CLIENT_DATA];
        sig.client_data_json.copy_into_slice(&mut buf[..len]);
        let expected = base64url_43(&signature_payload.to_array());
        let marker = b"\"challenge\":\"";
        let pos = find(&buf[..len], marker).ok_or(Error::ChallengeNotFound)?;
        let start = pos + marker.len();
        if start + 43 >= len || buf[start..start + 43] != expected || buf[start + 43] != b'"' {
            return Err(Error::ChallengeMismatch);
        }
        Ok(())
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use p256::ecdsa::signature::hazmat::PrehashSigner;
    use p256::ecdsa::SigningKey;
    use sha2::{Digest, Sha256};
    use soroban_sdk::{vec, Address, IntoVal};
    use std::format;
    use std::string::String;
    use std::vec::Vec as StdVec;

    fn sha256(data: &[u8]) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(data);
        h.finalize().into()
    }

    fn b64url(payload: &[u8; 32]) -> String {
        base64url_43(payload).iter().map(|b| *b as char).collect()
    }

    struct TestKey {
        signing: SigningKey,
        sec1: [u8; 65],
    }

    fn test_key() -> TestKey {
        // Deterministic test key — any nonzero scalar below the group order.
        let secret: [u8; 32] = [
            0x1f, 0x2e, 0x3d, 0x4c, 0x5b, 0x6a, 0x79, 0x88, 0x97, 0xa6, 0xb5, 0xc4, 0xd3, 0xe2,
            0xf1, 0x01, 0x10, 0x2f, 0x3e, 0x4d, 0x5c, 0x6b, 0x7a, 0x89, 0x98, 0xa7, 0xb6, 0xc5,
            0xd4, 0xe3, 0xf2, 0x02,
        ];
        let signing = SigningKey::from_slice(&secret).unwrap();
        let point = signing.verifying_key().to_encoded_point(false);
        let mut sec1 = [0u8; 65];
        sec1.copy_from_slice(point.as_bytes());
        TestKey { signing, sec1 }
    }

    /// A well-formed WebAuthn assertion over `challenge_payload`, signed by `key`.
    fn assertion(env: &Env, key: &TestKey, challenge_payload: &[u8; 32]) -> Signature {
        // authenticatorData: rpIdHash(32) ‖ flags(1, UP|UV) ‖ signCount(4).
        let mut auth_data = [0u8; 37];
        auth_data[..32].copy_from_slice(&sha256(b"lantern.test"));
        auth_data[32] = 0x05;
        let client_data = format!(
            "{{\"type\":\"webauthn.get\",\"challenge\":\"{}\",\"origin\":\"https://lantern.test\"}}",
            b64url(challenge_payload)
        );
        sign_over(env, key, &auth_data, client_data.as_bytes())
    }

    fn sign_over(env: &Env, key: &TestKey, auth_data: &[u8], client_data: &[u8]) -> Signature {
        let mut message: StdVec<u8> = StdVec::new();
        message.extend_from_slice(auth_data);
        message.extend_from_slice(&sha256(client_data));
        let digest = sha256(&message);
        let sig: p256::ecdsa::Signature = key.signing.sign_prehash(&digest).unwrap();
        let sig = sig.normalize_s().unwrap_or(sig);
        let mut raw = [0u8; 64];
        raw.copy_from_slice(&sig.to_bytes());
        Signature {
            authenticator_data: Bytes::from_slice(env, auth_data),
            client_data_json: Bytes::from_slice(env, client_data),
            signature: BytesN::from_array(env, &raw),
        }
    }

    fn setup() -> (Env, Address, TestKey) {
        let env = Env::default();
        let key = test_key();
        let id = env.register(PasskeyAccount, (BytesN::from_array(&env, &key.sec1),));
        (env, id, key)
    }

    fn check_auth(
        env: &Env,
        id: &Address,
        payload: &[u8; 32],
        sig: &Signature,
    ) -> Result<(), soroban_sdk::Error> {
        env.try_invoke_contract_check_auth::<Error>(
            id,
            &BytesN::from_array(env, payload),
            sig.clone().into_val(env),
            &vec![env],
        )
        .map_err(|e| match e {
            Ok(contract_err) => contract_err.into(),
            Err(invoke_err) => std::panic!("unexpected invoke error: {:?}", invoke_err),
        })
    }

    #[test]
    fn accepts_a_valid_assertion() {
        let (env, id, key) = setup();
        let payload = sha256(b"the soroban signature payload");
        let sig = assertion(&env, &key, &payload);
        assert!(check_auth(&env, &id, &payload, &sig).is_ok());
    }

    #[test]
    fn rejects_challenge_for_a_different_payload() {
        let (env, id, key) = setup();
        let signed_over = sha256(b"payload A");
        let asked_for = sha256(b"payload B");
        // Valid signature — but over payload A while the entry needs payload B.
        let sig = assertion(&env, &key, &signed_over);
        // The P-256 signature itself is fine, so verification reaches the
        // challenge comparison and must fail there.
        let res = env.try_invoke_contract_check_auth::<Error>(
            &id,
            &BytesN::from_array(&env, &asked_for),
            sig.into_val(&env),
            &vec![&env],
        );
        assert_eq!(res.err().unwrap().ok().unwrap(), Error::ChallengeMismatch);
    }

    #[test]
    fn rejects_client_data_without_a_challenge() {
        let (env, id, key) = setup();
        let payload = sha256(b"payload");
        let mut auth_data = [0u8; 37];
        auth_data[..32].copy_from_slice(&sha256(b"lantern.test"));
        auth_data[32] = 0x05;
        let client_data = b"{\"type\":\"webauthn.get\",\"origin\":\"https://lantern.test\"}";
        let sig = sign_over(&env, &key, &auth_data, client_data);
        let res = env.try_invoke_contract_check_auth::<Error>(
            &id,
            &BytesN::from_array(&env, &payload),
            sig.into_val(&env),
            &vec![&env],
        );
        assert_eq!(res.err().unwrap().ok().unwrap(), Error::ChallengeNotFound);
    }

    #[test]
    fn rejects_a_tampered_signature() {
        let (env, id, key) = setup();
        let payload = sha256(b"payload");
        let mut sig = assertion(&env, &key, &payload);
        let mut raw = sig.signature.to_array();
        raw[10] ^= 0xff;
        sig.signature = BytesN::from_array(&env, &raw);
        let res = env.try_invoke_contract_check_auth::<Error>(
            &id,
            &BytesN::from_array(&env, &payload),
            sig.into_val(&env),
            &vec![&env],
        );
        assert!(res.is_err());
    }

    #[test]
    fn rejects_an_assertion_signed_by_another_key() {
        let (env, id, _key) = setup();
        let other = {
            let secret = [0x42u8; 32];
            let signing = SigningKey::from_slice(&secret).unwrap();
            let point = signing.verifying_key().to_encoded_point(false);
            let mut sec1 = [0u8; 65];
            sec1.copy_from_slice(point.as_bytes());
            TestKey { signing, sec1 }
        };
        let payload = sha256(b"payload");
        let sig = assertion(&env, &other, &payload);
        let res = env.try_invoke_contract_check_auth::<Error>(
            &id,
            &BytesN::from_array(&env, &payload),
            sig.into_val(&env),
            &vec![&env],
        );
        assert!(res.is_err());
    }
}
