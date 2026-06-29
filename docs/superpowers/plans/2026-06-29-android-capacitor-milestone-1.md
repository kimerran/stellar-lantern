# Android (Capacitor) Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a debug Android APK that boots the existing Lantern wallet UI, with storage and messaging seams swapped for mobile, built and uploaded by CI.

**Architecture:** Keep the Chrome-extension build untouched. Add a parallel plain-web Vite build that Capacitor wraps into an Android APK. Two extension seams get runtime adapters: storage (`chrome.storage` → `@capacitor/preferences`) and messaging (no service worker on mobile → an in-process handler extracted from the background worker, loaded via dynamic import so the extension popup bundle stays clean).

**Tech Stack:** Capacitor 8 (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/preferences`), Vite 6, React 18, TypeScript, Vitest, GitHub Actions, Gradle/JDK 17.

## Global Constraints

- Min Android SDK: 23 (Capacitor default) — accepted for the prototype.
- `appId`: `com.lantern.wallet`; `appName`: `Lantern`; Capacitor `webDir`: `dist`.
- The existing extension build (`npm run build`) and test suite (`npm test`) MUST stay green after every task.
- No `chrome.*` access on the native path; all platform-specific access goes behind `isNativePlatform()` from `@shared/kv`.
- Keys never persisted in plaintext; the vault stays encrypted at rest (no change to crypto).
- Backward compatibility: existing extension installs store the vault as an object in `chrome.storage.local`; the new storage layer must still read those.
- Path aliases in use: `@core`, `@shared`, `@popup`.
- Capacitor `android/` Gradle project is committed; Gradle build outputs are gitignored.

---

### Task 1: Capacitor dependencies and config

**Files:**
- Modify: `package.json` (dependencies + scripts)
- Create: `capacitor.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `@capacitor/preferences` available for import in later tasks; npm scripts `build:mobile` and `cap:sync` (script bodies finalized in Task 5/6 but added here).

- [ ] **Step 1: Install Capacitor packages**

Run:
```bash
npm install @capacitor/core@^8 @capacitor/preferences@^8
npm install -D @capacitor/cli@^8 @capacitor/android@^8
```
Expected: packages added to `package.json`, `package-lock.json` updated, no errors.

- [ ] **Step 2: Add npm scripts**

Edit `package.json` `scripts` to add (keep existing entries):
```json
"build:mobile": "tsc --noEmit && vite build --config vite.config.mobile.ts",
"cap:sync": "npx cap sync android"
```

- [ ] **Step 3: Create `capacitor.config.ts`**

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lantern.wallet',
  appName: 'Lantern',
  webDir: 'dist',
};

export default config;
```

- [ ] **Step 4: Verify the extension build and tests still pass**

Run: `npm run build && npm test`
Expected: extension build succeeds; all existing vitest suites PASS. (Adding deps must not break anything.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json capacitor.config.ts
git commit -m "chore: add Capacitor 8 deps and config for Android"
```

---

### Task 2: Storage seam — key-value port and adapter

**Files:**
- Create: `src/shared/kv.ts`
- Modify: `src/shared/storage.ts` (route through `kv` instead of `chrome.storage` directly)
- Test: `tests/storage.test.ts`

**Interfaces:**
- Consumes: `@capacitor/preferences` (Task 1).
- Produces:
  - `src/shared/kv.ts`: `interface KV { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }`; `function isNativePlatform(): boolean`; `function getKV(): Promise<KV>`; `function __setKV(impl: KV | null): void` (test hook).
  - `src/shared/storage.ts`: unchanged public API — `getVault(): Promise<StoredVault | null>`, `setVault(v: StoredVault): Promise<void>`, `clearVault(): Promise<void>`, `getSettings(): Promise<Settings>`, `setSettings(patch: Partial<Settings>): Promise<Settings>`, `onSettingsChanged(cb: (s: Settings) => void): () => void`.

- [ ] **Step 1: Write the failing test**

