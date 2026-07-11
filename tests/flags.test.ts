import { describe, it, expect } from 'vitest';
import { parseFlag, FLAGS } from '@shared/flags';

describe('parseFlag', () => {
  it('uses the default when the env var is unset or empty', () => {
    expect(parseFlag(undefined, true)).toBe(true);
    expect(parseFlag(undefined, false)).toBe(false);
    expect(parseFlag('', true)).toBe(true);
    expect(parseFlag('', false)).toBe(false);
  });

  it('treats "true" / "1" as ON regardless of the default', () => {
    expect(parseFlag('true', false)).toBe(true);
    expect(parseFlag('1', false)).toBe(true);
  });

  it('treats any other value as OFF regardless of the default (unknown ignored)', () => {
    expect(parseFlag('false', true)).toBe(false);
    expect(parseFlag('0', true)).toBe(false);
    expect(parseFlag('yes', true)).toBe(false);
    expect(parseFlag('TRUE', true)).toBe(false); // case-sensitive, only lowercase "true"
  });
});

describe('FLAGS defaults', () => {
  it('is a frozen object', () => {
    expect(Object.isFrozen(FLAGS)).toBe(true);
  });

  it('defaults shipped-core features ON', () => {
    expect(FLAGS.swap).toBe(true);
    expect(FLAGS.earnBlend).toBe(true);
    expect(FLAGS.anchors).toBe(true);
    expect(FLAGS.miniapps).toBe(true);
    // Biometric unlock (#23 M2a) is ON: active on Android, inert on web/extension.
    expect(FLAGS.biometricUnlock).toBe(true);
  });

  it('defaults external / unfinished / demo features OFF', () => {
    expect(FLAGS.swapAggregator).toBe(false);
    expect(FLAGS.geovelocity).toBe(false);
    expect(FLAGS.demoAffordances).toBe(false);
  });
});
