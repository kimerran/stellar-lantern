#![cfg(test)]

use super::*;
use soroban_sdk::testutils::storage::Persistent as _;
use soroban_sdk::testutils::{Address as _, Events, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Env, IntoVal, Symbol, TryFromVal, Val};

const FEE: i128 = 1_000_000; // 0.1 XLM in stroops

/// Everything a test needs: the deployed registry plus the mock SAC used as
/// the fee token, so fee routing can be asserted with no network.
struct Fixture {
    contract_id: Address,
    admin: Address,
    treasury: Address,
    fee_token: Address,
    sac_admin: StellarAssetClient<'static>,
}

fn setup(env: &Env, fee: i128) -> Fixture {
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    let issuer = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let fee_token = sac.address();
    let contract_id = env.register(
        BlacklistRegistry,
        (admin.clone(), treasury.clone(), fee_token.clone(), fee),
    );
    Fixture {
        contract_id,
        admin,
        treasury,
        fee_token: fee_token.clone(),
        sac_admin: StellarAssetClient::new(env, &fee_token),
    }
}

fn client<'a>(env: &Env, f: &Fixture) -> BlacklistRegistryClient<'a> {
    BlacklistRegistryClient::new(env, &f.contract_id)
}

/// Read a value straight out of the contract's own storage. The registry
/// exposes no `config()`/`count()`/`get()` view yet — those are #34 — so tests
/// reach into storage rather than forcing a public API this slice doesn't own.
fn instance_get<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    contract_id: &Address,
    key: &DataKey,
) -> Option<V> {
    env.as_contract(contract_id, || env.storage().instance().get(key))
}

fn entry_of(env: &Env, contract_id: &Address, subject: &Address) -> Option<Entry> {
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .get(&DataKey::Entry(subject.clone()))
    })
}

/// Ledgers left before a persistent key expires, read from inside the contract.
fn ttl_of(env: &Env, contract_id: &Address, key: &DataKey) -> u32 {
    env.as_contract(contract_id, || env.storage().persistent().get_ttl(key))
}

fn count_of(env: &Env, contract_id: &Address) -> u32 {
    instance_get(env, contract_id, &DataKey::Count).unwrap_or(0)
}

fn no_evidence(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn some_evidence(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

fn balance(env: &Env, token: &Address, who: &Address) -> i128 {
    TokenClient::new(env, token).balance(who)
}

// --- #31: constructor -------------------------------------------------------

#[test]
fn constructor_stores_config() {
    let env = Env::default();
    let f = setup(&env, FEE);

    let config: Config = instance_get(&env, &f.contract_id, &DataKey::Config).unwrap();
    assert_eq!(
        config,
        Config {
            admin: f.admin.clone(),
            treasury: f.treasury.clone(),
            fee_token: f.fee_token.clone(),
            fee: FEE,
        }
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn constructor_rejects_negative_fee() {
    let env = Env::default();
    setup(&env, -1);
}

#[test]
fn constructor_starts_empty() {
    let env = Env::default();
    let f = setup(&env, FEE);
    assert_eq!(count_of(&env, &f.contract_id), 0);
}

#[test]
fn constructor_accepts_zero_fee() {
    // A zero fee is legal — it makes writes free, which is how the registry
    // runs on testnet before a treasury is funded.
    let env = Env::default();
    let f = setup(&env, 0);

    let config: Config = instance_get(&env, &f.contract_id, &DataKey::Config).unwrap();
    assert_eq!(config.fee, 0);
}

// --- #32: report() ----------------------------------------------------------

#[test]
fn report_creates_entry() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);
    f.sac_admin.mint(&reporter, &(FEE * 10));

    let reports = c.report(&reporter, &subject, &Reason::Drainer, &some_evidence(&env));
    assert_eq!(reports, 1);

    let entry = entry_of(&env, &f.contract_id, &subject).unwrap();
    assert_eq!(
        entry,
        Entry {
            subject: subject.clone(),
            reporter: reporter.clone(),
            reason: Reason::Drainer,
            evidence: some_evidence(&env),
            reported_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            status: Status::Active,
            reports: 1,
            index: 0,
        }
    );
    assert_eq!(count_of(&env, &f.contract_id), 1);
}

#[test]
fn report_routes_fee_to_treasury() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);
    f.sac_admin.mint(&reporter, &(FEE * 10));

    c.report(&reporter, &subject, &Reason::Scam, &no_evidence(&env));

    assert_eq!(balance(&env, &f.fee_token, &reporter), FEE * 9);
    assert_eq!(balance(&env, &f.fee_token, &f.treasury), FEE);
}

