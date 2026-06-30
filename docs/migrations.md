# Migrations & data conventions

> Read this before any change that touches persisted data.

## This project has no database

Lantern is a non-custodial wallet (browser extension + Capacitor Android app).
There is **no server database and no SQL migrations**. Persistence is limited to:

- **Encrypted vault + settings** in `chrome.storage.local` (extension) or
  Capacitor **Preferences** (Android), behind the `KvStore` seam in
  `src/shared/storage.ts` / `src/shared/kv.ts`.
- Values are JSON strings keyed by `lantern.vault` and `lantern.settings`.

## Schema/versioning conventions (client storage)

- The stored vault carries a `version` field (`StoredVault.version`). If you
  change its shape, **bump `version`** and add a forward-migration in the read
  path (`getVault`) that upgrades older shapes — never break an existing
  install's ability to unlock.
- Keep reads **backward-compatible** (see the legacy object-shaped-vault handling
  in `kv.ts` / `tests/storage.test.ts`).
- **Timestamps:** use epoch milliseconds (`Date.now()`) for any in-memory or
  stored time fields; do not store locale-formatted strings.

## If a real backend is ever added

Document its migration tool and timestamp conventions here (e.g. UTC,
`timestamptz`, idempotent up/down migrations) before the first schema change.
