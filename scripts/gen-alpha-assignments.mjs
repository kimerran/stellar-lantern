// Generates docs/alpha-tester-assignments.md: one row per tester with three
// freshly generated testnet public keys. Secrets are discarded on purpose — a
// report subject does not need to be a funded or controlled account, and the
// "new account" exercise only needs an address nobody has ever paid. Re-run
// only to grow the table (pass a larger count); never to reshuffle rows that
// testers already hold, or two testers end up reporting the same subject.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';

const OUT = resolve(import.meta.dirname, '../docs/alpha-tester-assignments.md');
const count = Number(process.argv[2] ?? 20);
const rows = Array.from({ length: count }, (_, i) => {
  const [n, r1, r2] = [0, 1, 2].map(() => Keypair.random().publicKey());
  return `| ${i + 1} | \`${n}\` | \`${r1}\` | \`${r2}\` |`;
});

const md = `# Lantern alpha — tester assignment table

Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/gen-alpha-assignments.mjs\`. **Testnet only.** Every address here was generated for the alpha exercises, has never been used, and is controlled by nobody — the secret keys were discarded at generation. That is deliberate: a scam-registry subject only has to be an address, and the evidence pack must describe these as **seeded test entries**, not organic community reports.

**One row per tester.** Your row number is in the message that sent you the guide. Do not use another row — the two report columns only count toward the sprint's "distinct addresses reported" target if no two testers report the same address.

| Tester | New account — guide exercise 3 (send 2 XLM here) | Report subject R1 | Report subject R2 |
|---|---|---|---|
${rows.join('\n')}

## How the columns are used

- **New account** — exercise 3 of the guide. Sending 2 XLM to it creates the account on testnet; the review screen should say so. Nobody will ever spend that XLM.
- **R1 / R2** — held for the *report* exercise, which needs the one-click report button. That button is not in the current build. When it ships you will get a one-page addendum; until then, do nothing with these two addresses.

## Why two report subjects each

The SOW counts two different things: **distinct addresses on the registry** (target ≥ 20) and **registry transactions** (target ≥ 30). A repeat report of an address that is already on the registry is one more transaction but **not** one more address. So each tester reports two addresses nobody else has (→ distinct entries) and then reports one of them a second time (→ an extra transaction, and a real test of the repeat-report warning). Fifteen testers is the minimum cohort that clears both targets: 15 × 2 subjects = 30 entries (target 20); × 3 transactions = 45 executions (target 30). The table has 20 rows so there is room for a larger cohort and for dropouts.
`;
writeFileSync(OUT, md);
console.log(`wrote ${OUT} (${count} rows)`);
