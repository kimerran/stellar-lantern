import { describe, it, expect } from 'vitest';
import { toHistoryItem, type RawOperation } from '@core/history/history';

const ME = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const OTHER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

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
