import type { NetworkConfig, NetworkId } from './constants';
import { NETWORKS } from './constants';
import type { Settings } from './types';

// Endpoint overrides let a user point the wallet at their own Horizon / Soroban
// RPC node (self-hosted, a paid provider, a local quickstart) instead of the
// baked-in public defaults — the "Advanced" section of the Settings hub (#110).
// Keyed by the lowercase network id the UI edits (testnet / public).
export interface EndpointOverrides {
  testnet?: string;
  public?: string;
}

function overrideKey(id: NetworkId): keyof EndpointOverrides {
  return id === 'TESTNET' ? 'testnet' : 'public';
}

// A trimmed override only counts if it's a non-empty HTTPS URL — plaintext
// `http://` is rejected so a MITM can't feed the wallet forged account /
// simulation data, EXCEPT `http://localhost` and `http://127.0.0.1` (with an
// optional port) which stay allowed for local dev quickstart nodes. A blank
// field (or whitespace) means "use the default", and any other non-HTTPS value
// falls back the same way — we never let a malformed or insecure value silently
// replace a working endpoint.
function cleanOverride(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (/^https:\/\//i.test(v)) return v;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(v)) return v;
  return undefined;
}

/**
 * Resolve the effective {@link NetworkConfig} for a network, layering any
 * Horizon / Soroban-RPC overrides from Settings on top of the pinned defaults.
 * Pure — the single chokepoint (App resolves `network` once and passes it to
 * every screen, so overrides reach both reads and the submit path).
 */
export function resolveNetworkConfig(settings: Settings, id: NetworkId = settings.network): NetworkConfig {
  const base = NETWORKS[id];
  const key = overrideKey(id);
  const horizon = cleanOverride(settings.horizonOverrides?.[key]);
  const rpc = cleanOverride(settings.rpcOverrides?.[key]);
  if (!horizon && !rpc) return base;
  return {
    ...base,
    ...(horizon ? { horizonUrl: horizon } : {}),
    // Only override the RPC when the base network actually supports Soroban —
    // never conjure an endpoint onto a network that has none (e.g. mainnet).
    ...(rpc && base.sorobanRpcUrl ? { sorobanRpcUrl: rpc } : {}),
  };
}
