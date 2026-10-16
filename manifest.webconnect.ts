// Web connect (#248): the content scripts a web-connect build adds to the
// manifest (terms in docs/superpowers/specs/2026-10-16-web-connect-threat-model.md).
//
// Two scripts on every https page, top frame only, at document_start:
//   - the relay (ISOLATED world) never reads the page; it forwards our own
//     namespaced messages to the background;
//   - the page script (MAIN world) defines window.lantern.
// Both are `*.iife.ts`, so crxjs builds each as one standalone file: no
// runtime import() that a page's CSP could block, and window.lantern exists
// before the page's own scripts run.
//
// This is what brings Chrome's "read and change all your data on all
// websites" warning, so vite.config.ts adds it only when the build flag is on.
// Development builds also match localhost, so a test dApp can run there.
export function webConnectContentScripts(mode: string) {
  const matches = [
    'https://*/*',
    ...(mode === 'development' ? ['http://localhost/*', 'http://127.0.0.1/*'] : []),
  ];
  return [
    {
      matches,
      js: ['src/content/relay.iife.ts'],
      run_at: 'document_start' as const,
      all_frames: false,
    },
    {
      matches,
      js: ['src/content/page.iife.ts'],
      run_at: 'document_start' as const,
      all_frames: false,
      world: 'MAIN' as const,
    },
  ];
}
