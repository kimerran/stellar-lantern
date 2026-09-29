// The D4 public playground shell (#183). Page frame only: the input (#184),
// the seeded gallery (#185) and the registry panel (#186) land in the regions
// below. Testnet only, hard-coded (DEMO_NETWORK) — NETWORKS.PUBLIC has no
// registry.

import type { ReactNode } from 'react';
import { TESTNET_REGISTRY_ID } from '@lantern/scanner';
import { DEMO_NETWORK } from './scan';
import { Examples } from './Examples';
import { RegistryPanel } from './RegistryPanel';
import { ScanPanel } from './ScanPanel';

const REGISTRY_URL = `https://stellar.expert/explorer/testnet/contract/${TESTNET_REGISTRY_ID}`;

function Region({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="rounded-2xl border border-outline-variant bg-surface-container-low p-5"
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold text-on-surface">
        {title}
      </h2>
      <div className="mt-2 text-sm text-on-surface-variant">{children}</div>
    </section>
  );
}

export function Playground() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-outline-variant">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <a href="/" className="flex items-center gap-2 font-semibold text-on-surface">
            <img src="/logo.jpg" alt="" width={28} height={28} className="rounded-md" />
            Lantern
          </a>
          <a href="/" className="text-sm text-primary hover:underline">
            ← Back to golantern.xyz
          </a>
        </div>
      </header>

      <div role="note" className="bg-primary-container px-4 py-2 text-center text-sm font-medium text-on-primary">
        Testnet demo — nothing here moves real funds.
      </div>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold text-on-surface sm:text-3xl">Scan a Stellar transaction</h1>
        <p className="mt-2 max-w-2xl text-on-surface-variant">
          The same scanner the Lantern wallet runs before you sign: a plain-language summary, a risk verdict and a check
          against the on-chain scam registry. No install, no key.
        </p>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <div className="grid gap-4 lg:col-span-2">
            <Region id="scan-input" title="Your transaction">
              <ScanPanel />
            </Region>
            <Region id="examples" title="Try an example">
              <Examples />
            </Region>
          </div>
          <Region id="registry" title="Scam registry">
            <RegistryPanel />
          </Region>
        </div>
      </main>

      <footer className="border-t border-outline-variant">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-4 text-xs text-on-surface-variant sm:flex-row sm:justify-between">
          <span>
            Lantern · Stellar {DEMO_NETWORK.id.toLowerCase()} · Each finished scan sends one anonymous count (risk,
            action, and pasted / composed / example). No transaction, address or amount, no cookie, nothing stored.{' '}
            <a href="/privacy-policy.html" className="underline hover:text-on-surface">
              Privacy
            </a>
          </span>
          <a href={REGISTRY_URL} target="_blank" rel="noopener noreferrer" className="break-all hover:underline">
            Registry contract {TESTNET_REGISTRY_ID}
          </a>
        </div>
      </footer>
    </div>
  );
}
