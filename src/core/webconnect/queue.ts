import type { WebConnectRequest } from './protocol';

// Web connect (#249): requests waiting for the user, one on screen at a time.
//
// Pure and in memory: it lives in the service worker, beside the ports it
// answers. If the worker restarts, the ports drop too and every page gets
// `connection_lost` from its relay, so nothing here survives a restart that
// could still be answered (nor is left half-approved).

/** At most this many waiting requests per origin; the next is answered `busy`. */
export const MAX_PENDING_PER_ORIGIN = 3;

export type ApprovalKind = 'connect' | 'sign';

export interface PendingApproval {
  /** Lantern's own id for the entry: what the approval window decides on. */
  entryId: string;
  kind: ApprovalKind;
  origin: string;
  /** The port and tab it came from: dropped when either goes away. */
  portId: number;
  tabId: number;
  request: WebConnectRequest;
  createdAt: number;
  /** Set when the approval window has fetched it: only a shown request is
   *  rejected when the window closes, never one that arrived as it closed. */
  shown?: boolean;
}

export class ApprovalQueue {
  private items: PendingApproval[] = [];

  /** False when the origin already has MAX_PENDING_PER_ORIGIN waiting. */
  add(entry: PendingApproval): boolean {
    if (this.items.filter((i) => i.origin === entry.origin).length >= MAX_PENDING_PER_ORIGIN)
      return false;
    this.items.push(entry);
    return true;
  }

  /** The request on screen: the oldest. */
  head(): PendingApproval | null {
    return this.items[0] ?? null;
  }

  get size(): number {
    return this.items.length;
  }

  /** Remove one entry by id, returning it (null if it already went away). */
  take(entryId: string): PendingApproval | null {
    const i = this.items.findIndex((x) => x.entryId === entryId);
    if (i < 0) return null;
    return this.items.splice(i, 1)[0]!;
  }

  /** Drop everything from a port (the page navigated or closed). */
  dropPort(portId: number): PendingApproval[] {
    return this.drop((i) => i.portId === portId);
  }

  /** Drop everything from a tab. */
  dropTab(tabId: number): PendingApproval[] {
    return this.drop((i) => i.tabId === tabId);
  }

  private drop(match: (i: PendingApproval) => boolean): PendingApproval[] {
    const gone = this.items.filter(match);
    this.items = this.items.filter((i) => !match(i));
    return gone;
  }
}
