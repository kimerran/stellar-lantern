// The release gate (#141): exits 1 when package.json's version is not newer
// than every Release this repo has published. release.yml runs it before it
// builds, and on release PRs into main, so a release that forgot
// `npm run version:bump` fails loudly instead of shipping a second, different
// binary under an existing version's asset names.
//
// Tags come from `git ls-remote --tags origin`, so it needs no GitHub token and
// no fetch-depth: each repo (internal and the public mirror) checks its own.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReleaseVersion, releaseTagsExcept } from './release-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const tags = releaseTagsExcept(
  execFileSync('git', ['ls-remote', '--tags', '--refs', 'origin'], { cwd: root, encoding: 'utf8' }),
  head,
);

const result = checkReleaseVersion(version, tags);
if (!result.ok) {
  console.error(`::error::${result.message}`);
  process.exit(1);
}
console.log(`version ${version} is new (latest released: ${result.latest ?? 'none'})`);
