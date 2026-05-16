#!/usr/bin/env node
/**
 * Lee NDJSON (stdin o --file) y agrega métricas sobre eventos `ia_agent_access`.
 *
 * Formatos:
 * - Una línea = un JSON de access (como en consola / export manual).
 * - Una línea = un evento Workers Trace (Logpush) con campo `Logs` y mensajes JSON embebidos.
 *
 * Uso:
 *   node scripts/aggregate-ia-agent-access.mjs --file ./logs.ndjson
 *   cat logs.ndjson | node scripts/aggregate-ia-agent-access.mjs
 *
 * Opciones:
 *   --file <ruta>   Entrada (si falta, stdin).
 *   --script-name   Filtra eventos trace por `ScriptName` (p.ej. ia-agent-worker).
 */

import fs from "node:fs";
import readline from "node:readline";
import { aggregateAccessRows, extractAccessRowsFromRecord } from "./lib/ia-agent-access-aggregate.mjs";

function parseArgs(argv) {
  /** @type {{ file?: string; scriptName?: string }} */
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" && argv[i + 1]) {
      out.file = argv[++i];
    } else if (a === "--script-name" && argv[i + 1]) {
      out.scriptName = argv[++i];
    } else if (a === "--help" || a === "-h") {
      console.error(`Ver cabecera de ${import.meta.url}`);
      process.exit(0);
    }
  }
  return out;
}

/**
 * @param {AsyncIterable<string>} lines
 * @param {{ scriptName?: string }} opts
 */
async function collectRows(lines, opts) {
  const rows = [];
  let linesRead = 0;
  let parseErrors = 0;
  for await (const line of lines) {
    linesRead++;
    const trimmed = line.replace(/^\uFEFF/, "").trim();
    if (!trimmed) continue;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      parseErrors++;
      continue;
    }
    rows.push(...extractAccessRowsFromRecord(record, { scriptName: opts.scriptName }));
  }
  return { rows, linesRead, parseErrors };
}

async function main() {
  const opts = parseArgs(process.argv);
  const input = opts.file ? fs.createReadStream(opts.file) : process.stdin;
  if (opts.file && !fs.existsSync(opts.file)) {
    console.error(`No existe el fichero: ${opts.file}`);
    process.exit(1);
  }
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const { rows, linesRead, parseErrors } = await collectRows(rl, { scriptName: opts.scriptName });
  const aggregate = aggregateAccessRows(rows);
  const out = {
    schema: "ia_agent_access_aggregate_v1",
    source: {
      lines_read: linesRead,
      ndjson_lines_unparsed: parseErrors,
      access_rows: rows.length,
      script_name_filter: opts.scriptName ?? null,
    },
    ...aggregate,
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  if (rows.length === 0 && linesRead > 0) {
    console.error(
      "Aviso: no se extrajo ninguna fila `ia_agent_access`. Comprueba formato (trace vs access) o el filtro --script-name.",
    );
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
