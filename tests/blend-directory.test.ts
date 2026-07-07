import { describe, it, expect } from 'vitest';
import {
  BLEND_POOLS,
  findBlendPool,
  blendPoolsForNetwork,
  findReserve,
} from '@core/blend/directory';
import { isValidContractId } from '@core/wallet/wallet';

describe('Blend pool directory', () => {
  it('every pool + reserve entry is well-formed', () => {
    expect(BLEND_POOLS.length).toBeGreaterThan(0);
    for (const p of BLEND_POOLS) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(isValidContractId(p.poolId)).toBe(true);
      expect(['testnet', 'public']).toContain(p.network);
      expect(p.reserves.length).toBeGreaterThan(0);
      for (const r of p.reserves) {
        expect(r.code.trim()).not.toBe('');
        expect(isValidContractId(r.assetId)).toBe(true);
        expect(r.decimals).toBeGreaterThanOrEqual(0);
      }
      // No duplicate reserve codes within a pool.
      const codes = p.reserves.map((r) => r.code.toUpperCase());
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it('ships a verified testnet pool supporting USDC and XLM', () => {
    const testnet = blendPoolsForNetwork('testnet');
    expect(testnet.length).toBeGreaterThan(0);
    const pool = testnet[0]!;
    expect(pool.verified).toBe(true);
    expect(pool.reserves.map((r) => r.code).sort()).toEqual(['USDC', 'XLM']);
  });

  it('looks up a pool by id (hit and miss)', () => {
    const id = BLEND_POOLS[0]!.id;
    expect(findBlendPool(id)?.id).toBe(id);
    expect(findBlendPool('does-not-exist')).toBeUndefined();
  });

  it('filters by network', () => {
    expect(blendPoolsForNetwork('public')).toEqual([]);
    expect(blendPoolsForNetwork('testnet').every((p) => p.network === 'testnet')).toBe(true);
  });

  it('finds a reserve by code, case-insensitively', () => {
    const pool = BLEND_POOLS[0]!;
    expect(findReserve(pool, 'usdc')?.code).toBe('USDC');
    expect(findReserve(pool, 'XLM')?.code).toBe('XLM');
    expect(findReserve(pool, 'DOGE')).toBeUndefined();
  });
});
