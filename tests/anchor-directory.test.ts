import { describe, it, expect } from 'vitest';
import {
  ANCHORS,
  findAnchor,
  anchorsForNetwork,
  isValidHomeDomain,
} from '@core/anchor/directory';

describe('anchor directory', () => {
  it('has unique ids and well-formed, verified entries', () => {
    const ids = ANCHORS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ANCHORS) {
      expect(a.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/); // kebab slug
      expect(a.name).not.toBe('');
      expect(isValidHomeDomain(a.homeDomain)).toBe(true);
      expect(['testnet', 'public']).toContain(a.network);
      expect(a.assets.length).toBeGreaterThan(0);
    }
  });

  it('includes the SDF reference testnet anchor supporting USDC', () => {
    const sdf = findAnchor('sdf-testanchor');
    expect(sdf?.homeDomain).toBe('testanchor.stellar.org');
    expect(sdf?.network).toBe('testnet');
    expect(sdf?.assets).toContain('USDC');
    expect(sdf?.verified).toBe(true);
  });

  it('looks up anchors by id', () => {
    expect(findAnchor('sdf-testanchor')?.name).toBe('SDF Reference Anchor');
    expect(findAnchor('does-not-exist')).toBeUndefined();
  });

  it('filters anchors by network', () => {
    expect(anchorsForNetwork('testnet').every((a) => a.network === 'testnet')).toBe(true);
    expect(anchorsForNetwork('public').every((a) => a.network === 'public')).toBe(true);
    expect(anchorsForNetwork('testnet')).toContainEqual(findAnchor('sdf-testanchor'));
  });
});

describe('isValidHomeDomain', () => {
  it('accepts a bare host with a dot', () => {
    expect(isValidHomeDomain('testanchor.stellar.org')).toBe(true);
  });

  it('rejects schemes, paths, whitespace, and dotless hosts', () => {
    expect(isValidHomeDomain('https://testanchor.stellar.org')).toBe(false);
    expect(isValidHomeDomain('testanchor.stellar.org/path')).toBe(false);
    expect(isValidHomeDomain('has space.org')).toBe(false);
    expect(isValidHomeDomain('localhost')).toBe(false);
    expect(isValidHomeDomain('  ')).toBe(false);
  });
});
