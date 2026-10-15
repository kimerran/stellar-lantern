import { describe, expect, it } from 'vitest';
import hookSrc from '../src/popup/hooks/useScanReveal.ts?raw';
import sendSrc from '../src/popup/screens/Send.tsx?raw';
import guardiansSrc from '../src/popup/screens/Guardians.tsx?raw';
import coSignSrc from '../src/popup/screens/CoSignRecovery.tsx?raw';

// The "Lantern is checking…" reveal runs once per review. The re-check before
// submit (#121) returns a new verdict object for the same transaction; when
// the reveal keyed on the verdict it replayed, collapsing the review (verdict,
// report card, CONFIRM box hidden) and throwing the scroll to the top and back.
// No DOM environment here, so this pins the wiring at the source level; the
// behaviour was checked in the built extension (see the PR).

describe('scan reveal runs once per review, not per verdict', () => {
  it('useScanReveal keys on the review and never strands scanning at true', () => {
    expect(hookSrc).toMatch(/revealedFor\.current === key\) return;/);
    expect(hookSrc).toMatch(/revealedFor\.current = key;/);
    // The timer is cleared only on unmount, not on every dependency change.
    expect(hookSrc).toMatch(/useEffect\(\(\) => \(\) => clearTimeout\(timer\.current\), \[\]\);/);
  });

  it.each([
    ['Send.tsx', sendSrc],
    ['Guardians.tsx', guardiansSrc],
    ['CoSignRecovery.tsx', coSignSrc],
  ])('%s reveals per scan input, with no verdict-keyed effect left', (_n, src) => {
    expect(src).toContain("const scanning = useScanReveal(step === 'review', verdict, scanInput);");
    expect(src).not.toMatch(/\}, \[step, verdict\]\);/);
    expect(src).not.toContain('setScanning');
  });
});
