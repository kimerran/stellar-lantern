import { describe, it, expect } from 'vitest';
import { pgStore } from '../src/telemetry/pg-store';

// Postgres integration (#85). Runs only when DATABASE_URL points at a
// database you are happy to write a throwaway table into; CI never sets it.
const url = process.env.DATABASE_URL;
const UUID = '5f3d2f1e-9c2b-4a1d-8e7f-0123456789ab';

describe.skipIf(!url)('pgStore', () => {
  it('migrates, inserts, exports, deletes and purges', async () => {
    const store = await pgStore(url!);
    try {
      await store.deleteInstall(UUID);
      const now = new Date();
      const n = await store.insert(
        [
          {
            installId: UUID,
            platform: 'android',
            appVersion: '0.1.0',
            network: 'testnet',
            event: 'session_start',
            props: {},
            ts: now,
          },
          {
            installId: UUID,
            platform: 'android',
            appVersion: '0.1.0',
            network: 'testnet',
            event: 'tx_signed',
            props: { kind: 'sign_only', ok: true },
            ts: now,
          },
        ],
        now,
      );
      expect(n).toBe(2);
      const rows = await store.export({ since: new Date(now.getTime() - 1000), limit: 10 });
      const mine = rows.filter((r) => r.installId === UUID);
      expect(mine.map((r) => r.event)).toEqual(['session_start', 'tx_signed']);
      expect(mine[1]?.props).toEqual({ kind: 'sign_only', ok: true });
      expect(await store.purgeBefore(new Date(now.getTime() - 1000))).toBeGreaterThanOrEqual(0);
      expect(await store.deleteInstall(UUID)).toBe(2);
      expect(await store.ping()).toBe(true);
    } finally {
      await store.close();
    }
  });
});
