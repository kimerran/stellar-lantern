// Scan a QR code with the device camera, Android only (#226). It uses Google's
// code scanner (ML Kit, via @capacitor-mlkit/barcode-scanning): the camera UI
// runs in Google Play services, so the app itself needs no CAMERA permission.
//
// The plugin is imported only in the Android build. `__NATIVE_BUILD__` is a
// build-time constant (true in vite.config.mobile.ts, false in vite.config.ts),
// so the extension's bundler removes the import and the plugin never ships in
// the extension, not even as an unused chunk.

export type QrScan =
  | { kind: 'scanned'; raw: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; error: string };

const UNAVAILABLE = 'The QR scanner isn’t available on this device. Paste the address instead.';

export async function scanQrCode(): Promise<QrScan> {
  if (!__NATIVE_BUILD__) return { kind: 'unavailable', error: UNAVAILABLE };
  const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
  try {
    if (!(await BarcodeScanner.isSupported()).supported) {
      return { kind: 'unavailable', error: UNAVAILABLE };
    }
    // Google Play services downloads the scanner module on first use.
    if (!(await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()).available) {
      await BarcodeScanner.installGoogleBarcodeScannerModule();
      return {
        kind: 'unavailable',
        error: 'The QR scanner is being installed by Google Play services. Try again in a moment.',
      };
    }
    const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
    const raw = barcodes[0]?.rawValue;
    return raw ? { kind: 'scanned', raw } : { kind: 'cancelled' };
  } catch (e) {
    // Backing out of the scanner rejects with "scan canceled.": not an error.
    if (e instanceof Error && /cancel/i.test(e.message)) return { kind: 'cancelled' };
    return { kind: 'unavailable', error: UNAVAILABLE };
  }
}
