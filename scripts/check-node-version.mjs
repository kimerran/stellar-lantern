// Fails if any Node version reference disagrees with .node-version (#318).
//
//   npm run check:node
//
// CI runs every workflow on .node-version (setup-node's node-version-file),
// but the API image on Railway comes from services/lantern-api/Dockerfile,
// which CI never builds. A floating `node:22-slim` there left production a
// security release behind CI. So the Dockerfile's FROM tags, the API's
// `engines` floor (and its lockfile copy) and every setup-node step are
// checked against the one file.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const version = read('.node-version').trim();
const errors = [];
if (!/^\d+\.\d+\.\d+$/.test(version)) errors.push(`.node-version: "${version}" is not an exact x.y.z version`);
const major = version.split('.')[0];
const engines = `>=${version} <${Number(major) + 1}`;

const dockerfile = 'services/lantern-api/Dockerfile';
const froms = [...read(dockerfile).matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
if (froms.length === 0) errors.push(`${dockerfile}: no FROM line`);
for (const image of froms) {
  // An optional @sha256 digest may follow the tag.
  if (!image.startsWith(`node:${version}-slim`)) errors.push(`${dockerfile}: FROM ${image}, expected node:${version}-slim`);
}

const pkg = 'services/lantern-api/package.json';
const pkgEngines = JSON.parse(read(pkg)).engines?.node;
if (pkgEngines !== engines) errors.push(`${pkg}: engines.node is "${pkgEngines}", expected "${engines}"`);
const lock = 'services/lantern-api/package-lock.json';
const lockEngines = JSON.parse(read(lock)).packages?.['']?.engines?.node;
if (lockEngines !== engines) errors.push(`${lock}: engines.node is "${lockEngines}", expected "${engines}" (run npm install there)`);

const workflows = '.github/workflows';
for (const name of readdirSync(join(ROOT, workflows)).filter((f) => /\.ya?ml$/.test(f))) {
  const lines = read(join(workflows, name)).split('\n');
  lines.forEach((line, i) => {
    if (/^\s*node-version:/.test(line)) errors.push(`${workflows}/${name}:${i + 1}: use node-version-file: .node-version, not "${line.trim()}"`);
  });
  const setups = lines.filter((l) => l.includes('actions/setup-node')).length;
  const files = lines.filter((l) => /^\s*node-version-file:\s*\.node-version\s*$/.test(l)).length;
  if (setups !== files) errors.push(`${workflows}/${name}: ${setups} setup-node steps but ${files} use node-version-file: .node-version`);
}

if (errors.length) {
  console.error(`check:node: ${errors.length} mismatch(es) with .node-version (${version}):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`check:node: Node ${version} everywhere (Dockerfile, engines, ${workflows}).`);