Create `tests/storage.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { getVault, setVault, clearVault, getSettings, setSettings } from '@shared/storage';
import type { StoredVault } from '@shared/types';

function memoryKV(): KV {
  const store = new Map<string, string>();
  return {
    get: async (k) => (store.has(k) ? store.get(k)! : null),
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
}

const VAULT: StoredVault = {
  version: 1,
  address: 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6',
  cipher: {
    algorithm: 'AES-GCM', kdf: 'PBKDF2', salt: 'c2FsdA==', iv: 'aXY=',
    iterations: 600000, ciphertext: 'Y2lwaGVy',
  },
};

describe('storage over the kv port', () => {
  beforeEach(() => __setKV(memoryKV()));

  it('returns null when no vault is stored', async () => {
    expect(await getVault()).toBeNull();
  });

  it('round-trips the vault through the kv port', async () => {
    await setVault(VAULT);
    expect(await getVault()).toEqual(VAULT);
    await clearVault();
    expect(await getVault()).toBeNull();
  });

  it('returns default settings and merges patches', async () => {
    const defaults = await getSettings();
    expect(defaults.network).toBe('TESTNET');
    expect(defaults.autoLockMinutes).toBe(15);
    const next = await setSettings({ network: 'PUBLIC' });
    expect(next.network).toBe('PUBLIC');
    expect((await getSettings()).network).toBe('PUBLIC');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/storage.test.ts`
Expected: FAIL — `@shared/kv` has no `__setKV`/`KV` export yet.

- [ ] **Step 3: Create `src/shared/kv.ts`**

```ts
// Platform-selected key-value port. The extension uses chrome.storage.local;
// native (Capacitor) uses @capacitor/preferences. Values are always strings
// so both backends behave identically (Preferences only stores strings).

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function isNativePlatform(): boolean {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === 'function' ? cap.isNativePlatform() : false;
}

// chrome.storage previously stored objects; return them as JSON strings so the
// storage layer can JSON.parse uniformly (backward compatible with old vaults).
const chromeKV: KV = {
  async get(key) {
    const res = await chrome.storage.local.get(key);
    const v = (res as Record<string, unknown>)[key];
    if (v === undefined) return null;
    return typeof v === 'string' ? v : JSON.stringify(v);
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async remove(key) {
    await chrome.storage.local.remove(key);
  },
};

let cached: KV | null = null;

export async function getKV(): Promise<KV> {
  if (cached) return cached;
  if (isNativePlatform()) {
    const { Preferences } = await import('@capacitor/preferences');
    cached = {
      get: async (key) => (await Preferences.get({ key })).value,
      set: async (key, value) => void (await Preferences.set({ key, value })),
      remove: async (key) => void (await Preferences.remove({ key })),
    };
  } else {
    cached = chromeKV;
  }
  return cached;
}

// Test hook — inject an in-memory KV and bypass platform detection.
export function __setKV(impl: KV | null): void {
  cached = impl;
}
```

- [ ] **Step 4: Rewrite `src/shared/storage.ts` to use the port**

