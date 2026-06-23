// Node-global shims required by @stellar/stellar-sdk, bip39, and stellar-hd-wallet
// (their crypto/stream dependency chain expects `Buffer`, `process`, and `global`).
//
// vite-plugin-node-polyfills only injects these into the MAIN bundle entry — NOT
// into separately-built entries like the MV3 service worker or web workers. We
// therefore set them up explicitly and import THIS module first, before any code
// that touches Stellar. ES modules evaluate static imports in source order, so a
// side-effect-only import placed first runs before the libraries that need it.
import { Buffer } from 'vite-plugin-node-polyfills/shims/buffer';
import process from 'vite-plugin-node-polyfills/shims/process';
import { global } from 'vite-plugin-node-polyfills/shims/global';

const g = globalThis as unknown as {
  Buffer?: typeof Buffer;
  process?: typeof process;
  global?: typeof globalThis;
};

if (!g.Buffer) g.Buffer = Buffer;
if (!g.process) g.process = process;
if (!g.global) g.global = global as unknown as typeof globalThis;
