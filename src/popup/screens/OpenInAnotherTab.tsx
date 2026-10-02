import { Icon } from '../components/Icon';

// The web app (#237) runs one wallet per browser profile. A second tab shows
// this until the first one closes, then starts on its own.
export function OpenInAnotherTab() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <Icon name="tab" size={32} className="text-primary-container" />
      <h1 className="text-title-md text-on-surface">Lantern is open in another tab</h1>
      <p className="text-body-md text-on-surface-variant">
        Use that tab, or close it and this one will open your wallet.
      </p>
    </div>
  );
}