#[test]
fn report_requires_reporter_auth() {
    // No mock_all_auths(): the reporter never authorized this call.
    let env = Env::default();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);

    assert!(c
        .try_report(&reporter, &subject, &Reason::Scam, &no_evidence(&env))
        .is_err());
    assert_eq!(count_of(&env, &f.contract_id), 0);
}

#[test]
fn report_rejects_self_report() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let who = Address::generate(&env);
    f.sac_admin.mint(&who, &(FEE * 10));

    // `report` returns a bare u32 and panics, so the generated client surfaces
    // the contract error as a raw `soroban_sdk::Error` rather than our enum.
    assert_eq!(
        c.try_report(&who, &who, &Reason::Scam, &no_evidence(&env)),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::SelfReport as u32
        )))
    );
    assert_eq!(count_of(&env, &f.contract_id), 0);
}

#[test]
fn duplicate_report_increments_count_keeps_attribution() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let first = Address::generate(&env);
    let second = Address::generate(&env);
    let subject = Address::generate(&env);
    f.sac_admin.mint(&first, &(FEE * 10));
    f.sac_admin.mint(&second, &(FEE * 10));

    c.report(&first, &subject, &Reason::Phishing, &some_evidence(&env));
    env.ledger().with_mut(|li| li.timestamp = 2_000);
    let reports = c.report(&second, &subject, &Reason::Mixer, &no_evidence(&env));

    assert_eq!(reports, 2);
    let entry = entry_of(&env, &f.contract_id, &subject).unwrap();
    // First-reporter attribution is the audit trail: a later reporter can
    // raise the count but cannot rewrite who said what, or when.
    assert_eq!(entry.reporter, first);
    assert_eq!(entry.reason, Reason::Phishing);
    assert_eq!(entry.evidence, some_evidence(&env));
    assert_eq!(entry.reported_at, 1_000);
    assert_eq!(entry.updated_at, 2_000);
    assert_eq!(entry.reports, 2);
    assert_eq!(entry.status, Status::Active);
}

#[test]
fn duplicate_report_charges_fee_again() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);
    f.sac_admin.mint(&reporter, &(FEE * 10));

    c.report(&reporter, &subject, &Reason::Scam, &no_evidence(&env));
    c.report(&reporter, &subject, &Reason::Scam, &no_evidence(&env));

    assert_eq!(balance(&env, &f.fee_token, &f.treasury), 2 * FEE);
}

#[test]
fn duplicate_report_does_not_grow_index() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);
    f.sac_admin.mint(&reporter, &(FEE * 10));

    c.report(&reporter, &subject, &Reason::Scam, &no_evidence(&env));
    c.report(&reporter, &subject, &Reason::Other, &no_evidence(&env));

    assert_eq!(count_of(&env, &f.contract_id), 1);
    let indexed: Option<Address> = env.as_contract(&f.contract_id, || {
        env.storage().persistent().get(&DataKey::Index(1))
    });
    assert_eq!(indexed, None);
}

