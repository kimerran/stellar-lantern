// `npm run version:bump [minor|patch|major]` — bump the one version source
// (#141). Writes package.json and the two version fields in package-lock.json;
// the manifest, APP_VERSION and the APK's versionName/versionCode all read
// package.json, so nothing else changes. Run it on develop as the first commit
// of a release: the release gate (scripts/check-release-version.mjs) fails a
// release whose version is already published.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextVersion } from './release-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const part = process.argv[2] ?? 'minor';

const read = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const write = (f, json) => writeFileSync(join(root, f), JSON.stringify(json, null, 2) + '\n');

const pkg = read('package.json');
const from = pkg.version;
const to = nextVersion(from, part);
pkg.version = to;
write('package.json', pkg);

const lock = read('package-lock.json');
lock.version = to;
if (lock.packages?.['']) lock.packages[''].version = to;
write('package-lock.json', lock);

console.log(`${from} → ${to}`);
