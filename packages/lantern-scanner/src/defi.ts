// Plain-language labels for common DeFi / lending contract calls (#21).
// Soroban function names are opaque symbols in the XDR; a user approving a
// Blend "supply" should read what the *action* does, not just the raw name.
// Pure lookup — no side effects, no network. Matches case-insensitively on the
// decoded `contractFunction`. Unknown functions return undefined so the
// explainer falls back to its generic Soroban wording.

const DEFI_ACTIONS: Record<string, string> = {
  supply: 'Deposits funds into a lending pool',
  deposit: 'Deposits funds into a lending pool',
  withdraw: 'Withdraws funds from a lending pool',
  borrow: 'Borrows against your collateral',
  repay: 'Repays borrowed funds',
  claim: 'Claims rewards',
  claim_rewards: 'Claims rewards',
};

export function describeDefiFunction(fn: string | undefined): string | undefined {
  if (!fn) return undefined;
  return DEFI_ACTIONS[fn.toLowerCase()];
}
