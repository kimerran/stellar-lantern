import { getKV } from '../kv';

// Persistent storage for the web app (#238). The wallet lives in this
// browser's IndexedDB; without persistence the browser may evict it under
// storage pressure. (Safari's 7-day deletion of a tab's storage is separate:
// adding the app to the Home Screen exempts it, see install.ts.) The app asks
// once a wallet exists, records the answer, and Settings shows the live state.

export type PersistState = 'persisted' | 'not-persisted' | 'unsupported';

const KEY = 'lantern.web.persist';

export async function requestPersistentStorage(
  storage: StorageManager | undefined = globalThis.navigator?.storage,
  now: () => number = Date.now,
): Promise<PersistState> {
  let result: PersistState;
  if (typeof storage?.persist !== 'function') result = 'unsupported';
  else
    result = await storage.persist().then(
      (ok) => (ok ? 'persisted' : 'not-persisted'),
      () => 'not-persisted' as const,
    );
  const kv = await getKV();
  await kv.set(KEY, JSON.stringify({ result, at: now() }));
  return result;
}

/** What the browser says now: it can grant persistence later (e.g. once installed). */
export async function persistedState(
  storage: StorageManager | undefined = globalThis.navigator?.storage,
): Promise<PersistState> {
  if (typeof storage?.persisted !== 'function') return 'unsupported';
  return (await storage.persisted().catch(() => false)) ? 'persisted' : 'not-persisted';
}

export async function lastPersistRequest(): Promise<{ result: PersistState; at: number } | null> {
  const raw = await (await getKV()).get(KEY);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
