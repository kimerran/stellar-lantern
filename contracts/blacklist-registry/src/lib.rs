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
// The skeleton (types, storage schema, TTL helpers, constructor) is #31, the
// write path is #32, the admin surface — status transitions plus config
// changes — is #33, and the public read API (`is_flagged`, `get`, `count`,
// `list`, `config`) is #34.

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short,
    token::TokenClient, Address, BytesN, Env, Vec,
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
    pub index: u32,   // insertion position; the entry's DataKey::Index(index) key
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
/// Cap on `list()`'s page size. A caller that wants everything pages; a caller
/// that asks for the world in one call gets `InvalidLimit` rather than an
/// invocation that runs out of budget somewhere in the middle.
const MAX_PAGE: u32 = 50;

const LEDGERS_PER_DAY: u32 = 17_280; // ~5s ledgers
const BUMP_THRESHOLD: u32 = LEDGERS_PER_DAY * 30;
const BUMP_AMOUNT: u32 = LEDGERS_PER_DAY * 60;

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}

/// Extend an entry AND its insertion-index key together.
///
/// `Index(i) -> subject` is a separate persistent ledger entry from
/// `Entry(subject)`, and a newly written one starts at the network's *minimum*
/// persistent TTL (4,095 ledgers in the test env) rather than the entry's
/// ~60 days. Bumping only the entry would let the index expire underneath a
/// live subject: `Count` and `Entry(subject)` would still say the subject is
/// flagged while `list()` (#34) could no longer enumerate it. Anything that
/// keeps an entry alive keeps its index slot alive, which is why `Entry` carries
/// its own `index` — the ordinal has to be recoverable from the entry alone.
fn bump_entry(env: &Env, subject: &Address, index: u32) {
    env.storage().persistent().extend_ttl(
        &DataKey::Entry(subject.clone()),
        BUMP_THRESHOLD,
        BUMP_AMOUNT,
    );
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Index(index), BUMP_THRESHOLD, BUMP_AMOUNT);
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
                    index: count,
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
        bump_entry(&env, &subject, entry.index);
        bump_instance(&env);

        // The event is the registry's public audit trail: replaying it gives an
        // indexer the flagged set and, per subject, the current attribution,
        // reason, status and report count. It is deliberately NOT the whole
        // entry — `evidence`, `reported_at` and `updated_at` are not in the
        // payload, so an indexer that needs those reads contract storage (the
        // views land in #34). The topic/data shape is fixed by the spec, and
        // SDK 27 deprecates `publish` in favour of the `#[contractevent]`
        // macro, which derives its own topic layout; moving to it would change
        // the wire format downstream indexers key off, so that is a deliberate
        // follow-up rather than a drive-by here.
        //
        // The payload is the *persisted* attribution (`entry.reporter`,
        // `entry.reason`), not this call's arguments: on a repeat report of an
        // already-Active/Disputed subject the entry deliberately keeps the FIRST
        // reporter and reason, so publishing the caller's would make an indexer
        // that folds these events into state diverge from storage.
        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("report"), subject.clone()),
            (
                entry.reporter.clone(),
                entry.reason,
                entry.status,
                entry.reports,
            ),
        );

        entry.reports
    }

    /// Admin-only: move an entry between Active / Disputed / Revoked.
    ///
    /// The entry is never deleted — a revoked report stays readable, so the
    /// record of who reported what and how it was resolved survives. Disputes
    /// are how a wrongly-flagged address stops producing a warning without
    /// erasing the audit trail.
    ///
    /// Any transition between the three states is allowed, including a
    /// same-status no-op write. There is deliberately no transition matrix:
    /// a matrix can strand an entry in a state the admin cannot leave, and the
    /// only thing the registry actually needs to guarantee is that every change
    /// is authorized and auditable.
    ///
    /// **`Revoked` is not durable.** It clears the *current* evidence, it does
    /// not immunize the subject: the next `report()` resurrects the entry to
    /// `Active` under the new reporter's attribution (see `report`'s Revoked
    /// arm). So the admin's strongest action is the one any fee-payer can
    /// undo, while the weaker `Disputed` survives any number of reports. That
    /// is intended — a permanent admin allow-list would make one key able to
    /// silence a subject forever, which is exactly the centralization the fee
    /// model exists to avoid. `set_fee` is the lever if re-flagging a revoked
    /// subject needs to cost more.
    pub fn set_status(env: Env, subject: Address, status: Status) {
        Self::require_admin(&env);

        let key = DataKey::Entry(subject.clone());
        let mut entry: Entry = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));

        // Never creates an entry: an unknown subject is NotFound above, so the
        // admin cannot flag an address without a (fee-paying) report first.
        let old_status = entry.status;
        entry.status = status;
        entry.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&key, &entry);
        bump_entry(&env, &subject, entry.index);
        bump_instance(&env);

        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("status"), subject.clone()),
            (old_status, status),
        );
    }

    /// Admin-only: hand control to `new_admin`.
    ///
    /// **Both** admins authorize: the outgoing one to approve the hand-off, the
    /// incoming one to prove the address exists and is controlled. There is no
    /// upgrade entry point and no recovery path, so a hand-off to a mistyped or
    /// uncontrolled address is terminal — the registry would keep serving
    /// reporters and readers with its entire admin surface gone for good. The
    /// second signature is what makes that unreachable, and it costs nothing:
    /// both authorizations ride in the same transaction, so a compromised key
    /// is still rotated in a single call (SOW §3.9 risk table).
    pub fn set_admin(env: Env, new_admin: Address) {
        let mut config = Self::require_admin(&env);
        new_admin.require_auth();

        let old_admin = config.admin.clone();
        config.admin = new_admin.clone();
        Self::save_config(&env, &config);

        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("config"), symbol_short!("admin")),
            (old_admin, new_admin),
        );
    }

    /// Admin-only: redirect future report fees to `treasury`.
    ///
    /// Only *future* reports move — fees already collected stay where they were
    /// sent, since the contract never custodies them.
    pub fn set_treasury(env: Env, treasury: Address) {
        let mut config = Self::require_admin(&env);
        let old_treasury = config.treasury.clone();
        config.treasury = treasury.clone();
        Self::save_config(&env, &config);

        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("config"), symbol_short!("treasury")),
            (old_treasury, treasury),
        );
    }

    /// Admin-only: switch the token reports are paid in.
    ///
    /// Present for symmetry with the other three `Config` fields: with no
    /// upgrade path, leaving it out would freeze the fee asset for the
    /// contract's lifetime, so a de-pegged or frozen SAC could only be escaped
    /// by redeploying the registry and abandoning its entries. Changing it
    /// reprices nothing on its own — `fee` is denominated in the new token's
    /// units from the next report on, so the two are normally set together in
    /// one transaction.
    pub fn set_fee_token(env: Env, fee_token: Address) {
        let mut config = Self::require_admin(&env);
        let old_token = config.fee_token.clone();
        config.fee_token = fee_token.clone();
        Self::save_config(&env, &config);

        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("config"), symbol_short!("fee_token")),
            (old_token, fee_token),
        );
    }

    /// Admin-only: reprice a report. `0` is legal (free writes); negative is
    /// `Error::InvalidFee`, same rule the constructor enforces.
    pub fn set_fee(env: Env, fee: i128) {
        let mut config = Self::require_admin(&env);
        if fee < 0 {
            panic_with_error!(&env, Error::InvalidFee);
        }
        let old_fee = config.fee;
        config.fee = fee;
        Self::save_config(&env, &config);

        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("config"), symbol_short!("fee")),
            (old_fee, fee),
        );
    }

    // ── public read API (#34) ────────────────────────────────────────────────
    //
    // All five are read-only. None takes `require_auth`: the registry is a
    // public good and screening a counterparty must not require an identity,
    // let alone a signature. The only writes are TTL extensions, which are
    // wanted — an entry that wallets are actively querying is exactly the one
    // that should not expire.
    //
    // These are the *simulation-based* surface: a caller reaches them through
    // `simulateTransaction`, conventionally with a source account. The cheaper
    // path for the per-signature hot path is to read `DataKey::Entry(subject)`
    // straight out of the ledger with `getLedgerEntries` — no simulation, no
    // source account, no fee (#44).

    /// The one-call question every wallet asks before a user signs: is this
    /// counterparty currently flagged?
    ///
    /// True only for `Status::Active`. A disputed entry is one whose evidence
    /// is contested and a revoked one has been cleared by the admin; neither
    /// should raise a warning, because the whole point of the status machine is
    /// that a challenged report stops gating users immediately. An address that
    /// was never reported is simply `false` — never a panic, since this runs on
    /// every counterparty of every transaction.
    pub fn is_flagged(env: Env, subject: Address) -> bool {
        match Self::load(&env, &subject) {
            Some(entry) => entry.status == Status::Active,
            None => false,
        }
    }

    /// The full record behind a flag, for wallets that want to show the reason,
    /// who reported it and the evidence hash. `None` when the subject was never
    /// reported — an unknown address is not an error, it is the common case.
    pub fn get(env: Env, subject: Address) -> Option<Entry> {
        Self::load(&env, &subject)
    }

    /// Number of distinct reported subjects. Repeat reports of the same subject
    /// do not move it — `Count` tracks subjects, not reports.
    pub fn count(env: Env) -> u32 {
        bump_instance(&env);
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    /// Insertion-ordered page of entries, for indexers and the demo playground.
    ///
    /// `limit` must be `1..=MAX_PAGE`. A `start` past the end returns an empty
    /// `Vec` rather than erroring, so a caller can page to exhaustion without
    /// special-casing the last page. Index slots whose `Entry` has gone missing
    /// are skipped rather than panicked on: one expired or malformed slot must
    /// not brick paging over the whole registry.
    pub fn list(env: Env, start: u32, limit: u32) -> Vec<Entry> {
        if limit == 0 || limit > MAX_PAGE {
            panic_with_error!(&env, Error::InvalidLimit);
        }

        let total: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        let mut out = Vec::new(&env);
        if start >= total {
            bump_instance(&env);
            return out;
        }

        let end = start.saturating_add(limit).min(total);
        for i in start..end {
            let subject: Option<Address> = env.storage().persistent().get(&DataKey::Index(i));
            let Some(subject) = subject else { continue };
            if let Some(entry) = Self::load(&env, &subject) {
                out.push_back(entry);
            }
        }
        bump_instance(&env);
        out
    }

    /// Current admin, treasury, fee token and fee — so a wallet can quote the
    /// report fee before asking a user to pay it, rather than discovering the
    /// price by having the transfer fail.
    pub fn config(env: Env) -> Config {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound))
    }
}

impl BlacklistRegistry {
    /// Read an entry and, if it is there, keep it (and its index slot) alive.
    ///
    /// Refreshing on read is deliberate: a registry that forgets the addresses
    /// wallets keep asking about is worse than no registry, and the read path is
    /// the best signal we have about which entries still matter.
    fn load(env: &Env, subject: &Address) -> Option<Entry> {
        let entry: Entry = env
            .storage()
            .persistent()
            .get(&DataKey::Entry(subject.clone()))?;
        bump_entry(env, subject, entry.index);
        bump_instance(env);
        Some(entry)
    }

    /// Load `Config` and assert the caller is the *current* admin.
    ///
    /// Every admin entry point calls this first, before touching any other
    /// storage: nothing about the registry's state should be observable to an
    /// unauthorized caller, and `set_admin` means "current" is not a constant.
    fn require_admin(env: &Env) -> Config {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotFound));
        config.admin.require_auth();
        config
    }

    fn save_config(env: &Env, config: &Config) {
        env.storage().instance().set(&DataKey::Config, config);
        bump_instance(env);
    }
}

#[cfg(test)]
mod test;
