import { describe, it, expect } from 'vitest';
import { receiveQrPayload } from '@core/receive/payload';

const ADDRESS = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';

describe('receiveQrPayload', () => {
  it('returns the raw address as the QR payload', () => {
    expect(receiveQrPayload(ADDRESS)).toBe(ADDRESS);
  });

  it('trims surrounding whitespace', () => {
    expect(receiveQrPayload(`  ${ADDRESS}\n`)).toBe(ADDRESS);
  });

  it('rejects an invalid address', () => {
    expect(() => receiveQrPayload('not-a-key')).toThrow(/valid Stellar address/i);
  });

  it('rejects a secret seed (S…) — never encode a secret in a receive QR', () => {
    expect(() => receiveQrPayload('SBGWSG6BTNCKCOB3DIFBGCVMUPQFYPA2G4O34RMTB343OYPXU5DJDVMN')).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => receiveQrPayload('')).toThrow();
  });
});
