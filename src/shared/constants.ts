import { Networks } from '@stellar/stellar-sdk';

export type NetworkId = 'TESTNET' | 'PUBLIC';

export interface NetworkConfig {
  id: NetworkId;
  label: string;
  passphrase: string;
  horizonUrl: string;
  explorerTxUrl: (hash: string) => string;
  friendbotUrl?: string;
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  TESTNET: {
    id: 'TESTNET',
    label: 'Testnet',
    passphrase: Networks.TESTNET,
    horizonUrl: 'https://horizon-testnet.stellar.org',
    explorerTxUrl: (hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
    friendbotUrl: 'https://friendbot.stellar.org',
  },
  PUBLIC: {
    id: 'PUBLIC',
    label: 'Mainnet',
    passphrase: Networks.PUBLIC,
    horizonUrl: 'https://horizon.stellar.org',
    explorerTxUrl: (hash) => `https://stellar.expert/explorer/public/tx/${hash}`,
  },
};

export const DEFAULT_NETWORK: NetworkId = 'TESTNET';
export const DEFAULT_AUTOLOCK_MINUTES = 15;

// Stellar base reserve (XLM) per ledger entry on current protocol.
export const BASE_RESERVE_XLM = 0.5;
// A small buffer kept aside for the transaction fee when computing MAX (XLM).
export const FEE_BUFFER_XLM = 0.001;
export const MAX_MEMO_BYTES = 28;

// PBKDF2 work factor (AGENT §6 / SPEC §8: ≥ 600k).
export const PBKDF2_ITERATIONS = 600_000;
