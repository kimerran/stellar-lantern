import { describe, it, expect } from 'vitest';
import { toHistoryItem, recentRecipients, type RawOperation } from '@core/history/history';
import type { HistoryItem } from '@shared/types';

const ME = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const OTHER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const A = 'GABC000000000000000000000000000000000000000000000000000A';
const B = 'GDEF000000000000000000000000000000000000000000000000000B';

const base = {
  id: '1',
  transaction_hash: 'abc',
  created_at: '2023-10-24T10:00:00Z',
  transaction_successful: true,
};

describe('toHistoryItem direction classification', () => {
  it('classifies an outgoing payment as sent', () => {
    const op: RawOperation = { ...base, type: 'payment', from: ME, to: OTHER, amount: '12.5', asset_type: 'native' };
    const item = toHistoryItem(op, ME);
    expect(item.direction).toBe('sent');
    expect(item.title).toBe('Sent XLM');
    expect(item.counterparty).toBe(OTHER);
    expect(item.signedAmount).toBe('-12.5');
  });

  it('classifies an incoming payment as received', () => {
    const op: RawOperation = { ...base, type: 'payment', from: OTHER, to: ME, amount: '3', asset_type: 'credit_alphanum4', asset_code: 'USDC' };
    const item = toHistoryItem(op, ME);
    expect(item.direction).toBe('received');
    expect(item.title).toBe('Received USDC');
    expect(item.assetCode).toBe('USDC');
    expect(item.signedAmount).toBe('+3');
  });

  it('classifies an incoming create_account as received', () => {
    const op: RawOperation = { ...base, type: 'create_account', funder: OTHER, account: ME, starting_balance: '100' };
    const item = toHistoryItem(op, ME);
    expect(item.direction).toBe('received');
    expect(item.signedAmount).toBe('+100');
    expect(item.counterparty).toBe(OTHER);
  });

  it('classifies an outgoing create_account as create', () => {
    const op: RawOperation = { ...base, type: 'create_account', funder: ME, account: OTHER, starting_balance: '2' };
    const item = toHistoryItem(op, ME);
    expect(item.direction).toBe('create');
    expect(item.title).toBe('Created Account');
    expect(item.signedAmount).toBe('-2');
  });

  it('classifies path payments as swap', () => {
    const op: RawOperation = { ...base, type: 'path_payment_strict_send', from: ME, to: OTHER, amount: '9', asset_type: 'native' };
    const item = toHistoryItem(op, ME);
    expect(item.direction).toBe('swap');
    expect(item.title).toBe('Swap');
  });
});

function historyItem(overrides: Partial<HistoryItem>): HistoryItem {
  return {
    id: '1',
    hash: 'h',
    direction: 'sent',
    title: 'Sent XLM',
    counterparty: OTHER,
    amount: '1',
    signedAmount: '-1',
    assetCode: 'XLM',
    createdAt: '2023-01-01T00:00:00Z',
    successful: true,
    ...overrides,
  };
}

describe('recentRecipients', () => {
  it('returns distinct sent-to addresses, newest first', () => {
    const items = [
      historyItem({ counterparty: A, createdAt: '2023-03-01T00:00:00Z' }),
      historyItem({ counterparty: B, createdAt: '2023-02-01T00:00:00Z' }),
      historyItem({ counterparty: A, createdAt: '2023-01-01T00:00:00Z' }), // older duplicate
    ];
    expect(recentRecipients(items)).toEqual([A, B]);
  });

  it('sorts by createdAt regardless of input order', () => {
    const items = [
      historyItem({ counterparty: A, createdAt: '2023-01-01T00:00:00Z' }),
      historyItem({ counterparty: B, createdAt: '2023-05-01T00:00:00Z' }),
      historyItem({ counterparty: A, createdAt: '2023-04-01T00:00:00Z' }),
    ];
    expect(recentRecipients(items)).toEqual([B, A]);
  });

  it('includes outgoing account creations but ignores incoming, swaps, and failures', () => {
    const items = [
      historyItem({ direction: 'create', counterparty: A, createdAt: '2023-04-01T00:00:00Z' }),
      historyItem({ direction: 'received', counterparty: B, createdAt: '2023-03-01T00:00:00Z' }),
      historyItem({ direction: 'swap', counterparty: B, createdAt: '2023-02-01T00:00:00Z' }),
      historyItem({ direction: 'sent', counterparty: B, successful: false, createdAt: '2023-01-01T00:00:00Z' }),
    ];
    expect(recentRecipients(items)).toEqual([A]);
  });

  it('skips null counterparties and respects the limit', () => {
    const items = [
      historyItem({ counterparty: A, createdAt: '2023-05-01T00:00:00Z' }),
      historyItem({ counterparty: null, createdAt: '2023-04-01T00:00:00Z' }),
      historyItem({ counterparty: B, createdAt: '2023-03-01T00:00:00Z' }),
      historyItem({ counterparty: OTHER, createdAt: '2023-02-01T00:00:00Z' }),
    ];
    expect(recentRecipients(items, 2)).toEqual([A, B]);
  });
});