#[test]
fn report_on_revoked_reactivates() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let first = Address::generate(&env);
    let second = Address::generate(&env);
    let subject = Address::generate(&env);
    f.sac_admin.mint(&first, &(FEE * 10));
    f.sac_admin.mint(&second, &(FEE * 10));

    c.report(&first, &subject, &Reason::Scam, &some_evidence(&env));

    // The admin revoke path is #33; until it lands, set the status directly.
    env.as_contract(&f.contract_id, || {
        let key = DataKey::Entry(subject.clone());
        let mut e: Entry = env.storage().persistent().get(&key).unwrap();
        e.status = Status::Revoked;
        env.storage().persistent().set(&key, &e);
    });

    env.ledger().with_mut(|li| li.timestamp = 3_000);
    let reports = c.report(&second, &subject, &Reason::Poisoning, &no_evidence(&env));

    assert_eq!(reports, 2);
    let entry = entry_of(&env, &f.contract_id, &subject).unwrap();
    assert_eq!(entry.status, Status::Active);
    // A revoked entry was cleared, so the new report owns the attribution —
    // but `reported_at` still points at the first-ever report.
    assert_eq!(entry.reporter, second);
    assert_eq!(entry.reason, Reason::Poisoning);
    assert_eq!(entry.evidence, no_evidence(&env));
    assert_eq!(entry.reported_at, 1_000);
    assert_eq!(entry.updated_at, 3_000);
    assert_eq!(count_of(&env, &f.contract_id), 1);
}

#[test]
fn report_on_disputed_stays_disputed() {
    // Only the admin resolves a dispute (#33) — piling on more reports must not.
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let first = Address::generate(&env);
    let second = Address::generate(&env);
    let subject = Address::generate(&env);
    f.sac_admin.mint(&first, &(FEE * 10));
    f.sac_admin.mint(&second, &(FEE * 10));

    c.report(&first, &subject, &Reason::Scam, &no_evidence(&env));
    env.as_contract(&f.contract_id, || {
        let key = DataKey::Entry(subject.clone());
        let mut e: Entry = env.storage().persistent().get(&key).unwrap();
        e.status = Status::Disputed;
        env.storage().persistent().set(&key, &e);
    });

    c.report(&second, &subject, &Reason::Other, &no_evidence(&env));

    let entry = entry_of(&env, &f.contract_id, &subject).unwrap();
    assert_eq!(entry.status, Status::Disputed);
    assert_eq!(entry.reports, 2);
    assert_eq!(entry.reporter, first);
}

#[test]
fn report_with_insufficient_balance_reverts() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let reporter = Address::generate(&env); // never funded
    let subject = Address::generate(&env);

    assert!(c
        .try_report(&reporter, &subject, &Reason::Scam, &no_evidence(&env))
        .is_err());
    // The whole invocation reverts: no entry, no index slot, no count.
    assert_eq!(entry_of(&env, &f.contract_id, &subject), None);
    assert_eq!(count_of(&env, &f.contract_id), 0);
}

#[test]
fn report_with_zero_fee_skips_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, 0);
    let c = client(&env, &f);

    let reporter = Address::generate(&env); // deliberately unfunded
    let subject = Address::generate(&env);

    let reports = c.report(&reporter, &subject, &Reason::Scam, &no_evidence(&env));

    assert_eq!(reports, 1);
    assert_eq!(balance(&env, &f.fee_token, &reporter), 0);
    assert_eq!(balance(&env, &f.fee_token, &f.treasury), 0);
}

#[test]
fn report_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);
    f.sac_admin.mint(&reporter, &(FEE * 10));

    c.report(&reporter, &subject, &Reason::Drainer, &no_evidence(&env));

    // An indexer must be able to rebuild the registry from events alone.
    let all = env.events().all();
    let mine = all.filter_by_contract(&f.contract_id);
    let events = mine.events();
    assert_eq!(events.len(), 1);
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &events[0].body;

    assert_eq!(
        Symbol::try_from_val(&env, &body.topics[0]).unwrap(),
        symbol_short!("report")
    );
    assert_eq!(
        Address::try_from_val(&env, &body.topics[1]).unwrap(),
        subject
    );
    // ScVal converts to a host Val, and the tuple decodes from there.
    let data_val = Val::try_from_val(&env, &body.data).unwrap();
    let data: (Address, Reason, Status, u32) = TryFromVal::try_from_val(&env, &data_val).unwrap();
    assert_eq!(data, (reporter, Reason::Drainer, Status::Active, 1u32));
}

