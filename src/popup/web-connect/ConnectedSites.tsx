import { useCallback, useEffect, useState } from 'react';
import { sendMessage, type WebConnectGrant } from '@shared/messages';
import { truncateAddress } from '@shared/format';
import { Icon } from '../components/Icon';

// Web connect (#250): Settings → Connected sites. Every site the user
// connected, per account and network, with Revoke and Revoke all. Revoking
// tells the site's open tabs (a `change` event) and it must ask again.

export function ConnectedSites() {
  const [grants, setGrants] = useState<WebConnectGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await sendMessage({ type: 'WC_GRANTS' });
    if (res.ok) setGrants(res.data);
    else setError(res.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(origin?: string) {
    const res = await sendMessage({ type: 'WC_REVOKE', ...(origin ? { origin } : {}) });
    if (!res.ok) setError(res.error);
    await load();
  }

  if (grants === null) {
    return error ? <p className="px-4 py-3 text-label-md text-error">{error}</p> : null;
  }
  if (grants.length === 0) {
    return (
      <p className="px-4 py-3 text-label-md text-on-surface-variant">
        No sites are connected. When a website asks to connect, Lantern opens a window to ask you
        first.
      </p>
    );
  }
  return (
    <>
      <ul>
        {grants.map((g) => (
          <li
            key={`${g.origin}|${g.address}|${g.network}`}
            className="flex min-h-[52px] items-center gap-3 border-b border-outline-variant/30 px-4 py-3 last:border-b-0"
          >
            <Icon name="public" size={22} className="shrink-0 text-on-surface-variant" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-md text-on-surface">
                {g.origin.replace(/^https:\/\//, '')}
              </span>
              <span className="block truncate font-mono text-label-sm text-on-surface-variant">
                {truncateAddress(g.address, 4, 4)} ·{' '}
                {g.network === 'PUBLIC' ? 'Mainnet' : 'Testnet'}
              </span>
            </span>
            <button
              onClick={() => void revoke(g.origin)}
              className="shrink-0 rounded-full border border-outline px-3 py-1 text-label-sm text-on-surface-variant active:scale-95"
              aria-label={`Disconnect ${g.origin}`}
            >
              Disconnect
            </button>
          </li>
        ))}
      </ul>
      {grants.length > 1 && (
        <button
          onClick={() => void revoke()}
          className="flex w-full min-h-[44px] items-center justify-center text-label-md text-error hover:bg-error/10"
        >
          Disconnect all
        </button>
      )}
      {error && <p className="px-4 pb-3 text-label-md text-error">{error}</p>}
    </>
  );
}
