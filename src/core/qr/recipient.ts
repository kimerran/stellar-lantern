// What a scanned QR code may put into the Send form (#226). Pure, so the rules
// are unit-tested without a camera. Accepted: a Stellar account (G…) or
// contract (C…) address, or a SEP-0007 `web+stellar:pay` request, from which
// the destination, an XLM amount and a text memo are read. Anything else is a
// plain sentence, and the raw payload is never echoed or used. Nothing here
// sends: the result only fills the form, and the payment still goes through
// the full review and scan.

import { StrKey } from '@stellar/stellar-sdk';

export type ScannedRecipient =
  | {
      ok: true;
      destination: string;
      amount?: string;
      memo?: string;
      // Something in the request the form can't take as-is (another asset, a
      // non-text memo, a malformed amount), said once for the user to handle.
      note?: string;
    }
  | { ok: false; error: string };

const NOT_AN_ADDRESS = 'That QR code isn’t a Stellar address.';
const AMOUNT_RE = /^\d+(\.\d{1,7})?$/;
// A text memo is at most 28 bytes on Stellar.
const MAX_TEXT_MEMO_BYTES = 28;

const isAddress = (s: string) => StrKey.isValidEd25519PublicKey(s) || StrKey.isValidContract(s);

export function parseScannedRecipient(raw: string): ScannedRecipient {
  const text = raw.trim();
  if (!text) return { ok: false, error: NOT_AN_ADDRESS };
  if (isAddress(text)) return { ok: true, destination: text };
  // Someone scanned a secret key. Say so plainly, and never use it.
  if (StrKey.isValidEd25519SecretSeed(text)) {
    return {
      ok: false,
      error:
        'That QR code holds a secret key, not an address. Never share it; nothing was filled in.',
    };
  }
  if (!/^web\+stellar:pay\?/i.test(text)) return { ok: false, error: NOT_AN_ADDRESS };

  const params = new URLSearchParams(text.slice(text.indexOf('?') + 1));
  const destination = (params.get('destination') ?? '').trim();
  if (!isAddress(destination)) {
    return {
      ok: false,
      error: 'That QR code is a payment request without a valid Stellar address.',
    };
  }
  const out: Extract<ScannedRecipient, { ok: true }> = { ok: true, destination };
  const notes: string[] = [];

  // The form's amount is XLM unless the user picks another asset, so an
  // amount meant for another asset is never filled in: 5 USDC must not
  // become 5 XLM.
  const assetCode = params.get('asset_code')?.trim();
  // Native XLM is expressed by omitting asset_code (SEP-0007). Any code with an
  // issuer is an issued asset, even one coded "XLM", which anyone can issue.
  const assetIssuer = params.get('asset_issuer')?.trim();
  const otherAsset =
    assetCode && (assetIssuer || !['XLM', 'NATIVE'].includes(assetCode.toUpperCase()))
      ? assetCode.slice(0, 12)
      : null;
  const amount = params.get('amount')?.trim();
  const amountOk = !!amount && AMOUNT_RE.test(amount) && Number(amount) > 0;
  if (otherAsset) {
    notes.push(
      amountOk
        ? `it asks for ${amount} ${otherAsset}; choose that asset and enter the amount yourself`
        : `it asks for ${otherAsset}; choose that asset yourself`,
    );
  } else if (amount) {
    if (amountOk) out.amount = amount;
    else notes.push('the requested amount couldn’t be read');
  }

  const memo = params.get('memo');
  const memoType = (params.get('memo_type') ?? 'MEMO_TEXT').toUpperCase();
  if (memo) {
    if (memoType === 'MEMO_TEXT' && new TextEncoder().encode(memo).length <= MAX_TEXT_MEMO_BYTES)
      out.memo = memo;
    else notes.push('its memo isn’t a short text memo, so add it yourself if it’s needed');
  }

  if (notes.length) out.note = `From the payment request: ${notes.join('; ')}.`;
  return out;
}
