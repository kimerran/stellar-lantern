import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { receiveQrPayload } from '@core/receive/payload';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

interface Props {
  address: string;
  onBack: () => void;
}

// Receive: show the wallet address as a scannable QR plus the address text and a
// copy action. The QR payload is the raw account key (see receiveQrPayload); the
// camera-SCAN half (for Send) is a separate follow-up.
export function Receive({ address, onBack }: Props) {
  const showToast = useToast();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let payload: string;
    try {
      payload = receiveQrPayload(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t build the QR code.');
      return;
    }
    QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 512 })
      .then((url) => {
        if (live) setQrDataUrl(url);
      })
      .catch(() => {
        if (live) setError('Couldn’t build the QR code.');
      });
    return () => {
      live = false;
    };
  }, [address]);

  const copyAddress = () => {
    navigator.clipboard.writeText(address).then(
      () => showToast('Address copied'),
      () => showToast('Couldn’t copy address', 'error'),
    );
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <ScreenHeader title="Receive" onBack={onBack} />
      <main className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6">
        <p className="mb-4 mt-2 text-body-md text-on-surface-variant">
          Scan this code or share your address to receive assets on Stellar.
        </p>

        <div className="flex flex-col items-center">
          {error ? (
            <div className="flex h-64 w-64 items-center justify-center rounded-2xl bg-surface-container p-6 text-center">
              <p role="alert" className="text-body-md text-error">
                {error}
              </p>
            </div>
          ) : qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="QR code for your Stellar address"
              width={256}
              height={256}
              className="h-64 w-64 rounded-2xl bg-white p-3 shadow-layer-1"
            />
          ) : (
            <div className="flex h-64 w-64 items-center justify-center rounded-2xl bg-surface-container">
              <Icon name="progress_activity" size={32} className="animate-spin text-primary-container" />
            </div>
          )}
        </div>

        <p className="mt-5 break-all text-center font-mono text-label-md text-on-surface">{address}</p>

        <Button fullWidth className="mt-5" leadingIcon="content_copy" onClick={copyAddress}>
          Copy address
        </Button>
      </main>
    </div>
  );
}

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 bg-surface-container-low px-2">
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-variant active:scale-95"
      >
        <Icon name="arrow_back" size={22} />
      </button>
      <h1 className="truncate text-title-md text-on-surface">{title}</h1>
    </header>
  );
}
