// Stub for @core/stellar/client in the screenshot harness — returns fixture
// account data instead of hitting Horizon. Only the functions the rendered
// screens import are provided.
import type { NetworkConfig } from '@shared/constants';
import type { AccountState } from '@shared/types';
import { ACCOUNT_STATE } from '../fixtures';

export async function loadAccountState(_network: NetworkConfig, _address: string): Promise<AccountState> {
  return ACCOUNT_STATE;
}

export async function fundWithFriendbot(_network: NetworkConfig, _address: string): Promise<void> {
  /* no-op in the harness */
}

// Earn imports getServer but only calls it on submit (not reached in a render).
export function getServer(_network: NetworkConfig): never {
  throw new Error('getServer is unavailable in the screenshot harness');
}
