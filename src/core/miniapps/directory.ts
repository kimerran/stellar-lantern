import type { NetworkId } from '@shared/constants';

// ─────────────────────────────────────────────────────────────────────────────
// MOCK mini-app directory (roadmap: "Mini-app browser for Stellar dApps").
//
// A curated, statically-seeded list of Stellar dApps the in-wallet browser can
// launch. The real build would fetch this from a vetted, verifiable registry
// with on-chain/issuer attestations; here it's a hand-seeded constant so the
// demo is deterministic and offline.
// ─────────────────────────────────────────────────────────────────────────────

export interface MiniApp {
  id: string;
  name: string;
  origin: string; // launch URL / origin
  category: string;
  tagline: string;
  icon: string; // Material Symbols glyph name
  verified: boolean;
  featured?: boolean;
  // Default scoped permissions a user would grant on connect (demo values).
  permissions: {
    networks: NetworkId[];
    accounts: number;
    spendCapXlm?: number;
  };
}

export const MINI_APPS: MiniApp[] = [
  {
    id: 'blockhub-academy',
    name: 'BlockHub Academy',
    origin: 'https://blockhub.academy',
    category: 'Education',
    tagline: 'Learn blockchain & earn on-chain credentials.',
    icon: 'school',
    verified: true,
    featured: true,
    permissions: { networks: ['TESTNET'], accounts: 1, spendCapXlm: 100 },
  },
  {
    id: 'stellarx',
    name: 'StellarX',
    origin: 'https://www.stellarx.com',
    category: 'DeFi',
    tagline: 'Trade on the Stellar DEX with zero fees.',
    icon: 'monetization_on',
    verified: true,
    permissions: { networks: ['PUBLIC'], accounts: 1, spendCapXlm: 250 },
  },
  {
    id: 'aquarius',
    name: 'Aquarius',
    origin: 'https://aqua.network',
    category: 'DeFi',
    tagline: 'Liquidity management & market incentives.',
    icon: 'waves',
    verified: true,
    permissions: { networks: ['PUBLIC'], accounts: 1, spendCapXlm: 250 },
  },
  {
    id: 'litemint',
    name: 'Litemint',
    origin: 'https://litemint.com',
    category: 'NFTs',
    tagline: 'Buy, sell & auction NFTs on Stellar.',
    icon: 'image',
    verified: true,
    permissions: { networks: ['PUBLIC'], accounts: 1, spendCapXlm: 100 },
  },
  {
    id: 'soroswap',
    name: 'Soroswap',
    origin: 'https://soroswap.finance',
    category: 'DeFi',
    tagline: 'The AMM & aggregator for Soroban.',
    icon: 'swap_horiz',
    verified: true,
    permissions: { networks: ['PUBLIC', 'TESTNET'], accounts: 1, spendCapXlm: 250 },
  },
];

export function getMiniApp(id: string): MiniApp | undefined {
  return MINI_APPS.find((a) => a.id === id);
}
