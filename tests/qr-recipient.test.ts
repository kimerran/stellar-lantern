import { describe, it, expect } from 'vitest';
import { parseScannedRecipient } from '../src/core/qr/recipient';

// What a scanned QR code may put into the Send form (#226). Only a Stellar
// address, or a SEP-0007 pay request, is accepted; anything else is a sentence.

const G = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const C = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

describe('parseScannedRecipient', () => {
  it('accepts a bare account address (trimmed)', () => {
    expect(parseScannedRecipient(`  ${G}\n`)).toEqual({ ok: true, destination: G });
  });

  it('accepts a bare contract address', () => {
    expect(parseScannedRecipient(C)).toEqual({ ok: true, destination: C });
  });

  it('reads a SEP-0007 pay request: destination, amount and a text memo', () => {
    expect(
      parseScannedRecipient(
        `web+stellar:pay?destination=${G}&amount=12.5&memo=coffee%20money&memo_type=MEMO_TEXT`,
      ),
    ).toEqual({ ok: true, destination: G, amount: '12.5', memo: 'coffee money' });
  });

  it('treats a memo with no memo_type as text, per SEP-0007', () => {
    expect(parseScannedRecipient(`web+stellar:pay?destination=${G}&memo=hi`)).toEqual({
      ok: true,
      destination: G,
      memo: 'hi',
    });
  });

  it('keeps the destination but drops what it cannot fill honestly', () => {
    // A non-text memo, a non-XLM asset and a malformed amount are left for
    // the user, with a note, rather than guessed at.
    const out = parseScannedRecipient(
      `web+stellar:pay?destination=${G}&amount=abc&memo=AAAA&memo_type=MEMO_HASH&asset_code=USDC&asset_issuer=${G}`,
    );
    expect(out).toMatchObject({ ok: true, destination: G });
    if (!out.ok) return;
    expect(out.amount).toBeUndefined();
    expect(out.memo).toBeUndefined();
    expect(out.note).toMatch(/USDC/);
  });

  it('never fills an amount meant for another asset, so 5 USDC can’t become 5 XLM', () => {
    const out = parseScannedRecipient(
      `web+stellar:pay?destination=${G}&amount=5&asset_code=USDC&asset_issuer=${G}`,
    );
    expect(out).toMatchObject({ ok: true, destination: G });
    if (!out.ok) return;
    expect(out.amount).toBeUndefined();
    expect(out.note).toMatch(/5 USDC/);
  });

  it('treats asset_code XLM with an issuer as an issued token, not native XLM', () => {
    // Anyone can issue a token coded "XLM"; SEP-0007 names native XLM by
    // omitting asset_code, so an issuer means another asset.
    const out = parseScannedRecipient(
      `web+stellar:pay?destination=${G}&amount=5&asset_code=XLM&asset_issuer=${G}`,
    );
    expect(out).toMatchObject({ ok: true, destination: G });
    if (!out.ok) return;
    expect(out.amount).toBeUndefined();
    expect(out.note).toMatch(/5 XLM/);
  });

  it('fills the amount when the request is for XLM, named or implied', () => {
    for (const q of ['', '&asset_code=XLM', '&asset_code=native']) {
      const out = parseScannedRecipient(`web+stellar:pay?destination=${G}&amount=7${q}`);
      expect(out).toMatchObject({ ok: true, amount: '7' });
    }
  });

  it.each([
    ['empty', ''],
    ['a URL', 'https://example.com/pay'],
    ['a secret key', 'SAKZ3EUXNMJT5TU5HFFDZVTKZHXVGUXOXAZKE6HXIGU5N7V2EBRPFYU6'],
    ['a malformed address', 'GABC'],
    ['a pay request with no destination', 'web+stellar:pay?amount=5'],
    ['a pay request with a bad destination', 'web+stellar:pay?destination=GNOPE'],
    ['a transaction request', 'web+stellar:tx?xdr=AAAA'],
  ])('rejects %s with a plain sentence, never the raw payload', (_label, raw) => {
    const out = parseScannedRecipient(raw);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/^That QR code/);
    if (raw.length > 4) expect(out.error).not.toContain(raw);
  });
});
