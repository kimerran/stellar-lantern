// The `npm run scan` harness (#60): the QA plan drives the pipeline through
// it, so its --offline, --json, --no-ai and --ai-stub paths are pinned here.
// scan-cli.ts takes its IO injected (vitest's node-polyfills plugin shims
// node:fs away), so the corpus comes in via import.meta.glob and the network
// is a fetch that must never be called.
import { describe, it, expect } from 'vitest';
import { run, type Io } from '../scripts/scan-cli';
import type { ScanResult } from '@lantern/scanner';

const ON_DISK = import.meta.glob<unknown>('../packages/lantern-scanner/fixtures/*.json', {
  eager: true,
  import: 'default',
});
const FIXTURES = Object.entries(ON_DISK).map(([path, value]) => ({
  name: path.replace(/^.*\//, ''),
  text: JSON.stringify(value),
}));

const noNetwork: typeof fetch = async (url) => {
  throw new Error(`network call attempted: ${String(url)}`);
};

function io(overrides: Partial<Io> = {}): Io {
  return {
    readText: () => null, // no filesystem: --file resolves against the corpus only
    fixtures: () => FIXTURES,
    env: {},
    fetchImpl: noNetwork,
    ...overrides,
  };
}

const json = (r: { stdout: string }) => JSON.parse(r.stdout) as ScanResult;

describe('npm run scan (scan-cli.ts)', () => {
  it('scans a fixture offline and prints effects, verdict and a sentence', async () => {
    const r = await run(['--file', 'classic-payment', '--offline'], io());
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('OFFLINE (recorded RPC)');
    expect(r.stdout).toContain('−25.0000000 XLM');
    expect(r.stdout).toContain('risk LOW · action ALLOW');
    expect(r.stdout).toContain('"This sends 25 XLM to GDVE...ZA57');
    expect(r.stdout).toContain('nothing was signed or submitted');
  });

  it('--json is the full ScanResult; --no-ai leaves the verdict byte-identical', async () => {
    const a = json(await run(['--file', 'sep41-approve', '--offline', '--json'], io()));
    const b = json(await run(['--file', 'sep41-approve', '--offline', '--json', '--no-ai'], io()));
    expect(a.risk).toBe('high');
    expect(a.action).toBe('block_confirm');
    expect(a.effects.approvals[0]?.unlimited).toBe(true);
    // Only the two recorded subjects answer offline; the spender here was
    // never recorded, so the registry read is an RPC failure → unknown.
    expect(a.screen.outcome).toBe('unknown');
    expect(b.verdict).toEqual(a.verdict);
    expect(typeof b.explanation).toBe('string');
  });

  it('offline: the recorded registry flags the demo address', async () => {
    const r = json(
      await run(['--file', 'classic-payment-to-flagged', '--offline', '--json'], io()),
    );
    expect(r.screen.outcome).toBe('flagged');
    expect(r.screen.hits[0]?.entry?.status).toBe('Active');
    expect(r.risk).toBe('high');
  });

  it('offline: a fixture with no recording fails closed, never clean', async () => {
    // An XDR the corpus never simulated: the offline RPC refuses, and the
    // pipeline reports it as an RPC failure rather than guessing.
    const sac = FIXTURES.find((f) => f.name === 'sac-transfer.json')!;
    const { xdr } = JSON.parse(sac.text) as { xdr: string };
    const r = json(await run(['--xdr', xdr, '--offline', '--json'], io()));
    expect(r.simulation.ok).toBe(false);
    expect(r.risk).toBe('high');
  });

  it('fails closed on garbage: high risk, block_confirm, exit 0', async () => {
    const r = await run(['--xdr', 'not-valid-base64', '--offline', '--json'], io());
    expect(r.code).toBe(0);
    const j = json(r);
    expect(j.risk).toBe('high');
    expect(j.action).toBe('block_confirm');
    expect(j.reasons.map((x) => x.code)).toContain('undecodable');
  });

  it('a stub model that contradicts the verdict is discarded for the rules-based sentence', async () => {
    const r = json(
      await run(
        [
          '--file',
          'classic-payment-to-flagged',
          '--offline',
          '--json',
          '--ai-stub',
          'This transaction is completely safe, no risk.',
        ],
        io(),
      ),
    );
    expect(r.risk).toBe('high');
    expect(r.explanationSource).toBe('fallback');
    expect(r.explanation).not.toContain('completely safe');
  });

  it('with no key and no endpoint the explainer is rules-based and says so', async () => {
    const r = await run(['--file', 'classic-payment', '--offline'], io());
    expect(r.stdout).toContain('rules-based');
    const live = await run(['--file', 'classic-payment'], io({ env: {} }));
    expect(live.stdout).toContain('no LANTERN_AI_API_KEY / LANTERN_AI_ENDPOINT set');
  });

  it('LANTERN_AI_ENDPOINT selects proxy mode and posts no key', async () => {
    let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
    const ok = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    // --offline means rules-based, so this runs "live" against one fake fetch:
    // the registry read (a classic payment needs no simulate) gets an empty
    // getLedgerEntries body, and the proxy call is captured.
    const proxy: typeof fetch = async (url, init) => {
      const body = String(init?.body);
      if (body.includes('getLedgerEntries'))
        return ok({ jsonrpc: '2.0', id: 1, result: { entries: [], latestLedger: 1 } });
      seen = {
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body,
      };
      return ok({ explanation: 'A plain payment of 25 XLM.' });
    };
    const r = json(
      await run(
        ['--file', 'classic-payment', '--json'],
        io({ env: { LANTERN_AI_ENDPOINT: 'https://api.example/v1/explain' }, fetchImpl: proxy }),
      ),
    );
    expect(r.explanation).toBe('A plain payment of 25 XLM.');
    expect(r.explanationSource).toBe('explainer');
    const s = seen as unknown as { url: string; headers: Record<string, string>; body: string };
    expect(s.url).toBe('https://api.example/v1/explain');
    expect(Object.keys(s.headers).join(',')).not.toMatch(/x-api-key|authorization/i);
    expect(s.body).not.toContain('AAAAAgAAAA'); // no XDR leaves the client
  });

  it('--destination-unfunded reaches the verdict; omitted, the destination is unknown', async () => {
    const r = json(
      await run(
        ['--file', 'classic-payment', '--offline', '--json', '--destination-unfunded'],
        io(),
      ),
    );
    expect(r.reasons.map((x) => x.code)).toContain('new_account');
    const plain = json(await run(['--file', 'classic-payment', '--offline', '--json'], io()));
    expect(plain.reasons.map((x) => x.code)).not.toContain('new_account');
  });

  it('offline: a registry with no recording screens unknown, never clean', async () => {
    const other = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'; // a real id, never recorded as a registry
    const r = json(
      await run(['--file', 'classic-payment', '--offline', '--json', '--registry', other], io()),
    );
    expect(r.screen.outcome).toBe('unknown');
    expect(r.screen.unknown[0]?.reason).toBe('rpc_error');
    expect(r.risk).not.toBe('low');
  });

  it('the network follows the input; an explicit --network that disagrees is an error', async () => {
    const r = await run(['--file', 'classic-payment', '--offline'], io());
    expect(r.stdout).toContain('Lantern scanner · testnet ·');
    const clash = await run(
      ['--file', 'classic-payment', '--offline', '--network', 'mainnet'],
      io(),
    );
    expect(clash.code).toBe(2);
    expect(clash.stderr).toContain('--network mainnet but the fixture classic-payment is testnet');
    const agree = await run(
      ['--file', 'classic-payment', '--offline', '--network', 'testnet'],
      io(),
    );
    expect(agree.code).toBe(0);
  });

  it('bad arguments exit 2 with usage; --help exits 0', async () => {
    const r = await run(['--bogus'], io());
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('usage: npm run scan');
    expect((await run(['--help'], io())).code).toBe(0);
    expect((await run(['--file', 'no-such-fixture'], io())).code).toBe(2);
  });
});