// --- #32: index TTL ---------------------------------------------------------

/// `Index(i) -> subject` is a separate ledger entry from `Entry(subject)`, and
/// a freshly written one starts at the network minimum TTL. If only the entry
/// were bumped, the index would expire first and `Count`/`Entry` would keep
/// claiming a subject that `list()` (#34) could no longer reach.
#[test]
fn report_extends_the_index_key_with_the_entry() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);
    f.sac_admin.mint(&reporter, &(FEE * 10));

    c.report(&reporter, &subject, &Reason::Scam, &no_evidence(&env));

    let entry_ttl = ttl_of(&env, &f.contract_id, &DataKey::Entry(subject.clone()));
    let index_ttl = ttl_of(&env, &f.contract_id, &DataKey::Index(0));
    assert_eq!(index_ttl, entry_ttl);
    assert!(index_ttl >= BUMP_THRESHOLD);
}

/// The same invariant on the repeat-report path: a later report has to find the
/// subject's ordinal again (it is carried on the entry) and refresh that key,
/// otherwise the gap reopens on every subsequent write.
#[test]
fn repeat_report_refreshes_the_index_key() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let reporter = Address::generate(&env);
    let other = Address::generate(&env);
    let first = Address::generate(&env);
    let second = Address::generate(&env);
    f.sac_admin.mint(&reporter, &(FEE * 10));
    f.sac_admin.mint(&other, &(FEE * 10));

    c.report(&reporter, &first, &Reason::Scam, &no_evidence(&env));
    c.report(&reporter, &second, &Reason::Scam, &no_evidence(&env));

    // Let time pass, then report the first subject again.
    env.ledger().with_mut(|li| li.sequence_number += 10_000);
    c.report(&other, &first, &Reason::Phishing, &no_evidence(&env));

    let entry = entry_of(&env, &f.contract_id, &first).unwrap();
    assert_eq!(entry.index, 0);
    assert_eq!(
        ttl_of(&env, &f.contract_id, &DataKey::Index(0)),
        ttl_of(&env, &f.contract_id, &DataKey::Entry(first.clone())),
    );
    // The other subject keeps its own slot: index keys are per-subject.
    let second_entry = entry_of(&env, &f.contract_id, &second).unwrap();
    assert_eq!(second_entry.index, 1);
}

/// A repeat report keeps the FIRST reporter and reason in storage, so the event
/// has to carry those too — an indexer folding `report` events into state must
/// not drift from what `Entry` says.
#[test]
fn repeat_report_event_carries_persisted_attribution() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let first = Address::generate(&env);
    let second = Address::generate(&env);
    let subject = Address::generate(&env);
    f.sac_admin.mint(&first, &(FEE * 10));
    f.sac_admin.mint(&second, &(FEE * 10));

    c.report(&first, &subject, &Reason::Drainer, &some_evidence(&env));
    c.report(&second, &subject, &Reason::Mixer, &no_evidence(&env));

    let all = env.events().all();
    let mine = all.filter_by_contract(&f.contract_id);
    let events = mine.events();
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &events[events.len() - 1].body;
    let data_val = Val::try_from_val(&env, &body.data).unwrap();
    let data: (Address, Reason, Status, u32) = TryFromVal::try_from_val(&env, &data_val).unwrap();

    let entry = entry_of(&env, &f.contract_id, &subject).unwrap();
    assert_eq!(entry.reporter, first);
    assert_eq!(entry.reason, Reason::Drainer);
    assert_eq!(data, (first, Reason::Drainer, Status::Active, 2u32));
}

// --- #33: admin status transitions + config ---------------------------------

