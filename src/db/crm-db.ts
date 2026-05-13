/**
 * Minimal async SQL surface used by CRM tools.
 * Cloudflare D1 satisfies this structurally at runtime on the Worker.
 */
export interface CrmPreparedStatement {
  bind(...values: unknown[]): CrmPreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }>;
}

export interface CrmDatabase {
  prepare(query: string): CrmPreparedStatement;
}
