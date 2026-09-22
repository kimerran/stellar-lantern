// Types for release-assets.mjs so the vitest suite (TypeScript) can import it.

export const FLAG_NAMES: string[];

export interface AssetNames {
  apk: string;
  zip: string;
  sums: string;
  notes: string;
}
export function assetNames(version: string): AssetNames;

export function releaseTag(version: string, runNumber: string | number): string;
export function releaseName(version: string, runNumber: string | number): string;

export function sha256Hex(bytes: Uint8Array): string;

export interface SumEntry {
  name: string;
  sha256: string;
}
export function sumsFile(entries: SumEntry[]): string;

export interface Flag {
  name: string;
  value: string;
}
export function flagSet(env: Record<string, string | undefined>): Flag[];

export function releaseNotes(input: {
  version: string;
  tag: string;
  sha: string;
  runNumber: string | number;
  flags: Flag[];
  assets: AssetNames;
  sums: SumEntry[];
}): string;
