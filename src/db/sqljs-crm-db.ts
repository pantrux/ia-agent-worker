import type { Database, SqlBindValue } from "sql.js";
import type { CrmDatabase, CrmPreparedStatement } from "./crm-db.js";

/**
 * Wraps a sql.js in-memory DB with the same async chaining shape as D1 for CRM tools.
 */
class SqlJsPreparedStatement implements CrmPreparedStatement {
  constructor(
    private readonly db: Database,
    private readonly sql: string,
    private readonly params: SqlBindValue[] = []
  ) {}

  bind(...values: unknown[]): CrmPreparedStatement {
    return new SqlJsPreparedStatement(this.db, this.sql, values as SqlBindValue[]);
  }

  async all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> {
    const stmt = this.db.prepare(this.sql);
    try {
      if (this.params.length > 0) {
        stmt.bind(this.params);
      }
      const results: T[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
      }
      return { results };
    } finally {
      stmt.free();
    }
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    try {
      if (this.params.length > 0) {
        stmt.bind(this.params);
      }
      if (!stmt.step()) return null;
      return stmt.getAsObject() as T;
    } finally {
      stmt.free();
    }
  }

  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> {
    if (this.params.length === 0) {
      this.db.run(this.sql);
    } else {
      this.db.run(this.sql, this.params);
    }
    const changes = this.db.getRowsModified();
    return { success: true, meta: { changes, last_row_id: 0 } };
  }
}

export function wrapSqlJsAsCrmDatabase(db: Database): CrmDatabase {
  return {
    prepare(query: string): CrmPreparedStatement {
      return new SqlJsPreparedStatement(db, query);
    },
  };
}
