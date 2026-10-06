import { normalizeMnemonic } from './wallet';

// The recovery-phrase backup check (SPEC §6.1): the user re-enters a few words
// from the phrase they were shown. Onboarding creates the wallet only once this
// holds (#238, backup before funding), so its Receive address can't be shown
// for a wallet the user can't restore.

// Deterministic but spread out, so no RNG is needed in the component.
export const BACKUP_CHECK_POSITIONS: readonly number[] = [2, 7];

export function isBackupConfirmed(
  words: readonly string[],
  answers: Readonly<Record<number, string>>,
): boolean {
  if (BACKUP_CHECK_POSITIONS.some((p) => p >= words.length)) return false;
  return BACKUP_CHECK_POSITIONS.every((p) => normalizeMnemonic(answers[p] ?? '') === words[p]);
}