/// Fund a fresh reporter and file one report, returning the subject.
fn seed_entry(env: &Env, f: &Fixture, c: &BlacklistRegistryClient) -> Address {
    let reporter = Address::generate(env);
    let subject = Address::generate(env);
    f.sac_admin.mint(&reporter, &(FEE * 100));
    c.report(&reporter, &subject, &Reason::Scam, &some_evidence(env));
    subject
}

/// The generated client surfaces a panicking contract call as a raw
/// `soroban_sdk::Error` (these entry points return `()`, not `Result`), so
/// assertions spell the expected error out the same way `report`'s do.
fn contract_err(e: Error) -> Result<soroban_sdk::Error, soroban_sdk::InvokeError> {
    Ok(soroban_sdk::Error::from_contract_error(e as u32))
}

/// Did `set_status` succeed when authorized by exactly one address — the only way to test
/// the admin gate, since `mock_all_auths` would satisfy it for anyone.
fn set_status_as(env: &Env, f: &Fixture, who: &Address, subject: &Address, status: Status) -> bool {
    let invoke = soroban_sdk::testutils::MockAuthInvoke {
        contract: &f.contract_id,
        fn_name: "set_status",
        args: (subject.clone(), status).into_val(env),
        sub_invokes: &[],
    };
    let auths = [soroban_sdk::testutils::MockAuth {
        address: who,
        invoke: &invoke,
    }];
    BlacklistRegistryClient::new(env, &f.contract_id)
        .mock_auths(&auths)
        .try_set_status(subject, &status)
        .is_ok()
}

fn config_of(env: &Env, contract_id: &Address) -> Config {
    instance_get(env, contract_id, &DataKey::Config).unwrap()
}

#[test]
fn set_status_requires_admin_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);
    let subject = seed_entry(&env, &f, &c);

    // Only the intruder's own auth is mocked, so the admin's require_auth fails.
    let intruder = Address::generate(&env);
    assert!(!set_status_as(
        &env,
        &f,
        &intruder,
        &subject,
        Status::Revoked
    ));

    // Unchanged: the failed call must not have moved the entry.
    assert_eq!(
        entry_of(&env, &f.contract_id, &subject).unwrap().status,
        Status::Active
    );
}

#[test]
fn set_status_unknown_subject_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let stranger = Address::generate(&env);
    assert_eq!(
        c.try_set_status(&stranger, &Status::Revoked),
        Err(contract_err(Error::NotFound))
    );
    // NotFound rather than an implicit create: the admin cannot flag an address
    // without a fee-paying report behind it.
    assert_eq!(entry_of(&env, &f.contract_id, &stranger), None);
    assert_eq!(count_of(&env, &f.contract_id), 0);
}

#[test]
fn set_status_cycles_all_states() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let f = setup(&env, FEE);
    let c = client(&env, &f);
    let subject = seed_entry(&env, &f, &c);

    // Any transition is legal, including back to Active and a same-status
    // no-op — a transition matrix could strand an entry in a dead end.
    let mut clock = 1_000u64;
    for status in [
        Status::Disputed,
        Status::Revoked,
        Status::Active,
        Status::Active,
    ] {
        clock += 500;
        env.ledger().with_mut(|li| li.timestamp = clock);
        c.set_status(&subject, &status);

        let entry = entry_of(&env, &f.contract_id, &subject).unwrap();
        assert_eq!(entry.status, status);
        assert_eq!(entry.updated_at, clock);
    }
}

#[test]
fn set_status_preserves_entry() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);
    f.sac_admin.mint(&reporter, &(FEE * 10));
    c.report(&reporter, &subject, &Reason::Phishing, &some_evidence(&env));
    c.report(&reporter, &subject, &Reason::Phishing, &some_evidence(&env));
    let before = entry_of(&env, &f.contract_id, &subject).unwrap();

    env.ledger().with_mut(|li| li.timestamp = 9_000);
    c.set_status(&subject, &Status::Disputed);

    // The audit trail is the point: a status change resolves a report, it does
    // not rewrite who reported what, when, or how many times.
    let after = entry_of(&env, &f.contract_id, &subject).unwrap();
    assert_eq!(
        after,
        Entry {
            status: Status::Disputed,
            updated_at: 9_000,
            ..before
        }
    );
}