```ts
import type { Settings, StoredVault } from './types';
import { DEFAULT_AUTOLOCK_MINUTES, DEFAULT_NETWORK } from './constants';
import { getKV, isNativePlatform } from './kv';

// Only the encrypted vault and non-secret settings live here (SPEC §7).
const VAULT_KEY = 'lantern.vault';
const SETTINGS_KEY = 'lantern.settings';

function parse<T>(raw: string | null): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function getVault(): Promise<StoredVault | null> {
  const kv = await getKV();
  return parse<StoredVault>(await kv.get(VAULT_KEY));
}

export async function setVault(vault: StoredVault): Promise<void> {
  const kv = await getKV();
  await kv.set(VAULT_KEY, JSON.stringify(vault));
}

export async function clearVault(): Promise<void> {
  const kv = await getKV();
  await kv.remove(VAULT_KEY);
}

const DEFAULT_SETTINGS: Settings = {
  network: DEFAULT_NETWORK,
  autoLockMinutes: DEFAULT_AUTOLOCK_MINUTES,
};

export async function getSettings(): Promise<Settings> {
  const kv = await getKV();
  return { ...DEFAULT_SETTINGS, ...(parse<Partial<Settings>>(await kv.get(SETTINGS_KEY)) ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const kv = await getKV();
  const next = { ...(await getSettings()), ...patch };
  await kv.set(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

// On native there is a single process and no storage-change events; the UI
// re-reads settings on demand, so the subscription is a no-op there.
export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  if (isNativePlatform()) return () => {};
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string,
  ) => {
    if (area === 'local' && changes[SETTINGS_KEY]) {
      const parsed = parse<Partial<Settings>>(
        typeof changes[SETTINGS_KEY].newValue === 'string'
          ? (changes[SETTINGS_KEY].newValue as string)
          : JSON.stringify(changes[SETTINGS_KEY].newValue),
      );
      cb({ ...DEFAULT_SETTINGS, ...(parsed ?? {}) });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/storage.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 6: Verify the extension build and full suite still pass**

Run: `npm run build && npm test`
Expected: extension build succeeds; all suites PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/kv.ts src/shared/storage.ts tests/storage.test.ts
git commit -m "feat: platform key-value port for storage (extension + Capacitor)"
```

---

### Task 3: Messaging seam — extract in-process handler

**Files:**
- Create: `src/core/session/handler.ts`
- Modify: `src/background/index.ts` (shrink to chrome listeners over the handler)
- Test: `tests/session.test.ts`

**Interfaces:**
- Consumes: `getSettings/getVault/setVault/clearVault` from `@shared/storage`; `__setKV` from `@shared/kv` (tests); message types from `@shared/messages`; crypto + wallet from `@core/*`.
- Produces: `src/core/session/handler.ts` exporting `handle(req: Request): Promise<Result<unknown>>` (never throws — maps errors to `Result`) and `lock(): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/session.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { handle, lock } from '@core/session/handler';

function memoryKV(): KV {
  const store = new Map<string, string>();
  return {
    get: async (k) => (store.has(k) ? store.get(k)! : null),
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
}

describe('in-process session handler', () => {
  beforeEach(() => {
    __setKV(memoryKV());
    lock();
  });

  it('reports uninitialized + locked before any wallet exists', async () => {
    const res = await handle({ type: 'GET_STATUS' });
    expect(res).toEqual({ ok: true, data: { initialized: false, locked: true, address: null } });
  });

  it('creates a wallet, then unlock round-trips', async () => {
    const gen = await handle({ type: 'GENERATE_MNEMONIC', strength: 128 });
    if (!gen.ok) throw new Error('mnemonic gen failed');
    const mnemonic = (gen.data as { mnemonic: string }).mnemonic;

    const created = await handle({ type: 'CREATE_WALLET', mnemonic, password: 'pw-correct' });
    expect(created.ok).toBe(true);
    const address = (created.data as { address: string }).address;
    expect(address).toMatch(/^G/);

    const afterCreate = await handle({ type: 'GET_STATUS' });
    expect(afterCreate.ok && afterCreate.data).toMatchObject({ initialized: true, locked: false });

    lock();
    const locked = await handle({ type: 'GET_STATUS' });
    expect(locked.ok && (locked.data as { locked: boolean }).locked).toBe(true);

    const bad = await handle({ type: 'UNLOCK', password: 'wrong' });
    expect(bad).toMatchObject({ ok: false, code: 'BAD_PASSWORD' });

    const good = await handle({ type: 'UNLOCK', password: 'pw-correct' });
    expect(good.ok && (good.data as { address: string }).address).toBe(address);
  });

  it('rejects signing while locked', async () => {
    const res = await handle({
      type: 'SIGN_AND_SUBMIT', xdr: 'x', networkPassphrase: 'p', horizonUrl: 'h',
    });
    expect(res).toMatchObject({ ok: false, code: 'LOCKED' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/session.test.ts`
