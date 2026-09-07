// On-chain blacklist registry (#31, Deliverable 1): a shared, composable list
// of addresses reported as malicious, that any Stellar wallet can read.
// Lantern's scanner screens recipients against a hardcoded demo deny-list
// (`DEMO_FLAGGED_ADDRESSES` in src/core/scan/engine.ts); this contract is what
// replaces it — report once, protect everyone.
//
// Two properties shape the design:
//
//   1. **Writes are fee-gated.** Reporting costs `Config::fee` of a configured
//      token, routed to `Config::treasury`. That is the anti-abuse mechanism
//      (spamming the registry costs money) and it funds the scanner's AI
//      inference. `report()` lands in #32.
//   2. **Minimal on-chain data.** An entry carries a reason from a small closed
//      set plus a 32-byte hash of the off-chain evidence — never the evidence
//      itself. The reporter is recorded for attribution, so the signal can be
//      weighted rather than treated as an auto-block.
//
// This slice is the skeleton only: types, storage schema, TTL helpers and the
// constructor. The write path is #32, admin status transitions are #33, and the
// public read API (`is_flagged`, `get`, `count`, `list`) is #34.

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, BytesN, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    InvalidFee = 1,   // fee < 0
    SelfReport = 2,   // reporter == subject
    NotFound = 3,     // no entry for that subject
    InvalidLimit = 4, // list(): limit == 0 or > MAX_PAGE
}

/// Lifecycle of a registry entry. Only `Active` makes `is_flagged` true —
/// a disputed or revoked entry stays on-chain for auditability but stops
/// producing a warning in wallets.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Status {
    Active,
    Disputed,
    Revoked,
}

/// Why an address was reported. Deliberately a small closed set: minimal
/// on-chain data, with the detail carried by the off-chain `evidence` hash.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Reason {
    Scam,
    Phishing,
    Drainer,
    Poisoning,
    Mixer,
    Other,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Entry {
    pub subject: Address,  // the flagged address
    pub reporter: Address, // most recent reporter (attribution)
    pub reason: Reason,
    pub evidence: BytesN<32>, // sha256 of off-chain evidence; all-zero = none
    pub reported_at: u64,     // ledger timestamp of the FIRST report
    pub updated_at: u64,      // ledger timestamp of the last write
    pub status: Status,
    pub reports: u32, // how many times this subject has been reported
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,     // may change status + config
    pub treasury: Address,  // receives every write fee
    pub fee_token: Address, // SAC used to pay the fee (native XLM SAC on testnet)
    pub fee: i128,          // stroops per report; 0 is legal (free writes)
}

#[contracttype]
pub enum DataKey {
    Config,         // instance
    Count,          // instance: u32, number of distinct subjects
    Entry(Address), // persistent
    Index(u32),     // persistent: insertion-ordered subject list, 0-based
}

// TTL bumps. Soroban expires storage that nobody touches; a registry that
// silently forgets its entries is worse than no registry, so every read and
// write extends the entry it touched (and the instance) by ~60 days whenever
// it has less than ~30 days left.
const LEDGERS_PER_DAY: u32 = 17_280; // ~5s ledgers
const BUMP_THRESHOLD: u32 = LEDGERS_PER_DAY * 30;
const BUMP_AMOUNT: u32 = LEDGERS_PER_DAY * 60;

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}

// Used by every entry read/write from #32 onward; the constructor writes no
// entries, so it is unreferenced in this slice.
#[allow(dead_code)]
fn bump_entry(env: &Env, subject: &Address) {
    env.storage().persistent().extend_ttl(
        &DataKey::Entry(subject.clone()),
        BUMP_THRESHOLD,
        BUMP_AMOUNT,
    );
}

#[contract]
pub struct BlacklistRegistry;

#[contractimpl]
impl BlacklistRegistry {
    /// Bind the registry's admin, treasury and fee schedule at deploy time.
    ///
    /// No `require_auth`: the constructor runs as part of the deploy, so its
    /// caller is by definition the deployer.
    pub fn __constructor(
        env: Env,
        admin: Address,
        treasury: Address,
        fee_token: Address,
        fee: i128,
    ) {
        if fee < 0 {
            panic_with_error!(&env, Error::InvalidFee);
        }
        let config = Config {
            admin,
            treasury,
            fee_token,
            fee,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::Count, &0u32);
        bump_instance(&env);
    }
}

#[cfg(test)]
mod test;