#[test]
fn set_status_extends_the_index_key_with_the_entry() {
    // Same invariant report() holds: whatever keeps an entry alive keeps its
    // insertion-index slot alive, or list() (#34) loses a live subject.
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);
    let subject = seed_entry(&env, &f, &c);

    env.ledger().with_mut(|li| li.sequence_number += 10_000);
    c.set_status(&subject, &Status::Disputed);

    let entry_ttl = ttl_of(&env, &f.contract_id, &DataKey::Entry(subject.clone()));
    let index_ttl = ttl_of(&env, &f.contract_id, &DataKey::Index(0));
    assert_eq!(index_ttl, entry_ttl);
    assert!(index_ttl >= BUMP_THRESHOLD);
}

#[test]
fn set_status_revoked_then_report_reactivates() {
    // The end-to-end dispute path #32 could only fake by poking storage.
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);
    let subject = seed_entry(&env, &f, &c);

    c.set_status(&subject, &Status::Revoked);
    let second = Address::generate(&env);
    f.sac_admin.mint(&second, &(FEE * 10));
    c.report(&second, &subject, &Reason::Poisoning, &no_evidence(&env));

    let entry = entry_of(&env, &f.contract_id, &subject).unwrap();
    assert_eq!(entry.status, Status::Active);
    assert_eq!(entry.reporter, second);
    assert_eq!(entry.reports, 2);
}

#[test]
fn set_fee_rejects_negative() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    assert_eq!(c.try_set_fee(&-1), Err(contract_err(Error::InvalidFee)));
    assert_eq!(config_of(&env, &f.contract_id).fee, FEE);
}

#[test]
fn set_fee_applies_to_next_report() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);
    f.sac_admin.mint(&reporter, &(FEE * 100));

    c.report(&reporter, &subject, &Reason::Scam, &no_evidence(&env));
    c.set_fee(&(FEE * 5));
    c.report(&reporter, &subject, &Reason::Scam, &no_evidence(&env));

    assert_eq!(config_of(&env, &f.contract_id).fee, FEE * 5);
    assert_eq!(balance(&env, &f.fee_token, &f.treasury), FEE + FEE * 5);
}

#[test]
fn set_fee_accepts_zero() {
    // Zero is legal and makes writes free — how the registry runs on testnet
    // before a treasury is funded.
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    c.set_fee(&0);
    let reporter = Address::generate(&env); // deliberately unfunded
    let subject = Address::generate(&env);
    c.report(&reporter, &subject, &Reason::Scam, &no_evidence(&env));

    assert_eq!(balance(&env, &f.fee_token, &f.treasury), 0);
}

#[test]
fn set_treasury_reroutes_fee() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    let reporter = Address::generate(&env);
    let subject = Address::generate(&env);
    f.sac_admin.mint(&reporter, &(FEE * 100));
    c.report(&reporter, &subject, &Reason::Scam, &no_evidence(&env));

    let new_treasury = Address::generate(&env);
    c.set_treasury(&new_treasury);
    c.report(&reporter, &subject, &Reason::Scam, &no_evidence(&env));

    assert_eq!(config_of(&env, &f.contract_id).treasury, new_treasury);
    assert_eq!(balance(&env, &f.fee_token, &new_treasury), FEE);
    // Already-collected fees are not custodied by the contract, so the old
    // treasury keeps exactly what it was sent.
    assert_eq!(balance(&env, &f.fee_token, &f.treasury), FEE);
}

