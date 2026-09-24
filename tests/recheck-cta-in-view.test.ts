import { describe, expect, it } from 'vitest';
import useRecheckSrc from '../src/popup/hooks/useRecheck.ts?raw';

// #152 (D3 QA F-AND-2): on a review scrolled to the bottom, the re-check notice
// renders ABOVE the confirm button and pushes it below the scroll area's fold —
// on Android, behind the bottom nav, so the next tap hit a nav tab. The fix
// keeps the CTA in view whenever the re-check state changes. There is no DOM
// test environment here, so these pin the wiring at the source level (the
// behaviour itself was measured in a browser reproduction; see the PR).

const SRC = import.meta.glob<string>('../src/popup/screens/*.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const screens = Object.entries(SRC)
  .filter(([, src]) => src.includes('<RecheckNotice'))
  .map(([path, src]) => [path.split('/').pop()!, src] as const);

describe('re-check keeps the confirm button in view (#152)', () => {
  it('useRecheck exposes a CTA ref and scrolls it into view on every non-idle state', () => {
    expect(useRecheckSrc).toMatch(/const ctaRef = useRef<HTMLDivElement \| null>\(null\)/);
    expect(useRecheckSrc).toMatch(/if \(state\.kind === 'idle'\) return;/);
    expect(useRecheckSrc).toMatch(/ctaRef\.current\?\.scrollIntoView\(\{ block: 'nearest'/);
    expect(useRecheckSrc).toMatch(/\}, \[state\]\);/);
    expect(useRecheckSrc).toMatch(/return \{ state, guard, reset, ctaRef \}/);
  });

  it('covers all seven review screens', () => {
    expect(screens.map(([n]) => n).sort()).toEqual(
      ['Apps.tsx', 'CoSignRecovery.tsx', 'Earn.tsx', 'Guardians.tsx', 'Send.tsx', 'SmartAccount.tsx', 'Swap.tsx'],
    );
  });

  it.each(screens)('%s wraps its confirm CTA (below the notice) in recheck.ctaRef', (_name, src) => {
    const notice = src.indexOf('<RecheckNotice');
    const ref = src.indexOf('ref={recheck.ctaRef}');
    expect(ref).toBeGreaterThan(notice);
    // A little breathing room above the bottom nav / sheet edge once scrolled.
    expect(src.slice(ref, src.indexOf('>', ref))).toMatch(/scroll-mb-4/);
    // The element the ref sits on contains the screen's confirm action.
    const after = src.slice(ref, ref + 1500);
    expect(after).toMatch(/<HoldToConfirm|onClick=\{(confirm|coSign|approveSign)\}/);
  });
});