Expected: FAIL — `@core/session/handler` does not exist.

- [ ] **Step 3: Create `src/core/session/handler.ts`**

Move the session logic out of the worker. This is the current `background/index.ts` logic minus the chrome listeners, with a non-throwing `handle` wrapper:
```ts
import '@shared/polyfills'; // must be first — sets Buffer/process/global before Stellar loads
import { Keypair, Horizon, TransactionBuilder } from '@stellar/stellar-sdk';
import type { Request, Result, ResponseMap } from '@shared/messages';
import { getSettings, getVault, setVault, clearVault } from '@shared/storage';
import { encryptSecret, decryptSecret, WrongPasswordError } from '@core/crypto/vault';
import {
  generateMnemonic,
  importFromInput,
  keypairFromMnemonic,
  keypairFromStoredSecret,
  InvalidImportError,
} from '@core/wallet/wallet';

// The decrypted keypair lives ONLY here, never in storage, never in the popup.
interface UnlockedSession {
  keypair: Keypair;
  unlockedAt: number;
}

let session: UnlockedSession | null = null;
let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

async function armAutoLock(): Promise<void> {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  const { autoLockMinutes } = await getSettings();
  autoLockTimer = setTimeout(() => lock(), autoLockMinutes * 60_000);
}

export function lock(): void {
  session = null;
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

function ok<K extends keyof ResponseMap>(data: ResponseMap[K]): Result<ResponseMap[K]> {
  return { ok: true, data };
}

async function dispatch(req: Request): Promise<Result<unknown>> {
  switch (req.type) {
    case 'GET_STATUS': {
      const vault = await getVault();
      return ok<'GET_STATUS'>({
        initialized: vault !== null,
        locked: session === null,
        address: session?.keypair.publicKey() ?? vault?.address ?? null,
      });
    }

    case 'GENERATE_MNEMONIC': {
      return ok<'GENERATE_MNEMONIC'>({ mnemonic: generateMnemonic(req.strength) });
    }

    case 'CREATE_WALLET': {
      const keypair = keypairFromMnemonic(req.mnemonic);
      const cipher = await encryptSecret(req.mnemonic, req.password);
      const address = keypair.publicKey();
      await setVault({ version: 1, address, cipher });
      session = { keypair, unlockedAt: Date.now() };
      await armAutoLock();
      return ok<'CREATE_WALLET'>({ address });
    }

    case 'IMPORT_WALLET': {
      const { keypair, secretToStore } = importFromInput(req.input);
      const cipher = await encryptSecret(secretToStore, req.password);
      const address = keypair.publicKey();
      await setVault({ version: 1, address, cipher });
      session = { keypair, unlockedAt: Date.now() };
      await armAutoLock();
      return ok<'IMPORT_WALLET'>({ address });
    }

    case 'UNLOCK': {
      const vault = await getVault();
      if (!vault) return { ok: false, error: 'No wallet found.', code: 'NOT_INITIALIZED' };
      const secret = await decryptSecret(vault.cipher, req.password);
      const keypair = keypairFromStoredSecret(secret);
      session = { keypair, unlockedAt: Date.now() };
      await armAutoLock();
      return ok<'UNLOCK'>({ address: keypair.publicKey() });
    }

    case 'LOCK': {
      lock();
      return ok<'LOCK'>({ ok: true });
    }

    case 'PING': {
      if (session) await armAutoLock();
      return ok<'PING'>({ ok: true });
    }

    case 'SIGN_AND_SUBMIT': {
      if (!session) {
        return { ok: false, error: 'Wallet is locked.', code: 'LOCKED' };
      }
      await armAutoLock();
      const tx = TransactionBuilder.fromXDR(req.xdr, req.networkPassphrase);
      tx.sign(session.keypair);
      const server = new Horizon.Server(req.horizonUrl);
      const res = await server.submitTransaction(tx);
      return ok<'SIGN_AND_SUBMIT'>({ hash: res.hash });
    }

    case 'RESET_WALLET': {
      lock();
      await clearVault();
      return ok<'RESET_WALLET'>({ ok: true });
    }
  }
}

// Public entry point. Never throws — converts errors to readable Results so
// both the service worker and the in-process (mobile) caller can rely on it.
export async function handle(req: Request): Promise<Result<unknown>> {
  try {
    return await dispatch(req);
  } catch (err) {
    return toErrorResult(err);
  }
}

// Convert thrown errors into readable Results. Never leak secrets or raw XDR.
function toErrorResult(err: unknown): Result<never> {
  if (err instanceof WrongPasswordError) {
    return { ok: false, error: 'Incorrect password.', code: 'BAD_PASSWORD' };
  }
  if (err instanceof InvalidImportError) {
    return { ok: false, error: err.message, code: 'VALIDATION' };
  }
  const horizonReason = extractHorizonError(err);
  if (horizonReason) return { ok: false, error: horizonReason, code: 'NETWORK' };
  const message = err instanceof Error ? err.message : 'Something went wrong.';
  return { ok: false, error: message };
}

function extractHorizonError(err: unknown): string | null {
  const e = err as {
    response?: { data?: { extras?: { result_codes?: { operations?: string[]; transaction?: string } } } };
  };
  const codes = e?.response?.data?.extras?.result_codes;
  if (!codes) return null;
  const op = codes.operations?.find((c) => c && c !== 'op_success');
  const reason = op ?? codes.transaction;
  if (!reason) return null;
  return humanizeResultCode(reason);
}

function humanizeResultCode(code: string): string {
  const map: Record<string, string> = {
    op_underfunded: 'Insufficient balance for this payment.',
    op_no_destination: 'The destination account does not exist.',
    op_no_trust: 'The destination has no trustline for this asset.',
    op_line_full: "The destination's balance limit for this asset is full.",
    op_low_reserve: 'Amount is below the minimum account reserve.',
    tx_insufficient_fee: 'Network fee too low — please retry.',
    tx_bad_seq: 'Transaction sequence was stale — please retry.',
  };
  return map[code] ?? `Transaction failed: ${code}`;
}
```

