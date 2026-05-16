/**
 * Agregación de métricas HTTP a partir de líneas `ia_agent_access` o de eventos
 * Workers Trace (Logpush `workers_trace_events`, campo `Logs`).
 * Sin dependencias externas; pensado para jobs CLI y CI.
 */

/** @typedef {{ operation: string, duration_ms: number, status: number, ts?: string | null }} AccessRow */

/**
 * Percentil con regla de rango más cercano (Ne R), común en métricas de latencia.
 * `sorted` debe estar ordenado de menor a mayor.
 * @param {number[]} sorted
 * @param {number} p fracción en (0,1], p.ej. 0.95
 * @returns {number | null}
 */
export function percentileNearestRank(sorted, p) {
  if (sorted.length === 0) return null;
  const n = sorted.length;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return sorted[idx];
}

/**
 * @param {unknown} o
 * @returns {AccessRow | null}
 */
export function accessRowFromObject(o) {
  if (!o || typeof o !== "object") return null;
  const rec = /** @type {Record<string, unknown>} */ (o);
  if (rec.msg !== "ia_agent_access") return null;
  if (typeof rec.duration_ms !== "number" || typeof rec.status !== "number" || typeof rec.operation !== "string") {
    return null;
  }
  const ts = rec.ts;
  return {
    operation: rec.operation,
    duration_ms: rec.duration_ms,
    status: rec.status,
    ts: typeof ts === "string" ? ts : null,
  };
}

/**
 * Intenta interpretar un fragmento de texto como JSON de access log.
 * @param {string} text
 * @returns {AccessRow | null}
 */
export function accessRowFromText(text) {
  const s = text.trim();
  if (!s.startsWith("{")) return null;
  try {
    return accessRowFromObject(JSON.parse(s));
  } catch {
    return null;
  }
}

/**
 * Extrae filas `ia_agent_access` de una línea NDJSON ya parseada.
 * Soporta: (1) objeto access directo; (2) evento trace con `Logs` (Logpush).
 * @param {unknown} record
 * @param {{ scriptName?: string }} [opts]
 * @returns {AccessRow[]}
 */
export function extractAccessRowsFromRecord(record, opts = {}) {
  const rows = /** @type {AccessRow[]} */ ([]);
  if (!record || typeof record !== "object") return rows;
  const rec = /** @type {Record<string, unknown>} */ (record);
  if (opts.scriptName && typeof rec.ScriptName === "string" && rec.ScriptName !== opts.scriptName) {
    return rows;
  }
  const direct = accessRowFromObject(rec);
  if (direct) {
    rows.push(direct);
    return rows;
  }
  const logs = rec.Logs;
  if (!Array.isArray(logs)) return rows;
  for (const entry of logs) {
    if (!entry || typeof entry !== "object") continue;
    const e = /** @type {Record<string, unknown>} */ (entry);
    const parts = e.Message ?? e.message;
    const texts = Array.isArray(parts) ? parts : typeof parts === "string" ? [parts] : [];
    for (const t of texts) {
      if (typeof t !== "string") continue;
      const row = accessRowFromText(t);
      if (row) rows.push(row);
    }
  }
  return rows;
}

/**
 * @param {AccessRow[]} rows
 * @returns {{ by_operation: Record<string, { count: number; duration_ms_p50: number | null; duration_ms_p95: number | null; http_4xx: number; http_5xx: number }>; totals: { count: number; duration_ms_p50: number | null; duration_ms_p95: number | null; http_4xx: number; http_5xx: number } }}
 */
export function aggregateAccessRows(rows) {
  /** @type {Map<string, AccessRow[]>} */
  const byOp = new Map();
  for (const r of rows) {
    const op = r.operation || "unknown";
    if (!byOp.has(op)) byOp.set(op, []);
    byOp.get(op).push(r);
  }
  /** @type {Record<string, { count: number; duration_ms_p50: number | null; duration_ms_p95: number | null; http_4xx: number; http_5xx: number }>} */
  const by_operation = {};
  for (const [op, list] of byOp) {
    const durations = list.map((x) => x.duration_ms).filter((x) => typeof x === "number");
    const sorted = [...durations].sort((a, b) => a - b);
    by_operation[op] = {
      count: list.length,
      duration_ms_p50: percentileNearestRank(sorted, 0.5),
      duration_ms_p95: percentileNearestRank(sorted, 0.95),
      http_4xx: list.filter((x) => x.status >= 400 && x.status < 500).length,
      http_5xx: list.filter((x) => x.status >= 500).length,
    };
  }
  const allDur = rows.map((x) => x.duration_ms).filter((x) => typeof x === "number");
  const sortedAll = [...allDur].sort((a, b) => a - b);
  return {
    by_operation,
    totals: {
      count: rows.length,
      duration_ms_p50: percentileNearestRank(sortedAll, 0.5),
      duration_ms_p95: percentileNearestRank(sortedAll, 0.95),
      http_4xx: rows.filter((x) => x.status >= 400 && x.status < 500).length,
      http_5xx: rows.filter((x) => x.status >= 500).length,
    },
  };
}
