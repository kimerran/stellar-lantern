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
