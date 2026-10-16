import type { NetworkId } from '@shared/constants';
import { getKV } from '@shared/kv';

// Web connect (#250): which sites the user connected, per account and network.
//
// A grant is (origin, address, network). It lets that origin read the address
// and network and ASK for signatures; every signature is still asked for
// (spec: docs/superpowers/specs/2026-10-16-web-connect-threat-model.md).
// Switching account or network never carries a grant over: the lookup needs
// all three to match. Reset Wallet clears every grant (handler.ts).

export const GRANTS_KEY = 'lantern.webconnect.grants';

export interface Grant {
  origin: string;
  address: string;
  network: NetworkId;
  grantedAt: number;
  lastUsedAt: number;
}

const isGrant = (g: unknown): g is Grant => {
  const x = g as Partial<Grant> | null;
  return (
    !!x &&
    typeof x.origin === 'string' &&
    typeof x.address === 'string' &&
    (x.network === 'TESTNET' || x.network === 'PUBLIC') &&
    typeof x.grantedAt === 'number' &&
    typeof x.lastUsedAt === 'number'
  );
};

const same = (g: Grant, origin: string, address: string, network: NetworkId) =>
  g.origin === origin && g.address === address && g.network === network;

/** Every stored grant, newest use first. A corrupt store reads as empty. */
export async function listGrants(): Promise<Grant[]> {
  const raw = await (await getKV()).get(GRANTS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(isGrant).sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      : [];
  } catch {
    return [];
  }
}

async function save(grants: Grant[]): Promise<void> {
  const kv = await getKV();
  if (grants.length === 0) await kv.remove(GRANTS_KEY);
  else await kv.set(GRANTS_KEY, JSON.stringify(grants));
}

export async function findGrant(
  origin: string,
  address: string,
  network: NetworkId,
): Promise<Grant | null> {
  return (await listGrants()).find((g) => same(g, origin, address, network)) ?? null;
}

/** Add (or refresh) the grant for this origin, account and network. */
export async function addGrant(
  origin: string,
  address: string,
  network: NetworkId,
  now = Date.now(),
): Promise<Grant> {
  const grants = await listGrants();
  const existing = grants.find((g) => same(g, origin, address, network));
  const grant: Grant = {
    origin,
    address,
    network,
    grantedAt: existing?.grantedAt ?? now,
    lastUsedAt: now,
  };
  await save([grant, ...grants.filter((g) => !same(g, origin, address, network))]);
  return grant;
}

/** Record a use, so Connected sites can sort by it. A missing grant is a no-op. */
export async function touchGrant(
  origin: string,
  address: string,
  network: NetworkId,
  now = Date.now(),
): Promise<void> {
  const grants = await listGrants();
  const g = grants.find((x) => same(x, origin, address, network));
  if (!g) return;
  g.lastUsedAt = now;
  await save(grants);
}

/** Revoke every grant for `origin` (all accounts and networks). */
export async function revokeOrigin(origin: string): Promise<void> {
  await save((await listGrants()).filter((g) => g.origin !== origin));
}

export async function revokeAll(): Promise<void> {
  await save([]);
}
