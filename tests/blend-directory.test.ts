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

  // #109 — Lantern's own Blend pool.
  it('ships a Lantern-operated testnet pool with USDC + XLM reserves', () => {
    const lantern = findBlendPool('lantern-earn');
    expect(lantern).toBeDefined();
    expect(lantern!.lantern).toBe(true);
    expect(lantern!.verified).toBe(true);
    expect(lantern!.network).toBe('testnet');
    expect(lantern!.reserves.map((r) => r.code).sort()).toEqual(['USDC', 'XLM']);
    expect(isValidContractId(lantern!.poolId)).toBe(true);
  });

  it('orders Lantern pools first in the Earn picker, ahead of third-party pools', () => {
    const testnet = blendPoolsForNetwork('testnet');
    expect(testnet[0]!.lantern).toBe(true);
    // A listed third-party pool still appears (no ABI regression), just after ours.
    const thirdParty = testnet.find((p) => !p.lantern);
    expect(thirdParty).toBeDefined();
    expect(testnet.indexOf(thirdParty!)).toBeGreaterThan(0);
  });

  it('brands exactly the Lantern-operated pools (third-party pools are not flagged)', () => {
    for (const p of BLEND_POOLS) {
      if (p.id === 'lantern-earn') expect(p.lantern).toBe(true);
      else expect(Boolean(p.lantern)).toBe(false);
    }
  });

  it('never ships a mainnet placeholder pool (#109: no fake addresses)', () => {
    expect(blendPoolsForNetwork('public')).toEqual([]);
  });
});
