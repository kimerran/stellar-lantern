import { Horizon } from '@stellar/stellar-sdk';
import type { NetworkConfig } from '@shared/constants';
import type { AccountState, AssetBalance } from '@shared/types';

// A single network-aware factory. Never hardcode a Horizon URL at a call site
// (AGENT §5) — always go through here with the active NetworkConfig.
export function getServer(network: NetworkConfig): Horizon.Server {
  return new Horizon.Server(network.horizonUrl);
}

function isNotFound(err: unknown): boolean {
  // Horizon 404 for an account that has never been funded.
  const e = err as { response?: { status?: number }; name?: string };
  return e?.response?.status === 404 || e?.name === 'NotFoundError';
}

export async function loadAccountState(
  network: NetworkConfig,
  address: string,
): Promise<AccountState> {
  const server = getServer(network);
  try {
    const account = await server.loadAccount(address);
    const balances: AssetBalance[] = account.balances
      .map((b): AssetBalance | null => {
        if (b.asset_type === 'native') {
          return { code: 'XLM', balance: b.balance, isNative: true };
        }
        if (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') {
          return {
            code: b.asset_code,
            issuer: b.asset_issuer,
            balance: b.balance,
            isNative: false,
          };
        }
        return null; // liquidity pool shares etc. — out of scope for v1
      })
      .filter((b): b is AssetBalance => b !== null)
      // native first, then the rest by code
      .sort((a, b) => (a.isNative ? -1 : b.isNative ? 1 : a.code.localeCompare(b.code)));

    return {
      funded: true,
      balances,
      subentryCount: account.subentry_count,
    };
  } catch (err) {
    if (isNotFound(err)) {
      return { funded: false, balances: [], subentryCount: 0 };
    }
    throw err;
  }
}

export async function destinationFunded(
  network: NetworkConfig,
  address: string,
): Promise<boolean> {
  const server = getServer(network);
  try {
    await server.loadAccount(address);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

// Fund an unfunded account on Testnet via Friendbot.
export async function fundWithFriendbot(network: NetworkConfig, address: string): Promise<void> {
  if (!network.friendbotUrl) throw new Error('Friendbot is only available on Testnet.');
  const res = await fetch(`${network.friendbotUrl}?addr=${encodeURIComponent(address)}`);
  if (!res.ok) {
    throw new Error('Friendbot funding failed. Try again in a moment.');
  }
}
