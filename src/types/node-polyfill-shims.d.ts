// vite-plugin-node-polyfills ships shim sources but its package.json "exports"
// map hides the .d.ts from TypeScript's bundler resolution. Declare the minimal
// surface we use in src/shared/polyfills.ts.
declare module 'vite-plugin-node-polyfills/shims/buffer' {
  export const Buffer: typeof globalThis.Buffer;
}
declare module 'vite-plugin-node-polyfills/shims/process' {
  const process: NodeJS.Process;
  export default process;
}
declare module 'vite-plugin-node-polyfills/shims/global' {
  export const global: typeof globalThis;
}
