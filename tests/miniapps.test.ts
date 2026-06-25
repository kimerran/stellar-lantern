import { describe, it, expect } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { MINI_APPS, getMiniApp } from '@core/miniapps/directory';
import { buildTransferXdr } from '@core/stellar/tx';
import { scan, DEMO_FLAGGED_ADDRESSES } from '@core/scan/engine';

// The mini-app browser is a demo mock, but its data and the broker→scan wiring
// it depends on are exercised here so the demo can't silently regress.
describe('mini-app directory', () => {
  it('features blockhub.academy as a verified app', () => {
    const app = getMiniApp('blockhub-academy');
    expect(app).toBeDefined();
    expect(app!.origin).toBe('https://blockhub.academy');
    expect(app!.verified).toBe(true);
    expect(app!.featured).toBe(true);
  });

  it('every directory entry has a launchable https origin', () => {
    for (const app of MINI_APPS) {
      expect(app.origin).toMatch(/^https:\/\//);
      expect(app.permissions.networks.length).toBeGreaterThan(0);
    }
  });
});

describe('mini-app signature requests are scanned', () => {
  const me = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
  const flagged = [...DEMO_FLAGGED_ADDRESSES][0]!;

  function requestXdr(destination: string, amount: string) {
    return buildTransferXdr({
      sourceAccountId: me,
      sourceSequence: '0',
      networkPassphrase: Networks.TESTNET,
      baseFee: '100',
      destination,
      destinationFunded: true,
      asset: { isNative: true },
      amount,
    });
  }

  it('blocks a request that pays a reported address', () => {
    const v = scan({
      xdr: requestXdr(flagged, '4500'),
      networkPassphrase: Networks.TESTNET,
      context: { network: 'TESTNET', fromAddress: me, destinationFunded: true, origin: 'https://blockhub.academy' },
    });
    expect(v.risk).toBe('high');
    expect(v.action).toBe('block_confirm');
    expect(v.reasons.some((r) => r.code === 'reported_address')).toBe(true);
  });

  it('allows an ordinary request', () => {
    const v = scan({
      xdr: requestXdr(me, '25'),
      networkPassphrase: Networks.TESTNET,
      context: { network: 'TESTNET', fromAddress: me, destinationFunded: true, origin: 'https://blockhub.academy' },
    });
    expect(v.action).toBe('allow');
  });
});
