/** Minimal typings for sql.js (no official @types package aligned with 1.x). */
declare module "sql.js" {
  export type SqlBindValue = string | number | bigint | boolean | Uint8Array | null | undefined;

  export class Statement {
    bind(values?: SqlBindValue[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
    reset(): boolean;
  }

  export class Database {
    constructor(data?: ArrayLike<number>);
    run(sql: string, params?: SqlBindValue[]): void;
    exec(sql: string): void;
    prepare(sql: string): Statement;
    getRowsModified(): number;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export default function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;
}
