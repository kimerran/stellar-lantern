import { useCallback, useEffect, useState } from 'react';
import { sendMessage, type WebConnectGrant } from '@shared/messages';
import { setSettings } from '@shared/storage';
import { truncateAddress } from '@shared/format';
import { Icon } from '../components/Icon';

// Web connect (#250): Settings → Connected sites. Every site the user
// connected, per account and network, with Revoke and Revoke all. Revoking
// tells the site's open tabs (a `change` event) and it must ask again.
//
// Above the list, "Let websites connect to Lantern" (#247, on by default). Off,
// Lantern answers every web page as if it weren't installed; the grants stay,
// so turning it back on restores them.

export function ConnectedSites({ websitesOff }: { websitesOff: boolean }) {
  return (
    <>
      <WebsitesSwitch off={websitesOff} />
      <div className="border-t border-outline-variant/30">
        <SiteList />
      </div>
    </>
  );
}

function WebsitesSwitch({ off }: { off: boolean }) {
  const on = !off;
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => void setSettings({ webConnectDisabled: on })}
      className="flex w-full min-h-[52px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-variant active:scale-[0.99]"
    >
      <Icon name="language" size={22} className="shrink-0 text-on-surface-variant" />
      <span className="min-w-0 flex-1">
        <span className="block text-body-md text-on-surface">Let websites connect to Lantern</span>
        <span className="block text-label-md text-on-surface-variant">
          {on
            ? 'Websites can find Lantern and ask to connect. Lantern asks you about every request.'
            : 'Websites see Lantern as not installed, and every request is refused.'}
        </span>
      </span>
      <span
        aria-hidden
        className={`ml-2 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${on ? 'bg-primary' : 'bg-outline-variant'}`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-surface transition-transform ${on ? 'translate-x-5' : ''}`}
        />
      </span>
    </button>
  );
}

function SiteList() {
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
