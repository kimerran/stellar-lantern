import { describe, it, expect } from 'vitest';
import { resolveNetworkConfig } from '@shared/network';
import { NETWORKS } from '@shared/constants';
import type { Settings } from '@shared/types';

const base = (over: Partial<Settings> = {}): Settings => ({
  network: 'TESTNET',
  autoLockMinutes: 15,
  ...over,
});

describe('resolveNetworkConfig', () => {
  it('returns the pinned defaults when no overrides are set', () => {
    const cfg = resolveNetworkConfig(base());
    expect(cfg).toBe(NETWORKS.TESTNET); // same reference — no copy when nothing changes
  });

  it('applies a Horizon override for the active network', () => {
    const cfg = resolveNetworkConfig(base({ horizonOverrides: { testnet: 'https://my-horizon.example' } }));
    expect(cfg.horizonUrl).toBe('https://my-horizon.example');
    // untouched fields survive
    expect(cfg.passphrase).toBe(NETWORKS.TESTNET.passphrase);
    expect(cfg.sorobanRpcUrl).toBe(NETWORKS.TESTNET.sorobanRpcUrl);
  });

  it('applies a Soroban RPC override when the network supports Soroban', () => {
    const cfg = resolveNetworkConfig(base({ rpcOverrides: { testnet: 'https://my-rpc.example' } }));
    expect(cfg.sorobanRpcUrl).toBe('https://my-rpc.example');
    expect(cfg.horizonUrl).toBe(NETWORKS.TESTNET.horizonUrl);
  });

  it('ignores an RPC override on a network without Soroban support (mainnet)', () => {
    const cfg = resolveNetworkConfig(base({ network: 'PUBLIC', rpcOverrides: { public: 'https://nope.example' } }));
    expect(cfg.sorobanRpcUrl).toBeUndefined();
  });

  it('keys overrides by network — a testnet override does not leak to mainnet', () => {
    const settings = base({ horizonOverrides: { testnet: 'https://only-testnet.example' } });
    expect(resolveNetworkConfig(settings, 'PUBLIC').horizonUrl).toBe(NETWORKS.PUBLIC.horizonUrl);
    expect(resolveNetworkConfig(settings, 'TESTNET').horizonUrl).toBe('https://only-testnet.example');
  });

  it('treats blank / whitespace / non-URL overrides as "use the default"', () => {
    for (const bad of ['', '   ', 'not-a-url', 'ftp://x']) {
      const cfg = resolveNetworkConfig(base({ horizonOverrides: { testnet: bad } }));
      expect(cfg.horizonUrl).toBe(NETWORKS.TESTNET.horizonUrl);
    }
  });

  it('rejects a plaintext http:// override to a public host (falls back to default)', () => {
    const cfg = resolveNetworkConfig(base({ horizonOverrides: { testnet: 'http://my-horizon.example' } }));
    expect(cfg.horizonUrl).toBe(NETWORKS.TESTNET.horizonUrl);
  });

  it('applies an https:// override', () => {
    const cfg = resolveNetworkConfig(base({ horizonOverrides: { testnet: 'https://secure-horizon.example' } }));
    expect(cfg.horizonUrl).toBe('https://secure-horizon.example');
  });

  it('allows http://localhost (with port) for local dev quickstart nodes', () => {
    const cfg = resolveNetworkConfig(base({ horizonOverrides: { testnet: 'http://localhost:8000' } }));
    expect(cfg.horizonUrl).toBe('http://localhost:8000');
    const loopback = resolveNetworkConfig(base({ horizonOverrides: { testnet: 'http://127.0.0.1:8000' } }));
    expect(loopback.horizonUrl).toBe('http://127.0.0.1:8000');
  });

  it('resolves the network named in settings by default', () => {
    expect(resolveNetworkConfig(base({ network: 'PUBLIC' })).id).toBe('PUBLIC');
    expect(resolveNetworkConfig(base({ network: 'TESTNET' })).id).toBe('TESTNET');
  });
});
