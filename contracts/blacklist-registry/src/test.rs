#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Env;

const FEE: i128 = 1_000_000; // 0.1 XLM in stroops

/// Deploy a registry with a freshly-registered SAC as the fee token.
/// Returns the env, the contract id and the addresses the caller asserts on.
fn setup(env: &Env, fee: i128) -> (Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    let issuer = Address::generate(env);
    let fee_token = env.register_stellar_asset_contract_v2(issuer).address();
    let contract_id = env.register(
        BlacklistRegistry,
        (admin.clone(), treasury.clone(), fee_token.clone(), fee),
    );
    (contract_id, admin, treasury, fee_token)
}

/// Read a value straight out of the contract's own storage. The registry
/// exposes no `config()`/`count()` view yet — those are #34 — so tests reach
/// into instance storage rather than forcing a public API this slice doesn't own.
fn instance_get<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    contract_id: &Address,
    key: &DataKey,
) -> Option<V> {
    env.as_contract(contract_id, || env.storage().instance().get(key))
}

#[test]
fn constructor_stores_config() {
    let env = Env::default();
    let (contract_id, admin, treasury, fee_token) = setup(&env, FEE);

    let config: Config = instance_get(&env, &contract_id, &DataKey::Config).unwrap();
    assert_eq!(
        config,
        Config {
            admin,
            treasury,
            fee_token,
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
    let (contract_id, _, _, _) = setup(&env, FEE);

    let count: u32 = instance_get(&env, &contract_id, &DataKey::Count).unwrap();
    assert_eq!(count, 0);
}

#[test]
fn constructor_accepts_zero_fee() {
    // A zero fee is legal — it makes writes free, which is how the registry
    // runs on testnet before a treasury is funded.
    let env = Env::default();
    let (contract_id, _, _, _) = setup(&env, 0);

    let config: Config = instance_get(&env, &contract_id, &DataKey::Config).unwrap();
    assert_eq!(config.fee, 0);
}
