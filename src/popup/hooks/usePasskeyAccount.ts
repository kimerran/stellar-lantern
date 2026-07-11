// Passkey smart-account record (#53) — read straight from storage; it's
// all-public data (contract id, credential id, public key), so unlike the
// vault it never goes through the background worker.
import { useCallback, useEffect, useState } from 'react';
import type { PasskeyAccountRecord } from '@shared/types';
import { getPasskeyAccount } from '@shared/storage';

export function usePasskeyAccount(): {
  /** undefined while loading, null when no passkey account exists. */
  passkeyAccount: PasskeyAccountRecord | null | undefined;
  refresh: () => void;
} {
  const [record, setRecord] = useState<PasskeyAccountRecord | null | undefined>(undefined);
  const refresh = useCallback(() => {
    // Flag-off builds never read storage (and the branch dead-code-eliminates).
    if (!__FEATURE_PASSKEY__) {
      setRecord(null);
      return;
    }
    void getPasskeyAccount().then(setRecord);
  }, []);
  useEffect(refresh, [refresh]);
  return { passkeyAccount: record, refresh };
}
