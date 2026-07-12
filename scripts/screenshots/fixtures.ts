// Representative placeholder data for the docs/ui screenshots. NOT real accounts
// or balances — just enough to render each popup surface in a realistic "loaded"
// state. See scripts/screenshots/README.md.
import { NETWORKS, type NetworkConfig } from '@shared/constants';
import type { AccountState, HistoryItem, Settings } from '@shared/types';

// Build a plausible 56-char Stellar-style ref that truncates to `prefix…suffix`.
function ref(prefix: string, suffix: string): string {
  return prefix + 'A'.repeat(Math.max(0, 56 - prefix.length - suffix.length)) + suffix;
}

export const ADDRESS = ref('GDXR2K', '9J5H7K');
const USDC_ISSUER = ref('GA5Z', 'KLM7');

export const NETWORK: NetworkConfig = NETWORKS.TESTNET; // has sorobanRpcUrl → Earn loads APYs

export const SETTINGS: Settings = {
  network: 'TESTNET',
  autoLockMinutes: 15,
  horizonOverrides: { testnet: 'https://horizon-testnet.stellar.org' },
  rpcOverrides: { testnet: 'https://soroban-testnet.stellar.org' },
};

export const ACCOUNT_STATE: AccountState = {
  funded: true,
  subentryCount: 2,
  balances: [
    { code: 'XLM', balance: '1250.50', isNative: true },
    { code: 'USDC', issuer: USDC_ISSUER, balance: '340.00', isNative: false },
  ],
};

// Illustrative supply APYs by pool slug (fractions). The apr stub maps a pool's
// on-chain poolId → slug → these rates.
export const APYS_BY_SLUG: Record<string, Record<string, number>> = {
  'lantern-earn': { USDC: 0.042, XLM: 0.0185 },
  'blend-v2-testnet': { USDC: 0.039 },
};

// Activity history: three items today + one yesterday, clock times chosen to
// match the reference render. Timestamps are relative to render time so the
// "Today" / "Yesterday" date grouping is always correct.
function at(hours: number, minutes: number, daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

export const HISTORY_ITEMS: HistoryItem[] = [
  {
    id: '1', hash: ref('HA', 'AA'), direction: 'received', title: 'Received',
    counterparty: ref('GBQR', '3M9K'), amount: '120.00', signedAmount: '+120.00',
    assetCode: 'USDC', createdAt: at(14, 32), successful: true,
  },
  {
    id: '2', hash: ref('HB', 'BB'), direction: 'swap', title: 'Swapped',
    counterparty: 'SDEX', amount: '48.20', signedAmount: '+48.20',
    assetCode: 'USDC', createdAt: at(11, 5), successful: true,
  },
  {
    id: '3', hash: ref('HC', 'CC'), direction: 'sent', title: 'Sent',
    counterparty: ref('GA7T', '9XQ2'), amount: '50.00', signedAmount: '-50.00',
    assetCode: 'XLM', createdAt: at(9, 48), successful: true,
  },
  {
    id: '4', hash: ref('HD', 'DD'), direction: 'sent', title: 'Supplied to Lantern Earn',
    counterparty: ref('CC4K', 'HBOH'), amount: '100.00', signedAmount: '-100.00',
    assetCode: 'XLM', createdAt: at(18, 20, 1), successful: true,
  },
];
