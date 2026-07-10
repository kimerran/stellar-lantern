# Passkey Smart Account (#53 — finish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish #53 — a seed-phrase-free Stellar account whose signing key is a device passkey, verified on-chain by a Soroban secp256r1 smart-account contract, wired through the existing scan → approve → sign pipeline with no-mnemonic onboarding.

**Architecture:** A minimal Rust custom-account contract (`__check_auth` verifies a WebAuthn assertion via the protocol-21 `secp256r1_verify` host fn) is compiled to WASM, vendored as base64 in `src/core/passkey/contractWasm.ts`, and deployed per-user via `Operation.createCustomContract` with the passkey's 65-byte SEC1 public key as constructor arg. TypeScript core modules (deploy/bind, auth-entry passkey signing, SAC transfer orchestration) follow the repo's injectable-`fetch`/injectable-`CredentialsApi` pattern so everything is unit-testable offline; a live-testnet E2E script with a **fake WebCrypto authenticator** proves the whole chain on-chain without a physical device. UI: a flag-gated passkey onboarding path (no mnemonic ever) + a SmartAccount screen (balance + send XLM through scan → review → passkey-sign → SUBMIT_ONLY). Fees are paid by an **ephemeral friendbot-funded testnet keypair** held only in popup memory (mainnet fee sponsorship = documented follow-up).

**Tech Stack:** soroban-sdk 27 (Rust, wasm32v1-none, stellar CLI 26), @stellar/stellar-sdk 16.0.1 (low-level `xdr`/`Operation` builders — no `rpc.Server`/`contract` module, per repo convention), Vitest, React 18.

## Global Constraints

- Never log/persist/transmit secret material. The passkey record persisted (`contractId`, `credentialId`, `publicKey`, `rpId`) is all public. The ephemeral fee keypair is testnet-only, friendbot-funded, popup-memory only.
- TypeScript strict; core/ stays free of React and Chrome APIs; injectable `fetchImpl?: typeof fetch` and `CredentialsApi` for all network/device seams.
- Feature-flagged: `__FEATURE_PASSKEY__` / `VITE_FEATURE_PASSKEY` (default **false**), following `flag-defs.ts` + `feature-flags.d.ts` + `vite.flags.ts` conventions. Testnet only (`network.friendbotUrl` required).
- Every exported core function gets a Vitest happy-path + failure-path test. `npm run typecheck && npm run lint && npm run test` green at every commit.
- Commit as `Artisan Team <team@artisan.xyz>`, no co-author trailer. Branch off `develop`; PR targets `develop`; say "part of #53"; close #53 manually after verifying acceptance criteria.
- Scan pipeline is not bypassed: the passkey send flow runs `scan()` on the assembled XDR and gates on the verdict exactly like `Send.tsx`.

---

### Task 1: `passkey` feature flag

**Files:**
- Modify: `src/shared/flag-defs.ts` (add key to `FLAG_DEFS`)
- Modify: `src/feature-flags.d.ts` (declare `__FEATURE_PASSKEY__`)
- Test: existing `tests/flags.test.ts` / `tests/flag-defines.test.ts` (table-driven — they iterate `FLAG_DEFS`, so no new test file)

**Interfaces:**
- Produces: `FLAGS.passkey: boolean`, build literal `__FEATURE_PASSKEY__`.

- [x] Step 1: add to `FLAG_DEFS` (mirror `biometricUnlock`, default `false`):

```ts
passkey: { envVar: 'VITE_FEATURE_PASSKEY', literal: '__FEATURE_PASSKEY__', default: false },
```

- [x] Step 2: add to `src/feature-flags.d.ts`:

```ts
declare const __FEATURE_PASSKEY__: boolean;
```

- [x] Step 3: `npm run typecheck && npm run test` → PASS (flag tests are generated from `FLAG_DEFS`).
- [x] Step 4: commit `feat: add passkey feature flag (part of #53)`.

---

### Task 2: Soroban passkey smart-account contract (Rust) + vendored WASM

**Files:**
- Create: `contracts/passkey-account/Cargo.toml`, `contracts/passkey-account/src/lib.rs`
- Create: `scripts/build-passkey-contract.sh` (build + optimize + generate the TS module)
- Create (generated, committed): `src/core/passkey/contractWasm.ts`, `contracts/passkey-account/passkey_account.wasm`
- Test: Rust `#[cfg(test)]` in `lib.rs`; TS `tests/passkey-contract-wasm.test.ts`