#[test]
fn set_admin_transfers_control() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);
    let subject = seed_entry(&env, &f, &c);

    let new_admin = Address::generate(&env);
    c.set_admin(&new_admin);
    assert_eq!(config_of(&env, &f.contract_id).admin, new_admin);

    // The old admin is rejected the instant the transfer lands...
    assert!(!set_status_as(
        &env,
        &f,
        &f.admin,
        &subject,
        Status::Revoked
    ));

    // ...and the new one is accepted.
    assert!(set_status_as(
        &env,
        &f,
        &new_admin,
        &subject,
        Status::Revoked
    ));
    assert_eq!(
        entry_of(&env, &f.contract_id, &subject).unwrap().status,
        Status::Revoked
    );
}

#[test]
fn config_ops_require_admin_auth() {
    // No mock_all_auths(): none of the three config setters may run unauthorized.
    let env = Env::default();
    let f = setup(&env, FEE);
    let c = client(&env, &f);

    assert!(c.try_set_fee(&0).is_err());
    assert!(c.try_set_treasury(&Address::generate(&env)).is_err());
    assert!(c.try_set_admin(&Address::generate(&env)).is_err());

    assert_eq!(
        config_of(&env, &f.contract_id),
        Config {
            admin: f.admin.clone(),
            treasury: f.treasury.clone(),
            fee_token: f.fee_token.clone(),
            fee: FEE,
        }
    );
}

/// Every admin change is auditable from events alone — that is what makes the
/// "weighted signal, never an auto-block" promise checkable off-chain.
#[test]
fn admin_ops_emit_events() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env, FEE);
    let c = client(&env, &f);
    let subject = seed_entry(&env, &f, &c);

    let new_admin = Address::generate(&env);
    let new_treasury = Address::generate(&env);

    // `events().all()` only carries the most recent invocation's events, so each
    // call is inspected right after it rather than in one pass at the end.
    let last_event = || {
        let all = env.events().all();
        let mine = all.filter_by_contract(&f.contract_id);
        let events = mine.events();
        let soroban_sdk::xdr::ContractEventBody::V0(body) = &events[events.len() - 1].body;
        (
            body.topics.clone(),
            Val::try_from_val(&env, &body.data).unwrap(),
        )
    };

    // set_status: topic (status, subject), data (old, new) — the old status is
    // in the payload so an indexer can audit the transition, not just the result.
    c.set_status(&subject, &Status::Disputed);
    let (topics, data) = last_event();
    assert_eq!(
        Symbol::try_from_val(&env, &topics[0]).unwrap(),
        symbol_short!("status")
    );
    assert_eq!(Address::try_from_val(&env, &topics[1]).unwrap(), subject);
    let statuses: (Status, Status) = TryFromVal::try_from_val(&env, &data).unwrap();
    assert_eq!(statuses, (Status::Active, Status::Disputed));

    // Config changes: one topic per field, so an indexer can subscribe per key.
    let assert_config_topic = |topics: &[soroban_sdk::xdr::ScVal], field: Symbol| {
        assert_eq!(
            Symbol::try_from_val(&env, &topics[0]).unwrap(),
            symbol_short!("config")
        );
        assert_eq!(Symbol::try_from_val(&env, &topics[1]).unwrap(), field);
    };

    c.set_treasury(&new_treasury);
    let (topics, data) = last_event();
    assert_config_topic(&topics, symbol_short!("treasury"));
    assert_eq!(
        Address::try_from_val(&env, &data).unwrap(),
        new_treasury.clone()
    );

    c.set_fee(&(FEE * 2));
    let (topics, data) = last_event();
    assert_config_topic(&topics, symbol_short!("fee"));
    assert_eq!(i128::try_from_val(&env, &data).unwrap(), FEE * 2);

    c.set_admin(&new_admin);
    let (topics, data) = last_event();
    assert_config_topic(&topics, symbol_short!("admin"));
    assert_eq!(
        Address::try_from_val(&env, &data).unwrap(),
        new_admin.clone()
    );
}
