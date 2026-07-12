// Stub for @core/blend/positions — the reference render shows no existing
// supplied positions, so return an empty set. Types are redeclared locally to
// avoid a circular self-import (this module is aliased over the real one).
export interface SuppliedPosition {
  code: string;
  suppliedBase: string;
  decimals: number;
}
export interface ReserveRef {
  code: string;
  assetId: string;
}

export async function readSuppliedPositions(
  _poolId: string,
  _user: string,
  _reserves: ReserveRef[],
): Promise<SuppliedPosition[]> {
  return [];
}
