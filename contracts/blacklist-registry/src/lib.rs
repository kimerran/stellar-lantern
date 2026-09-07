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
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short,
    token::TokenClient, Address, BytesN, Env,
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

    /// Report `subject` as malicious. Charges `config.fee` of `config.fee_token`
    /// from `reporter` to `config.treasury` — the fee is what makes spamming the
    /// registry expensive, and it funds the scanner's inference costs.
    /// Returns the subject's new total report count.
    pub fn report(
        env: Env,
        reporter: Address,
        subject: Address,
        reason: Reason,
        evidence: BytesN<32>,
    ) -> u32 {
        // Auth first, before any storage read or transfer: nothing about this
        // call should be observable to an unauthorized caller.
        reporter.require_auth();

        if reporter == subject {
            panic_with_error!(&env, Error::SelfReport);
        }

        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));

        // Charged on EVERY accepted report, including repeat reports of an
        // already-flagged subject — that is the anti-spam property. A zero-fee
        // config skips the transfer entirely (free writes are legal).
        if config.fee > 0 {
            TokenClient::new(&env, &config.fee_token).transfer(
                &reporter,
                &config.treasury,
                &config.fee,
            );
        }

        let now = env.ledger().timestamp();
        let key = DataKey::Entry(subject.clone());
        let existing: Option<Entry> = env.storage().persistent().get(&key);

        let entry = match existing {
            None => {
                // First report for this subject: append it to the insertion-ordered
                // index so #34's `list()` can page over subjects.
                let count: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
                env.storage()
                    .persistent()
                    .set(&DataKey::Index(count), &subject);
                env.storage().instance().set(&DataKey::Count, &(count + 1));
                Entry {
                    subject: subject.clone(),
                    reporter: reporter.clone(),
                    reason,
                    evidence,
                    reported_at: now,
                    updated_at: now,
                    status: Status::Active,
                    reports: 1,
                }
            }
            Some(prev) if prev.status == Status::Revoked => {
                // Revoked means the admin cleared it; a fresh report resurrects the
                // entry under the NEW reporter's attribution, but keeps the original
                // `reported_at` so the audit trail stays intact.
                Entry {
                    reporter: reporter.clone(),
                    reason,
                    evidence,
                    updated_at: now,
                    status: Status::Active,
                    reports: prev.reports + 1,
                    ..prev
                }
            }
            Some(prev) => {
                // Active or Disputed: count the report, but keep the FIRST reporter's
                // attribution — a later reporter can't rewrite the audit trail. A
                // disputed entry stays disputed; only the admin resolves it (#33).
                // Count and the index are untouched: the subject is already indexed.
                Entry {
                    reports: prev.reports + 1,
                    updated_at: now,
                    ..prev
                }
            }
        };

        env.storage().persistent().set(&key, &entry);
        bump_entry(&env, &subject);
        bump_instance(&env);

        // An indexer must be able to reconstruct the whole registry from events
        // alone — that is part of the evidence package, so the topic/data shape
        // is fixed by the spec. SDK 27 deprecates `publish` in favour of the
        // `#[contractevent]` macro, which derives its own topic layout; moving
        // to it would change the wire format downstream indexers key off, so
        // that is a deliberate follow-up rather than a drive-by here.
        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("report"), subject.clone()),
            (reporter, reason, entry.status, entry.reports),
        );

        entry.reports
    }
}

#[cfg(test)]
mod test;