- [ ] **Step 4: Rewrite `src/background/index.ts` to use the handler**

```ts
import '@shared/polyfills'; // must be first — sets Buffer/process/global before Stellar loads
import type { Request } from '@shared/messages';
import { handle, lock } from '@core/session/handler';

// The service worker is now a thin transport: it routes chrome messages to the
// shared in-process handler (which holds the unlocked session in worker memory).
chrome.runtime.onMessage.addListener((req: Request, _sender, sendResponse) => {
  handle(req).then(sendResponse);
  return true; // keep the message channel open for the async response
});

// Lock on install/startup so a fresh browser session always requires unlock.
chrome.runtime.onStartup.addListener(() => lock());
chrome.runtime.onInstalled.addListener(() => lock());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/session.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 6: Verify the extension build and full suite still pass**

Run: `npm run build && npm test`
Expected: extension build succeeds; all suites PASS. (Confirms the worker still wires up correctly after extraction.)

- [ ] **Step 7: Commit**

```bash
git add src/core/session/handler.ts src/background/index.ts tests/session.test.ts
git commit -m "refactor: extract in-process session handler from background worker"
```

---

### Task 4: Platform-aware `sendMessage`

**Files:**
- Modify: `src/shared/messages.ts`
- Test: `tests/messages.test.ts`

**Interfaces:**
- Consumes: `isNativePlatform` from `@shared/kv`; `handle` from `@core/session/handler` (dynamic import).
- Produces: `sendMessage<R extends Request>(req: R): Promise<ResponseFor<R>>` — unchanged signature; native branch calls `handle` directly, extension branch calls `chrome.runtime.sendMessage`.

- [ ] **Step 1: Write the failing test**

Create `tests/messages.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __setKV, type KV } from '@shared/kv';
import { sendMessage } from '@shared/messages';
import { lock } from '@core/session/handler';

