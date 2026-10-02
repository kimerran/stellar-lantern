import { describe, expect, it } from 'vitest';
import { BACKUP_CHECK_POSITIONS, isBackupConfirmed } from '@core/wallet/backup';

// Backup before funding (#238). A new wallet is only created, and so its
// Receive address only shown, once the recovery phrase backup is confirmed:
// Onboarding's create step refuses to send CREATE_WALLET until this holds.

const words =
  'abandon ability able about above absent absorb abstract absurd abuse access accident'.split(' ');
const answer = (o: Record<number, string> = {}) =>
  Object.fromEntries(
    BACKUP_CHECK_POSITIONS.map((p) => [p, words[p]!]).concat(
      Object.entries(o).map(([k, v]) => [Number(k), v]),
    ),
  );

describe('isBackupConfirmed', () => {
  it('asks for two words from different parts of the phrase', () => {
    expect(BACKUP_CHECK_POSITIONS.length).toBe(2);
    expect(new Set(BACKUP_CHECK_POSITIONS).size).toBe(2);
  });

  it('is true only when every requested word is right', () => {
    expect(isBackupConfirmed(words, answer())).toBe(true);
  });

  it('is false with nothing entered, one word missing, or one word wrong', () => {
    expect(isBackupConfirmed(words, {})).toBe(false);
    expect(
      isBackupConfirmed(words, {
        [BACKUP_CHECK_POSITIONS[0]!]: words[BACKUP_CHECK_POSITIONS[0]!]!,
      }),
    ).toBe(false);
    expect(isBackupConfirmed(words, answer({ [BACKUP_CHECK_POSITIONS[1]!]: 'zoo' }))).toBe(false);
  });

  it('forgives case and spacing, as the import box does', () => {
    const p = BACKUP_CHECK_POSITIONS[0]!;
    expect(isBackupConfirmed(words, answer({ [p]: `  ${words[p]!.toUpperCase()} ` }))).toBe(true);
  });

  it('is false for a missing or too-short phrase, never vacuously true', () => {
    expect(isBackupConfirmed([], {})).toBe(false);
    expect(isBackupConfirmed(words.slice(0, 3), answer())).toBe(false);
  });
});
