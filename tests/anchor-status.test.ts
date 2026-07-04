import { describe, it, expect } from 'vitest';
import { describeTransferStatus } from '@core/anchor/status';

describe('describeTransferStatus', () => {
  it('maps a representative status from each kind', () => {
    expect(describeTransferStatus('pending_anchor').kind).toBe('pending');
    expect(describeTransferStatus('pending_user_transfer_start').kind).toBe('action-needed');
    expect(describeTransferStatus('completed').kind).toBe('done');
    expect(describeTransferStatus('error').kind).toBe('error');
  });

  it('treats incomplete/on_hold consistently with their buckets', () => {
    expect(describeTransferStatus('incomplete').kind).toBe('action-needed');
    expect(describeTransferStatus('pending_trust').kind).toBe('action-needed');
    expect(describeTransferStatus('on_hold').kind).toBe('pending');
    expect(describeTransferStatus('refunded').kind).toBe('done');
  });

  it('marks terminal states terminal and pending states non-terminal', () => {
    const terminal = ['completed', 'refunded', 'expired', 'error', 'no_market', 'too_small', 'too_large'];
    for (const s of terminal) {
      expect(describeTransferStatus(s).terminal, s).toBe(true);
    }

    const nonTerminal = [
      'incomplete',
      'pending_user_transfer_start',
      'pending_user_transfer_complete',
      'pending_external',
      'pending_anchor',
      'pending_stellar',
      'pending_trust',
      'pending_user',
      'on_hold',
    ];
    for (const s of nonTerminal) {
      expect(describeTransferStatus(s).terminal, s).toBe(false);
    }
  });

  it('gives every known status a non-empty label', () => {
    expect(describeTransferStatus('completed').label).toBe('Completed');
    expect(describeTransferStatus('pending_user_transfer_start').label.length).toBeGreaterThan(0);
  });

  it('falls back safely for unknown statuses instead of throwing', () => {
    expect(describeTransferStatus('some_future_status')).toEqual({
      label: 'Processing…',
      kind: 'pending',
      terminal: false,
    });
    expect(describeTransferStatus('')).toEqual({
      label: 'Processing…',
      kind: 'pending',
      terminal: false,
    });
  });
});