**Interfaces:**
- Produces: contract `__constructor(public_key: BytesN<65>)`; `__check_auth(signature_payload, sig: Signature { authenticator_data: Bytes, client_data_json: Bytes, signature: BytesN<64> }, ..)`; TS exports `PASSKEY_ACCOUNT_WASM_BASE64: string`, `PASSKEY_ACCOUNT_WASM_HASH_HEX: string`.

- [ ] Step 1: `contracts/passkey-account/Cargo.toml`:

```toml
[package]
name = "passkey-account"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib", "rlib"]
doctest = false

[dependencies]
soroban-sdk = "27"

[dev-dependencies]
soroban-sdk = { version = "27", features = ["testutils"] }
p256 = { version = "0.13", features = ["ecdsa"] }

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
```

- [ ] Step 2: `src/lib.rs` — the contract. `__check_auth` (a) verifies the P-256 signature over `authenticator_data ‖ SHA-256(client_data_json)` against the bound key, (b) confirms the base64url of the 32-byte signature payload is the `"challenge"` value inside `client_data_json` (exactly 43 chars, closing quote checked):

```rust
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

// 32 bytes -> 43-char unpadded base64url (WebAuthn challenge encoding).
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
    pub fn __constructor(env: Env, public_key: BytesN<65>) {
        env.storage().instance().set(&PK, &public_key);
    }
}

#[contractimpl]
impl CustomAccountInterface for PasskeyAccount {
    type Error = Error;
    type Signature = Signature;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        sig: Signature,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let pk: BytesN<65> = env.storage().instance().get(&PK).ok_or(Error::NotInitialized)?;

        // The authenticator signs authenticator_data ‖ SHA-256(client_data_json).
        // secp256r1_verify traps on a bad signature, failing the auth.
        let client_data_hash = env.crypto().sha256(&sig.client_data_json);
        let mut message = sig.authenticator_data.clone();
        message.append(&Bytes::from_array(&env, &client_data_hash.to_array()));
        let digest = env.crypto().sha256(&message);
        env.crypto().secp256r1_verify(&pk, &digest, &sig.signature);

        // The signed payload must be THIS auth entry's challenge, or a valid
        // assertion over some other payload could be replayed here.
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
```

- [ ] Step 3: Rust tests in `lib.rs` (`#[cfg(test)] mod test`) using `env.try_invoke_contract_check_auth` and a real `p256` signing key (low-S normalized). Cases: valid assertion → `Ok`; challenge for a different payload → `ChallengeMismatch`; clientDataJSON without a challenge → `ChallengeNotFound`; tampered signature → verify trap (assert `is_err`).

```rust
#[cfg(test)]
mod test {
    use super::*;
    use p256::ecdsa::{signature::hazmat::PrehashSigner, Signature as P256Sig, SigningKey};
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    use sha2::{Digest, Sha256};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{vec, xdr::ToXdr, Address, IntoVal};

    fn sha256(data: &[u8]) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(data);
        h.finalize().into()
    }

    fn client_data_for(payload: &[u8; 32]) -> alloc_vec::Vec<u8> { /* build JSON with base64url challenge */ }
    // ... (full test bodies written at implementation time following this shape:
    //  1. Env::default(); let id = env.register(PasskeyAccount, (BytesN::from_array(&env, &pk_sec1),));
    //  2. build clientDataJSON embedding base64url_43(payload)
    //  3. message = authenticator_data ‖ sha256(client_data_json); digest = sha256(message)
    //  4. sig = SigningKey::sign_prehash(digest), normalize_s()
    //  5. env.try_invoke_contract_check_auth::<Error>(&id, &BytesN::from_array(&env, &payload), sig_struct.into_val(&env), &vec![&env]) )
}
```

(NOTE for implementer: `sha2` is pulled in transitively by `p256`; add it to dev-dependencies explicitly. `no_std` test code may use `extern crate std` inside `#[cfg(test)]`.)

- [ ] Step 4: `cargo test` in `contracts/passkey-account` → PASS.
- [ ] Step 5: `scripts/build-passkey-contract.sh`:

```bash
#!/usr/bin/env bash
# Build the passkey-account contract and vendor the WASM into src/core/passkey/contractWasm.ts.
# Requires: rustup target wasm32v1-none, stellar CLI. Run from repo root.
set -euo pipefail
cd "$(dirname "$0")/.."
(cd contracts/passkey-account && stellar contract build)
WASM=contracts/passkey-account/target/wasm32v1-none/release/passkey_account.wasm
cp "$WASM" contracts/passkey-account/passkey_account.wasm
node scripts/gen-contract-wasm-module.mjs contracts/passkey-account/passkey_account.wasm src/core/passkey/contractWasm.ts
echo "OK: $(wc -c < contracts/passkey-account/passkey_account.wasm) bytes"
```

