import { Icon } from '../components/Icon';

// The web app refuses to run inside another site's page (#238): a framed
// wallet could be overlaid and clicked through without the user knowing.
export function FramedRefusal() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <Icon name="gpp_bad" size={32} className="text-error" />
      <h1 className="text-title-md text-on-surface">Lantern can’t run inside another page</h1>
      <p className="text-body-md text-on-surface-variant">
        Open app.golantern.xyz directly in your browser.
      </p>
    </div>
  );
}
