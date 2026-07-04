// SEP-24 interactive deposit/withdraw client — the transfer step after SEP-10
// auth (#24). The wallet POSTs a deposit/withdraw request (bearing the SEP-10
// JWT) to the anchor's TRANSFER_SERVER_SEP0024 and gets back an interactive URL
// to open in the mini-app Browser overlay, plus a transaction id to poll.
// Network calls take an injectable `fetch`, so the flow is unit-testable offline.

export type TransferKind = 'deposit' | 'withdraw';

export interface InteractiveRequest {
  kind: TransferKind;
  assetCode: string;
  account: string;
  jwt: string; // SEP-10 token from sep10.submitChallenge
  extra?: Record<string, string>; // optional additional SEP-24 fields
}

export interface InteractiveResponse {
  id: string; // transaction id to poll via fetchTransaction
  url: string; // interactive URL to open in the Browser overlay
  type: string; // e.g. "interactive_customer_info_needed"
}

function base(transferServer: string): string {
  return transferServer.replace(/\/+$/, '');
}

/** Start a SEP-24 interactive deposit or withdraw. */
export async function startInteractive(
  transferServer: string,
  req: InteractiveRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<InteractiveResponse> {
  const res = await fetchImpl(`${base(transferServer)}/transactions/${req.kind}/interactive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.jwt}`,
    },
    body: JSON.stringify({ asset_code: req.assetCode, account: req.account, ...req.extra }),
  });
  if (!res.ok) throw new Error(`Anchor ${req.kind} request failed (${res.status}).`);
  const body = (await res.json()) as { id?: unknown; url?: unknown; type?: unknown };
  if (typeof body.url !== 'string' || typeof body.id !== 'string') {
    throw new Error('Anchor did not return an interactive URL.');
  }
  return {
    id: body.id,
    url: body.url,
    type: typeof body.type === 'string' ? body.type : 'interactive_customer_info_needed',
  };
}

export interface TransferTransaction {
  id: string;
  status: string; // 'incomplete' | 'pending_user_transfer_start' | 'completed' | …
  moreInfoUrl?: string;
  amountIn?: string;
  amountOut?: string;
}

/** Poll a single SEP-24 transaction's status. */
export async function fetchTransaction(
  transferServer: string,
  id: string,
  jwt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TransferTransaction> {
  const url = new URL(`${base(transferServer)}/transaction`);
  url.searchParams.set('id', id);
  const res = await fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${jwt}` } });
  if (!res.ok) throw new Error(`Could not load anchor transaction (${res.status}).`);
  const body = (await res.json()) as { transaction?: Record<string, unknown> };
  const t = body.transaction;
  if (!t || typeof t.id !== 'string' || typeof t.status !== 'string') {
    throw new Error('Anchor returned an unreadable transaction.');
  }
  return {
    id: t.id,
    status: t.status,
    ...(typeof t.more_info_url === 'string' ? { moreInfoUrl: t.more_info_url } : {}),
    ...(typeof t.amount_in === 'string' ? { amountIn: t.amount_in } : {}),
    ...(typeof t.amount_out === 'string' ? { amountOut: t.amount_out } : {}),
  };
}

// What the anchor supports for one asset on one side (deposit or withdraw).
export interface AssetTransferInfo {
  assetCode: string;
  enabled: boolean;
  minAmount?: number;
  maxAmount?: number;
  feeFixed?: number;
  feePercent?: number;
}

export interface Sep24Info {
  deposit: AssetTransferInfo[]; // sorted by assetCode
  withdraw: AssetTransferInfo[];
}

function numberField(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function parseAssetMap(raw: unknown): AssetTransferInfo[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: AssetTransferInfo[] = [];
  for (const [assetCode, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = (value ?? {}) as Record<string, unknown>;
    out.push({
      assetCode,
      // SEP-24 omits `enabled` to mean true; only an explicit `false` disables.
      enabled: v.enabled !== false,
      ...(numberField(v.min_amount) !== undefined ? { minAmount: numberField(v.min_amount) } : {}),
      ...(numberField(v.max_amount) !== undefined ? { maxAmount: numberField(v.max_amount) } : {}),
      ...(numberField(v.fee_fixed) !== undefined ? { feeFixed: numberField(v.fee_fixed) } : {}),
      ...(numberField(v.fee_percent) !== undefined ? { feePercent: numberField(v.fee_percent) } : {}),
    });
  }
  return out.sort((a, b) => a.assetCode.localeCompare(b.assetCode));
}

/**
 * Discover which assets an anchor supports for deposit/withdraw, plus per-asset
 * limits and fees, via SEP-24 `GET /info`. Public endpoint — no SEP-10 JWT
 * needed — so a "Cash in / Cash out" screen can list supported assets (e.g. XLM,
 * USDC) before the user authenticates. Assets are returned sorted by code with
 * `enabled` preserved so the caller can filter or grey out disabled ones.
 */
export async function fetchSep24Info(
  transferServer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Sep24Info> {
  const res = await fetchImpl(`${base(transferServer)}/info`);
  if (!res.ok) throw new Error(`Could not load anchor info (${res.status}).`);
  const body = (await res.json()) as { deposit?: unknown; withdraw?: unknown };
  return {
    deposit: parseAssetMap(body.deposit),
    withdraw: parseAssetMap(body.withdraw),
  };
}
