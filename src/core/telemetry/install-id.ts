// The anonymous install id (#81): a random UUID minted on first run and kept
// in the platform KV. Not a device fingerprint, not derived from any Stellar
// address or hardware property, and regenerated if storage is cleared. It is
// the "User N" identity — the report maps uuid → "User N" at export time and
// never prints the uuid.

import { getKV } from '@shared/kv';

export const INSTALL_ID_KEY = 'lantern.telemetry.installId';

export async function getInstallId(): Promise<string> {
  const kv = await getKV();
  const existing = await kv.get(INSTALL_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await kv.set(INSTALL_ID_KEY, id);
  return id;
}

// "Delete my data": forget the id locally. The next event, if consent is ever
// granted again, starts a fresh, unlinkable trail.
export async function clearInstallId(): Promise<void> {
  const kv = await getKV();
  await kv.remove(INSTALL_ID_KEY);
}