plus `scripts/gen-contract-wasm-module.mjs` (reads wasm, writes TS module with base64 + sha256 hex + a header comment saying it is generated).

- [ ] Step 6: run the build script; commit contract, wasm, generated TS.
- [ ] Step 7: `tests/passkey-contract-wasm.test.ts`: base64 decodes to a WASM magic header (`\0asm`), sha256(base64-decoded) === `PASSKEY_ACCOUNT_WASM_HASH_HEX`, hash is 64 hex chars.
- [ ] Step 8: `npm run test` → PASS. Commit `feat: soroban passkey smart-account contract + vendored wasm (part of #53)`.

---

### Task 3: low-S signature normalization (`src/core/passkey/secp256r1.ts` addition)

WebAuthn authenticators may return high-S ECDSA signatures; normalize to low-S before on-chain verification (harmless if the host accepts both, required if it enforces low-S).

**Files:**
- Modify: `src/core/passkey/secp256r1.ts`
- Test: `tests/passkey-secp256r1.test.ts` (append)

**Interfaces:**
- Produces: `normalizeLowS(rawSig: Uint8Array): Uint8Array` (64-byte in/out; returns input unchanged when already low-S).

- [ ] Step 1: failing test — construct a signature with `s > n/2`, expect `normalizeLowS` returns `n - s`; a low-S signature returns identical bytes; wrong length throws `PasskeyFormatError`. Also: a real WebCrypto signature, forced high-S (`s' = n - s`), still verifies after normalization.
- [ ] Step 2: implement with the P-256 group order:

```ts
// P-256 group order n and n/2, for low-S signature normalization.
const P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const P256_HALF_N = P256_N >> 1n;

/** Normalize a raw 64-byte r‖s ECDSA signature to its canonical low-S form. */
export function normalizeLowS(rawSig: Uint8Array): Uint8Array {
  if (rawSig.length !== P256_SIGNATURE_BYTES) {
    throw new PasskeyFormatError('Signature must be 64 bytes of r‖s.');
  }
  let s = 0n;
  for (let i = 32; i < 64; i++) s = (s << 8n) | BigInt(rawSig[i]!);
  if (s <= P256_HALF_N) return rawSig;
  let flipped = P256_N - s;
  const out = rawSig.slice();
  for (let i = 63; i >= 32; i--) {
    out[i] = Number(flipped & 0xffn);
    flipped >>= 8n;
  }
  return out;
}
```

- [ ] Step 3: tests pass; commit `feat: low-S normalization for passkey signatures (part of #53)`.

---

### Task 4: deploy/bind builders (`src/core/passkey/smartAccount.ts`)

**Files:**
- Create: `src/core/passkey/smartAccount.ts`
- Test: `tests/passkey-smart-account.test.ts`

**Interfaces:**
- Consumes: `PASSKEY_ACCOUNT_WASM_BASE64/HASH_HEX` (Task 2).
- Produces:
  - `buildUploadWasmXdr({ sourceAccount, sourceSequence, wasmBase64, networkPassphrase, fee?, timeoutSecs? }): string`
  - `passkeySalt(credentialId: Uint8Array): Buffer` (= sha256)
  - `buildCreatePasskeyAccountXdr({ sourceAccount, sourceSequence, wasmHashHex, publicKey: Uint8Array(65), salt: Buffer, networkPassphrase, fee?, timeoutSecs? }): string` (createCustomContract + constructorArgs [scvBytes(publicKey)])
  - `predictPasskeyAccountId({ deployer, salt, networkPassphrase }): string` (C… via HashIdPreimage envelopeTypeContractId)

Implementation sketch (full code in module):

```ts
export function predictPasskeyAccountId(p: { deployer: string; salt: Buffer; networkPassphrase: string }): string {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(p.networkPassphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: new Address(p.deployer).toScAddress(),
          salt: p.salt,
        }),
      ),
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}
```

- [ ] Tests: upload XDR decodes to `invokeHostFunction` with `hostFunctionTypeUploadContractWasm` and the exact wasm bytes; create XDR decodes to `createContractV2` with our wasm hash + 65-byte constructor arg + salt; bad public key length / bad hash hex / bad G address rejected; `predictPasskeyAccountId` returns a valid `C…` (`StrKey.isValidContract`) and is deterministic + changes with salt.
- [ ] Commit `feat: passkey smart-account deploy builders (part of #53)`.

