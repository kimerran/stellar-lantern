#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Events, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Env, Symbol, TryFromVal, Val};

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
