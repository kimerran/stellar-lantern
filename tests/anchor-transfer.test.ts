import { describe, it, expect } from 'vitest';
import { summarizeAssetSupport, formatTransferLimits } from '@core/anchor/transfer';
import type { Sep24Info } from '@core/anchor/sep24';

const info = (deposit: Sep24Info['deposit'], withdraw: Sep24Info['withdraw']): Sep24Info => ({
  deposit,
  withdraw,
});

describe('summarizeAssetSupport', () => {
  it('merges deposit + withdraw into one per-asset row, sorted by code', () => {
    const out = summarizeAssetSupport(
      info(
        [
          { assetCode: 'USDC', enabled: true, minAmount: 1, maxAmount: 1000 },
          { assetCode: 'native', enabled: true },
        ],
        [{ assetCode: 'USDC', enabled: true, minAmount: 5 }],
      ),
    );
    // 'native' sorts before 'USDC' (localeCompare)
    expect(out.map((s) => s.assetCode)).toEqual(['native', 'USDC']);
    const xlm = out[0]!;
    expect(xlm).toMatchObject({ assetCode: 'native', canDeposit: true, canWithdraw: false });
    expect(xlm.withdraw).toBeUndefined();
    const usdc = out[1]!;
    expect(usdc).toMatchObject({ assetCode: 'USDC', canDeposit: true, canWithdraw: true });
    expect(usdc.deposit).toMatchObject({ maxAmount: 1000 });
    expect(usdc.withdraw).toMatchObject({ minAmount: 5 });
  });

  it('treats a disabled side as not-usable, and drops assets with nothing usable', () => {
    const out = summarizeAssetSupport(
      info(
        [
          { assetCode: 'ABC', enabled: false }, // deposit disabled, no withdraw → dropped
          { assetCode: 'USDC', enabled: false }, // deposit disabled…
        ],
        [{ assetCode: 'USDC', enabled: true }], // …but withdraw enabled → kept as withdraw-only
      ),
    );
    expect(out.map((s) => s.assetCode)).toEqual(['USDC']);
    expect(out[0]).toMatchObject({ canDeposit: false, canWithdraw: true });
  });

  it('returns an empty list when nothing is supported', () => {
    expect(summarizeAssetSupport(info([], []))).toEqual([]);
  });
});

describe('formatTransferLimits', () => {
  it('formats min+max, min-only, max-only, and none', () => {
    expect(formatTransferLimits({ assetCode: 'X', enabled: true, minAmount: 1, maxAmount: 1000 })).toBe('1–1,000');
    expect(formatTransferLimits({ assetCode: 'X', enabled: true, minAmount: 5 })).toBe('min 5');
    expect(formatTransferLimits({ assetCode: 'X', enabled: true, maxAmount: 2000 })).toBe('max 2,000');
    expect(formatTransferLimits({ assetCode: 'X', enabled: true })).toBeNull();
  });
});
