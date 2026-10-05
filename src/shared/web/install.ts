// Home Screen first, on iOS (#238). WebKit deletes a site's script-writable
// storage (IndexedDB included) after 7 days without a visit, unless the site was
// added to the Home Screen. A user who doesn't come back for a week would lose
// the encrypted wallet, so on iOS the web app asks to be installed before a
// wallet is created. Every iOS browser uses WebKit, so this isn't Safari-only.

export interface InstallEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** iOS's non-standard `navigator.standalone`: true when launched from the Home Screen. */
  standalone: boolean | undefined;
  displayModeStandalone: boolean;
}

export function isIos(env: InstallEnv): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true;
  // iPadOS asks for desktop sites and reports itself as a Mac; only an iPad
  // has a touch screen there.
  return /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1;
}

export function isInstalled(env: InstallEnv): boolean {
  return env.standalone === true || env.displayModeStandalone;
}

export function needsHomeScreenStep(env: InstallEnv): boolean {
  return isIos(env) && !isInstalled(env);
}

export function currentInstallEnv(): InstallEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone,
    displayModeStandalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
  };
}

// Other browsers (#238): offer their own install prompt when they fire one,
// never blocking. Captured early, since the event fires once, soon after load.
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferredPrompt: InstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    for (const cb of promptListeners) cb();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    for (const cb of promptListeners) cb();
  });
}

export function installPrompt(): InstallPromptEvent | null {
  return deferredPrompt;
}

export function onInstallPromptChange(cb: () => void): () => void {
  promptListeners.add(cb);
  return () => promptListeners.delete(cb);
}

export async function promptInstall(): Promise<void> {
  const e = deferredPrompt;
  if (!e) return;
  deferredPrompt = null;
  await e.prompt();
  await e.userChoice.catch(() => undefined);
  for (const cb of promptListeners) cb();
}
