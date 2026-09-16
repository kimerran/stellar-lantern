// Typed environment. Read once at boot; the only source of configuration.
// Boot fails loudly on a missing key — a proxy with no key is a 502 factory.

export interface Env {
  anthropicApiKey: string;
  model: string;
  allowedOrigins: string[]; // empty = allow all (dev only)
  rateLimitPerMin: number;
  dailyCap: number;
  upstreamTimeoutMs: number;
  port: number;
  // Telemetry ingest (#85). Both optional: without a DATABASE_URL the
  // telemetry routes answer 503 and the explainer is unaffected.
  databaseUrl?: string;
  telemetryAdminToken?: string;
  telemetryDailyCap: number;
  retentionDays: number;
  // Shown on the /admin report's Q4 tile (#104); the deployed testnet registry.
  registryId: string;
}

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
// The deployed testnet blacklist registry (same default as scripts/report-activity.ts).
export const DEFAULT_REGISTRY = 'CBJWD6SAQ3OGLDKMQROSWVJGW6U27AESLJIURTMFPLNC4UQH5H2G623F';

function int(name: string, raw: string | undefined, dflt: number): number {
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const anthropicApiKey = source.ANTHROPIC_API_KEY ?? '';
  if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is required');
  return {
    anthropicApiKey,
    model: source.LANTERN_AI_MODEL || DEFAULT_MODEL,
    allowedOrigins: (source.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    rateLimitPerMin: int('RATE_LIMIT_PER_MIN', source.RATE_LIMIT_PER_MIN, 10),
    dailyCap: int('DAILY_CAP', source.DAILY_CAP, 2000),
    upstreamTimeoutMs: int('UPSTREAM_TIMEOUT_MS', source.UPSTREAM_TIMEOUT_MS, 4000),
    port: int('PORT', source.PORT, 8080),
    ...(source.DATABASE_URL ? { databaseUrl: source.DATABASE_URL } : {}),
    ...(source.TELEMETRY_ADMIN_TOKEN ? { telemetryAdminToken: source.TELEMETRY_ADMIN_TOKEN } : {}),
    telemetryDailyCap: int('TELEMETRY_DAILY_CAP', source.TELEMETRY_DAILY_CAP, 50_000),
    retentionDays: int('TELEMETRY_RETENTION_DAYS', source.TELEMETRY_RETENTION_DAYS, 90),
    registryId: source.BLACKLIST_REGISTRY_ID || DEFAULT_REGISTRY,
  };
}