function memoryKV(): KV {
  const store = new Map<string, string>();
  return {
    get: async (k) => (store.has(k) ? store.get(k)! : null),
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  };
}

describe('sendMessage native branch', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).Capacitor = { isNativePlatform: () => true };
    __setKV(memoryKV());
    lock();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).Capacitor;
  });

  it('routes to the in-process handler when running natively', async () => {
    const res = await sendMessage({ type: 'GET_STATUS' });
    expect(res).toEqual({ ok: true, data: { initialized: false, locked: true, address: null } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/messages.test.ts`
Expected: FAIL — `sendMessage` still calls `chrome.runtime.sendMessage` (throws: `chrome` undefined in node env).

- [ ] **Step 3: Update `sendMessage` in `src/shared/messages.ts`**

Replace the existing `sendMessage` function (keep all type exports above it unchanged) with:
```ts
import { isNativePlatform } from './kv';

// On the extension, messages go to the background worker. On native there is no
// worker — load the in-process handler lazily so its wallet logic is split into
// a chunk the extension popup bundle never loads.
export async function sendMessage<R extends Request>(req: R): Promise<ResponseFor<R>> {
  if (isNativePlatform()) {
    const { handle } = await import('@core/session/handler');
    return (await handle(req)) as ResponseFor<R>;
  }
  return (await chrome.runtime.sendMessage(req)) as ResponseFor<R>;
}
```

Note: add the `import { isNativePlatform } from './kv';` line at the top of the file with the other imports (the file currently has no imports — place it on line 1).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the extension build and full suite still pass**

Run: `npm run build && npm test`
Expected: extension build succeeds; all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/messages.ts tests/messages.test.ts
git commit -m "feat: route sendMessage to in-process handler on native"
```

---

### Task 5: Mobile Vite build

**Files:**
- Create: `vite.config.mobile.ts`

**Interfaces:**
- Consumes: root `index.html` (existing web entry); npm script `build:mobile` (Task 1).
- Produces: `dist/index.html` + assets — Capacitor's `webDir`.

- [ ] **Step 1: Create `vite.config.mobile.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath, URL } from 'node:url';

// Plain-web build for Capacitor. Mirrors vite.config.ts but drops the CRX/MV3
// plugin and manifest — the Android shell wraps the bundle from `dist/`.
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
  ],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@popup': fileURLToPath(new URL('./src/popup', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    sourcemap: true,
  },
});
```

- [ ] **Step 2: Run the mobile build**

Run: `npm run build:mobile`
Expected: `tsc --noEmit` passes, then Vite writes `dist/index.html` and `dist/assets/*`.

- [ ] **Step 3: Verify the output exists**

Run: `test -f dist/index.html && echo OK`
Expected: prints `OK`.

- [ ] **Step 4: Confirm the extension build still works (separate output)**

Run: `npm run build`
Expected: extension build succeeds (writes its own output, unaffected by `dist/`).

- [ ] **Step 5: Commit**

```bash
git add vite.config.mobile.ts
git commit -m "feat: plain-web Vite build for Capacitor (dist/)"
```

Note: `dist/` is already covered by the existing `.gitignore` (verify it lists `dist`); if not, add `dist/` to `.gitignore` and include it in this commit.

---

### Task 6: Add and commit the Android project

**Files:**
- Create: `android/**` (generated by Capacitor)
- Modify: `.gitignore` (ignore Gradle build outputs)

**Interfaces:**
- Consumes: `capacitor.config.ts` (Task 1), `dist/` (Task 5).
- Produces: committed `android/` Gradle project with `android/gradlew` and `android/app/build.gradle`; CI builds `android/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 1: Generate the Android project**

Run:
```bash
npm run build:mobile
npx cap add android
```
Expected: `android/` directory created; `npx cap add` reports success and copies web assets.

- [ ] **Step 2: Sync web assets into the Android project**

Run: `npm run cap:sync`
Expected: `cap sync android` completes without errors.

- [ ] **Step 3: Ignore Gradle build outputs**

Append to `.gitignore`:
```
# Capacitor / Android build outputs
android/app/build/
android/build/
android/.gradle/
android/local.properties
android/app/src/main/assets/public/
android/capacitor-cordova-android-plugins/
```

- [ ] **Step 4: (Optional) Local APK build if the Android SDK is installed**

Run: `cd android && ./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL`; APK at `android/app/build/outputs/apk/debug/app-debug.apk`. If no Android SDK locally, skip — CI (Task 7) is the proof.

- [ ] **Step 5: Verify the committed project shape**

Run: `test -f android/gradlew && test -f android/app/build.gradle && echo OK`
Expected: prints `OK`.

- [ ] **Step 6: Commit**

```bash
git add android .gitignore
git commit -m "feat: add committed Capacitor Android project"
```

---

### Task 7: CI — build and upload the debug APK

**Files:**
- Create: `.github/workflows/android.yml`

**Interfaces:**
- Consumes: everything above (`build:mobile`, `android/`, `cap:sync`).
- Produces: a green GitHub Actions workflow uploading `app-debug.apk` as an artifact.

- [ ] **Step 1: Create `.github/workflows/android.yml`**

```yaml
name: Android APK

on:
  workflow_dispatch:
  pull_request:
    paths:
      - 'src/**'
      - 'android/**'
      - 'capacitor.config.ts'
      - 'vite.config.mobile.ts'
      - 'package.json'
      - 'package-lock.json'
      - '.github/workflows/android.yml'

jobs:
  build-debug-apk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build web assets
        run: npm run build:mobile

      - name: Setup JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Cache Gradle
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
          key: gradle-${{ runner.os }}-${{ hashFiles('android/**/*.gradle*', 'android/gradle/wrapper/gradle-wrapper.properties') }}
          restore-keys: gradle-${{ runner.os }}-

      - name: Sync Capacitor
        run: npx cap sync android

      - name: Build debug APK
        run: cd android && ./gradlew assembleDebug --no-daemon

      - name: Upload APK artifact
        uses: actions/upload-artifact@v4
        with:
          name: app-debug
          path: android/app/build/outputs/apk/debug/app-debug.apk
          if-no-files-found: error
```

- [ ] **Step 2: Validate the workflow YAML locally**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/android.yml')); print('valid yaml')"`
Expected: prints `valid yaml`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/android.yml
git commit -m "ci: build and upload debug APK on PR and dispatch"
```

- [ ] **Step 4: Push and verify CI is green**

Run:
```bash
git push -u origin feat/android-capacitor-m1
```
Then open a PR (or trigger `workflow_dispatch`) and confirm the `Android APK` workflow completes green and the `app-debug` artifact is downloadable.
Expected: workflow succeeds; APK artifact present.

---

## Self-Review Notes

- **Spec coverage:** storage seam → Task 2; messaging seam (handler extraction + dynamic-import `sendMessage`) → Tasks 3–4; build seam → Task 5; Capacitor deps/config → Task 1; committed `android/` → Task 6; CI full APK build + artifact → Task 7. Backward-compat for existing extension vaults handled in `chromeKV.get`/`parse` (Task 2). Non-goals (biometric/PIN, lifecycle auto-lock, mini-app browser, size pass) intentionally excluded.
- **Type consistency:** `KV`, `isNativePlatform`, `getKV`, `__setKV` used identically across Tasks 2–4; `handle`/`lock` signatures match between Task 3 (definition) and Tasks 3–4 (consumption); `sendMessage` keeps its existing `<R extends Request> => Promise<ResponseFor<R>>` signature so popup callers (`useWallet`, `Onboarding`, `Send`) are unchanged.
- **No placeholders:** every code/command step contains concrete content.
