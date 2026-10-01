import { describe, expect, it, vi } from 'vitest';
import { onAppPause, whileSystemScreen, SYSTEM_SCREEN_GRACE_MS } from '@core/session/foreground';
import { runScan } from '@core/qr/scan';

// QA on 0.5.0 (#226): the camera opened and read the code, but the recipient
// never filled. Google's scanner is a Play services activity, so opening it
// pauses Lantern's activity; the wallet locks on every pause, the Send screen
// unmounts behind the unlock screen, and the scan result lands nowhere.

describe('lock on pause, except while our own system screen is open', () => {
  it('locks on an ordinary pause', () => {
    const lock = vi.fn();
    onAppPause(lock);
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('does not lock when the pause comes from a system screen we opened', async () => {
    const lock = vi.fn();
    await whileSystemScreen(async () => {
      onAppPause(lock);
    });
    expect(lock).not.toHaveBeenCalled();
  });

  it('still locks when the system screen was left open past the grace period', async () => {
    const lock = vi.fn();
    let t = 1_000;
    await whileSystemScreen(
      async () => {
        onAppPause(lock, t);
        t += SYSTEM_SCREEN_GRACE_MS + 1;
      },
      () => t,
    );
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('locks normally again after the system screen closes, even if it threw', async () => {
    const lock = vi.fn();
    await expect(
      whileSystemScreen(async () => {
        throw new Error('scanner crashed');
      }),
    ).rejects.toThrow('scanner crashed');
    onAppPause(lock);
    expect(lock).toHaveBeenCalledTimes(1);
  });
});

describe('runScan', () => {
  function plugin(onScan: () => void, rawValue = 'GABC') {
    return {
      BarcodeFormat: { QrCode: 'QR_CODE' },
      BarcodeScanner: {
        isSupported: async () => ({ supported: true }),
        isGoogleBarcodeScannerModuleAvailable: async () => ({ available: true }),
        installGoogleBarcodeScannerModule: async () => {},
        scan: async () => {
          onScan();
          return { barcodes: [{ rawValue }] };
        },
      },
    };
  }

  it('keeps the wallet unlocked while the scanner is open, and returns the code', async () => {
    const lock = vi.fn();
    // The scanner activity pauses the app while scan() is pending.
    const result = await runScan(plugin(() => onAppPause(lock)) as never);
    expect(lock).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'scanned', raw: 'GABC' });
  });
});
