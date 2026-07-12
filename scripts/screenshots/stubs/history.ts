// Stub for @core/history/history in the screenshot harness.
import type { HistoryPage } from '@shared/types';
import { HISTORY_ITEMS } from '../fixtures';

export async function fetchHistory(): Promise<HistoryPage> {
  return { items: HISTORY_ITEMS, nextCursor: null };
}
