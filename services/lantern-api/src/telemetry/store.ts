// Telemetry storage (#85). One interface, two implementations: Postgres for
// the deployment, in-memory for the offline suite. Rows are exactly the
// columns below — the validator has already guaranteed enum-only props, so
// nothing here inspects content.

export interface TelemetryRow {
  id: number;
  installId: string;
  platform: string;
  appVersion: string;
  network: string;
  event: string;
  props: Record<string, string | boolean>;
  ts: Date;
  receivedAt: Date;
}

export type NewRow = Omit<TelemetryRow, 'id' | 'receivedAt'>;

export interface ExportQuery {
  since?: Date;
  until?: Date;
  afterId?: number;
  limit: number;
}

export interface TelemetryStore {
  insert(rows: NewRow[], receivedAt: Date): Promise<number>;
  deleteInstall(installId: string): Promise<number>;
  export(q: ExportQuery): Promise<TelemetryRow[]>;
  purgeBefore(cutoff: Date): Promise<number>;
  ping(): Promise<boolean>;
}

export function memoryStore(): TelemetryStore & { rows: TelemetryRow[] } {
  const rows: TelemetryRow[] = [];
  let nextId = 1;
  return {
    rows,
    async insert(newRows, receivedAt) {
      for (const r of newRows) rows.push({ ...r, id: nextId++, receivedAt });
      return newRows.length;
    },
    async deleteInstall(installId) {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1)
        if (rows[i]!.installId === installId) rows.splice(i, 1);
      return before - rows.length;
    },
    async export(q) {
      return rows
        .filter(
          (r) =>
            (q.afterId === undefined || r.id > q.afterId) &&
            (q.since === undefined || r.receivedAt >= q.since) &&
            (q.until === undefined || r.receivedAt < q.until),
        )
        .sort((a, b) => a.id - b.id)
        .slice(0, q.limit);
    },
    async purgeBefore(cutoff) {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1)
        if (rows[i]!.receivedAt < cutoff) rows.splice(i, 1);
      return before - rows.length;
    },
    async ping() {
      return true;
    },
  };
}
