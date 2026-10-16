// Plain-language labels for common DeFi / lending contract calls (#21).
// Soroban function names are opaque symbols in the XDR; a user approving a
// Blend "supply" should read what the *action* does, not just the raw name.
// Pure lookup — no side effects, no network. Matches case-insensitively on the
// decoded `contractFunction`. Unknown functions return undefined so the
// explainer falls back to its generic Soroban wording.
//
// Only names that mean lending wherever they appear say "lending pool".
// `deposit` and `withdraw` are just as common on vaults, escrows and payment
// pipelines (Paiflow's deposit trigger, #294), so they name the action and
// leave out where the funds go: the contract is unverified, and claiming a
// lending pool would be a guess dressed up as a fact.

const DEFI_ACTIONS: Record<string, string> = {
  supply: 'Deposits funds into a lending pool',
  deposit: 'Deposits funds',
  withdraw: 'Withdraws funds',
  borrow: 'Borrows against your collateral',
  repay: 'Repays borrowed funds',
  claim: 'Claims rewards',
  claim_rewards: 'Claims rewards',
};

export function describeDefiFunction(fn: string | undefined): string | undefined {
  if (!fn) return undefined;
  return DEFI_ACTIONS[fn.toLowerCase()];
}