---

### Task 5: auth-entry passkey signing (`src/core/passkey/authEntry.ts`)

**Files:**
- Create: `src/core/passkey/authEntry.ts`
- Test: `tests/passkey-auth-entry.test.ts`

**Interfaces:**
- Consumes: `signWithPasskey`, `CredentialsApi`, `PasskeyAssertion` (webauthn.ts); `challengeMatches` (assertion.ts); `normalizeLowS` (Task 3).
- Produces:
  - `authEntryPayloadHash(entry: xdr.SorobanAuthorizationEntry, networkPassphrase: string): Uint8Array` — sha256 of `HashIdPreimage.envelopeTypeSorobanAuthorization` (nonce + expiration read from the entry).
  - `passkeySignatureScVal(assertion: PasskeyAssertion): xdr.ScVal` — scvMap with keys in ascending order `authenticator_data`, `client_data_json`, `signature` (matches the contract's `Signature` struct).
  - `signAuthEntriesWithPasskey(params: { txXdr, networkPassphrase, smartAccountId, rpId, credentialId, signatureExpirationLedger, credentials? }): Promise<{ xdr: string; signed: number }>` — mutates the envelope in place via `xdr.TransactionEnvelope.fromXDR`: for each address-credential auth entry whose address is `smartAccountId`, sets `signatureExpirationLedger`, computes the payload hash, calls `signWithPasskey` with it as challenge, verifies `challengeMatches`, normalizes low-S, attaches `passkeySignatureScVal`. Throws if no matching entry.

- [ ] Key test (oracle): build a sample auth entry; compute our payload hash; cross-check against the SDK — call `authorizeEntry(entry, async (preimage) => {...capture hash(preimage)...}, ledger, passphrase)` and assert the captured signed hash equals ours. Other tests: signature ScVal map key order; expiration ledger set on the output entry; fake `CredentialsApi` end-to-end (assertion's clientDataJSON challenge round-trips); entry for a different address left untouched; no-match throws.
- [ ] Commit `feat: passkey signing of soroban auth entries (part of #53)`.

---

### Task 6: SAC balance + ledger-entry read (`src/core/stellar/sac.ts`, `soroban.ts` addition)

**Files:**
- Create: `src/core/stellar/sac.ts`
- Modify: `src/core/stellar/soroban.ts` (add `getLedgerEntries`)
- Test: `tests/sac.test.ts`, `tests/soroban.test.ts` (append)

**Interfaces:**
- Produces:
  - `getLedgerEntries(keysXdr: string[], opts: SimulateOptions): Promise<{ ok: true; entries: { keyXdr: string; xdr: string }[] } | { ok: false; error: string }>` (JSON-RPC `getLedgerEntries`, injectable fetch, mirrors `simulateTransaction` error normalization)
  - `nativeSacId(networkPassphrase: string): string` (= `Asset.native().contractId(passphrase)`)
  - `sacBalanceKeyXdr(sacId: string, holderContractId: string): string` (ContractData key: vec[symbol "Balance", address], persistent)
  - `sacContractBalance({ holderContractId, networkPassphrase, rpcUrl, fetchImpl? }): Promise<{ ok: true; stroops: bigint } | { ok: false; error: string }>` — reads the entry, parses the `{ amount: i128, authorized, clamped }` map, returns `0n` when the entry is absent (contract has never held XLM)
  - `buildSacTransferXdr({ sacId, from, to, amountStroops, sourceAccount, sourceSequence, networkPassphrase, fee?, timeoutSecs? }): string` — `transfer(from, to, i128 amount)` invoke where `from` may be a C… address (reuses `buildInvokeContractXdr` arg plumbing or builds ScVals directly)
- [ ] Tests with stubbed fetch fixtures (mirror `soroban.test.ts` style): balance parse for a real-shaped entry, absent entry → 0n, malformed → error; transfer XDR decodes to `transfer` with the right ScVals; `nativeSacId` returns valid C… and differs per passphrase.
- [ ] Commit `feat: SAC balance read + transfer builder (part of #53)`.

---

### Task 7: onboarding + storage record + orchestration (`src/core/passkey/onboard.ts`)

**Files:**
- Modify: `src/shared/types.ts` (add `PasskeyAccountRecord`), `src/shared/storage.ts` (get/set/clear under `lantern.passkeyAccount`)
- Create: `src/core/passkey/onboard.ts`
- Test: `tests/passkey-onboard.test.ts`

**Interfaces:**
- Produces:
  - `interface PasskeyAccountRecord { version: 1; network: 'testnet'; contractId: string; credentialId: string /* base64url */; publicKey: string /* hex */; rpId: string }`
  - `getPasskeyAccount(): Promise<PasskeyAccountRecord | null>` / `setPasskeyAccount(r)` / `clearPasskeyAccount()`
  - `createPasskeyAccount(params: { network: NetworkConfig; rpId: string; userName: string; credentials?: CredentialsApi; fetchImpl?: typeof fetch; submit: (signedXdr: string) => Promise<{ hash: string }>; onProgress?: (step: 'register'|'fund'|'upload'|'deploy') => void }): Promise<{ ok: true; record: PasskeyAccountRecord } | { ok: false; error: string }>`

Flow inside `createPasskeyAccount`: `registerPasskey` → `Keypair.random()` deployer → friendbot fund (via `network.friendbotUrl`, injectable fetch) → fetch deployer sequence (Horizon `/accounts/{id}`, injectable fetch) → upload wasm (build → `simulateTransaction` → `assembleInvokeXdr` → sign with deployer → `submit`) → `createCustomContract` same pipeline → `predictPasskeyAccountId` = returned contract id → build record. The deployer keypair never leaves function scope.

- [ ] Tests: full happy path with fake credentials + scripted fetch (friendbot hit, sequence fetch, two simulates) + recording `submit` stub → record fields correct, both submitted XDRs decode to upload/create ops signed by the deployer; friendbot failure and simulate failure surface as `{ ok: false }`; mainnet config (no friendbotUrl) rejected.
- [ ] Commit `feat: no-mnemonic passkey onboarding orchestration (part of #53)`.

---

### Task 8: transfer orchestration (`src/core/passkey/transfer.ts`)

**Files:**
- Create: `src/core/passkey/transfer.ts`
- Test: `tests/passkey-transfer.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 6; `simulateTransaction`, `assembleInvokeXdr`.
- Produces:
  - `preparePasskeyTransfer({ contractId, destination, amountStroops, feeSourceAccount, feeSourceSequence, networkPassphrase, rpcUrl, fetchImpl? }): Promise<{ ok: true; xdr: string; latestLedger: number } | { ok: false; error: string }>` — build SAC transfer (from = smart account) → simulate → assemble with the returned (unsigned) auth entries. **This XDR is what gets scanned.**
  - `finalizePasskeyTransfer({ preparedXdr, networkPassphrase, rpcUrl, smartAccountId, rpId, credentialId, signatureExpirationLedger, credentials?, fetchImpl? }): Promise<{ ok: true; xdr: string } | { ok: false; error: string }>` — `signAuthEntriesWithPasskey` → **re-simulate** (auth now verified in enforce mode — catches a bad assertion before submit; also refreshes the footprint/fee) → `assembleInvokeXdr` keeping the signed entries. Envelope signing (fee keypair) + submit stay with the caller.
- [ ] Tests: scripted two-simulate fetch; prepared XDR carries the unsigned auth entry; finalize output carries the signed entry (signature scvMap present) and the *second* simulation's fee; a failed re-simulation (contract rejects the assertion) → `{ ok: false }` with the RPC error text.
- [ ] Commit `feat: passkey transfer prepare/finalize pipeline (part of #53)`.

---

### Task 9: live testnet E2E (`scripts/passkey-e2e.mjs`) — the acceptance gate

**Files:**
- Create: `scripts/passkey-e2e.mjs` (run with `node`; plain ESM importing built core via `tsx` — use `npx tsx scripts/passkey-e2e.ts` if TS)

**What it proves on-chain (no physical device):** a fake authenticator (WebCrypto P-256, DER-signing, same shape as `tests/passkey-webauthn.test.ts`'s fake) drives the REAL testnet: register → friendbot-fund deployer → upload vendored wasm → deploy smart account with constructor → fund smart account with XLM via SAC transfer from deployer → **send XLM back out of the smart account authorized by a passkey assertion** (prepare → finalize → envelope-sign → Horizon submit) → assert tx success + balance moved. Also one negative: an assertion over a wrong challenge fails re-simulation.

- [ ] Write script; run `npx tsx scripts/passkey-e2e.ts` against live testnet; paste tx hashes into the PR/issue comment.
- [ ] Commit `test: live-testnet passkey smart-account e2e script (part of #53)`.

---

### Task 10: PasskeyOnboarding UI + App wiring

**Files:**
- Create: `src/popup/screens/PasskeyOnboarding.tsx`
- Modify: `src/popup/screens/Onboarding.tsx` (Welcome gets a flag-gated third button; new step `'passkey'`)
- Modify: `src/popup/App.tsx` (if `__FEATURE_PASSKEY__` and a `PasskeyAccountRecord` exists → render `SmartAccount` before the vault checks)
- Create: `src/popup/hooks/usePasskeyAccount.ts` (load record from storage; `refresh`)

Behavior: button "Create with a passkey" (subtitle "Testnet · no seed phrase") shown only when `__FEATURE_PASSKEY__ && !isNativePlatform()`. The flow screen shows progress steps (Register → Fund → Deploy), calls `createPasskeyAccount` with `rpId = window.location.hostname`, `submit` = `sendMessage({ type: 'SUBMIT_ONLY', ... })`, persists the record, calls `onDone`. No mnemonic is ever generated or displayed on this path.

- [ ] Implement; `npm run typecheck && npm run lint && npm run build` pass; flag-off build contains no passkey strings (`npm run verify:flags` if wired).
- [ ] Commit `feat: passkey onboarding UI, no mnemonic (part of #53)`.

---

### Task 11: SmartAccount screen (balance + send through scan → approve → passkey-sign)

**Files:**
- Create: `src/popup/screens/SmartAccount.tsx`
- Test: core logic already covered; screen is manual-tested (extension + `npm run dev`)

Behavior:
- Header: passkey badge, truncated `C…` address, copy button, network badge (testnet).
- Balance: `sacContractBalance` on mount + refresh.
- Send XLM: destination (G… or C…, validated), amount → get/reuse popup-session fee source (`Keypair.random()` + friendbot, cached in module scope) → `preparePasskeyTransfer` → **`scan({ xdr, networkPassphrase, context })`** → review card with `ScanBadge`/`RiskCallout`; `block_confirm` verdicts require typed CONFIRM (reuse Send.tsx pattern) → on approve: `finalizePasskeyTransfer` (this triggers the passkey prompt) → sign envelope with fee keypair → `SUBMIT_ONLY` → toast with hash, refresh balance.
- Footer: "Forget this account" (clears record after confirm; the on-chain account persists).

- [ ] Implement; typecheck/lint/build/test green; manual smoke via `npm run dev` (fake-authenticator path can be exercised by temporarily injecting the fake in a dev console if no device available — the live proof is Task 9).
- [ ] Commit `feat: smart-account screen with scanned passkey send (part of #53)`.

---

### Task 12: docs + verification + PR + issue close-out

**Files:**
- Create: `docs/passkey-smart-account.md` — architecture, tx flows, fee-source story (testnet friendbot now, Launchtube/sponsorship for mainnet as follow-up), rpId/platform caveats (extension origin, native hidden), instance-TTL note, and the **guardian recovery interop** section required by #53: single passkey signer today; recovery = adding guardian signers/rotation entrypoint to the contract (follow-up), contrast with #23 M1 classic-account native multisig.
- Modify: `docs/features.md` (new entry), `README.md` flags table if present.

- [ ] `npm run typecheck && npm run lint && npm run test` + `cargo test` + rerun Task 9 e2e → all green (verification-before-completion).
- [ ] Push branch, open PR → `develop`, body lists acceptance-criteria mapping + testnet tx hashes.
- [ ] After merge: comment on #53 mapping every checkbox to code/tests/tx hashes; close #53; verify #23's 2b reference doesn't auto-close anything.

---

## Self-review notes

- Spec coverage: #53 checkboxes → register+derive (done pre-plan), deploy/bind (Tasks 2/4/7), passkey-signed ops through scan→approve→sign with no bypass (Tasks 5/8/11), no-mnemonic onboarding (Tasks 7/10), guardian interop documented (Task 12). Hard dep #21 satisfied (invoke builder shipped).
- Types consistent: `PasskeyAssertion` from webauthn.ts flows into `passkeySignatureScVal`; `Signature` struct field order matches scvMap key order; `PasskeyAccountRecord` produced in Task 7 and consumed in Tasks 10/11.
- Known judgment calls (documented in Task 12): ephemeral popup-memory fee keypair (testnet-only), always-upload wasm (idempotent), real-device WebAuthn validated on-device like the prior #53 slices (CI uses fakes; on-chain truth via Task 9 fake-authenticator e2e).
