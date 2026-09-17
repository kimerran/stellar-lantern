// Node entry for the scanner CLI harness (#60). All the logic is in
// scan-cli.ts (IO-injected so the suite can drive it offline); this file only
// supplies the real filesystem, env and fetch, and exits.
//
//   npm run scan -- --file classic-payment
//   npm run scan -- --help
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { run, type Io } from './scan-cli';

// npm runs scripts from the package root, and the bundle lives under
// dist-report/.build, so the corpus is found from cwd, not import.meta.url.
const FIXTURES_DIR = resolve(process.cwd(), 'packages/lantern-scanner/fixtures');

const io: Io = {
  readText: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  fixtures: () =>
    readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((name) => ({ name, text: readFileSync(resolve(FIXTURES_DIR, name), 'utf8') })),
  env: process.env,
  fetchImpl: fetch,
};

run(process.argv.slice(2), io).then(
  (r) => {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(r.code);
  },
  (e) => {
    process.stderr.write(`scan: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  },
);
