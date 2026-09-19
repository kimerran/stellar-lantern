// Stage 3c — the unverified-contract fallback (#56).
//
// Anything 3a (classic ops) and 3b (the five token functions) did not decode
// is reported raw: contract id, function name, losslessly decoded arguments,
// depth in the auth tree — under a structured label that says the scanner
// does not know what it means. No name matching ("looks like a swap"), no
// inference from argument shapes. The label is a constant so the UI and the
// explainer cannot lose it. "Unknown contracts never guessed."

import type { AuthCall, AuthTree, DecodedTx, UnverifiedCall } from './types';
import { UNVERIFIED_LABEL } from './types';
import { recogniseTokenCall } from './token';

export function unverifiedCalls(decoded: DecodedTx, authTree: AuthTree): UnverifiedCall[] {
  const out: UnverifiedCall[] = [];
  const fromAuth = (c: AuthCall): UnverifiedCall => ({
    label: UNVERIFIED_LABEL,
    contractId: c.contractId!,
    functionName: c.functionName ?? '',
    args: c.args,
    depth: c.depth,
    entryIndex: c.entryIndex,
    path: c.path,
    credentials: c.credentials,
  });
  for (const c of authTree.calls) {
    if (c.kind !== 'contract' || !c.contractId) continue;
    if (recogniseTokenCall(c)) continue;
    out.push(fromAuth(c));
  }
  // The root invokeHostFunction op may need no authorisation entry at all
  // (a call that moves nothing of the signer's — or one whose effects the
  // auth tree simply does not describe). It is still a call the scanner
  // did not decode.
  const rootInTree = authTree.calls.some((c) => c.depth === 0);
  if (!rootInTree) {
    for (const op of decoded.operations) {
      if (op.type !== 'invokeHostFunction' || !op.contractId || !op.contractFunction) continue;
      out.push({
        label: UNVERIFIED_LABEL,
        contractId: op.contractId,
        functionName: op.contractFunction,
        args: op.contractArgs ?? [],
        depth: 0,
      });
    }
  }
  return out;
}
