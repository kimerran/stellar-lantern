// The pending "Open in Lantern" link (#263), held in memory only.
//
// Android can hand the app a link before React has mounted (cold start) or
// while the wallet is locked. The link waits here until the unlocked wallet
// takes it; it is never persisted, so a link doesn't outlive the process.
// Only the latest link counts: a newer one replaces one not yet taken.

import { parseDeepLink, type DeepLink } from '@core/miniapps/deep-link';

export interface PendingDeepLink {
  /** Increments per link, so the same URL delivered twice still re-opens. */
  id: number;
  link: DeepLink;
}

let pending: PendingDeepLink | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

/** Queue a raw URL from Android. Anything not a `lantern://open` link is ignored. */
export function receiveDeepLink(raw: string | undefined | null): void {
  if (!raw) return;
  const link = parseDeepLink(raw);
  if (!link) return;
  pending = { id: nextId++, link };
  for (const fn of listeners) fn();
}

export function peekDeepLink(): PendingDeepLink | null {
  return pending;
}

/** Take the pending link (if it is still `id`) so it is handled once. */
export function takeDeepLink(id: number): void {
  if (pending?.id === id) pending = null;
}

export function onDeepLink(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
