import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  accessRowFromObject,
  aggregateAccessRows,
  extractAccessRowsFromRecord,
  percentileNearestRank,
} from "./lib/ia-agent-access-aggregate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "aggregate-ia-agent-access.mjs");

test("percentileNearestRank p95 con cinco muestras", () => {
  const sorted = [10, 20, 30, 40, 50];
  assert.equal(percentileNearestRank(sorted, 0.95), 50);
  assert.equal(percentileNearestRank(sorted, 0.5), 30);
});

test("extractAccessRowsFromRecord acepta línea access directa", () => {
  const row = accessRowFromObject({
    msg: "ia_agent_access",
    duration_ms: 12,
    status: 200,
    operation: "ping",
  });
  assert.ok(row);
  assert.equal(row.operation, "ping");
});

test("extractAccessRowsFromRecord lee Logs en evento trace", () => {
  const inner = JSON.stringify({
    msg: "ia_agent_access",
    duration_ms: 99,
    status: 200,
    operation: "resume",
  });
  const rows = extractAccessRowsFromRecord({
    ScriptName: "ia-agent-worker",
    Logs: [{ Level: "log", Message: [inner] }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].duration_ms, 99);
  assert.equal(rows[0].operation, "resume");
});

test("filtro scriptName excluye otros workers", () => {
  const inner = JSON.stringify({
    msg: "ia_agent_access",
    duration_ms: 1,
    status: 200,
    operation: "ping",
  });
  const rows = extractAccessRowsFromRecord(
    {
      ScriptName: "otro-worker",
      Logs: [{ Level: "log", Message: [inner] }],
    },
    { scriptName: "ia-agent-worker" },
  );
  assert.equal(rows.length, 0);
});

test("aggregateAccessRows cuenta 4xx/5xx y p95 por operation", () => {
  const rows = [
    { operation: "chat", duration_ms: 10, status: 200 },
    { operation: "chat", duration_ms: 20, status: 200 },
    { operation: "chat", duration_ms: 30, status: 200 },
    { operation: "chat", duration_ms: 40, status: 200 },
    { operation: "chat", duration_ms: 50, status: 429 },
    { operation: "chat", duration_ms: 5, status: 503 },
  ];
  const agg = aggregateAccessRows(rows);
  assert.equal(agg.by_operation.chat.count, 6);
  assert.equal(agg.by_operation.chat.http_4xx, 1);
  assert.equal(agg.by_operation.chat.http_5xx, 1);
  assert.equal(agg.by_operation.chat.duration_ms_p95, 50);
});

test("CLI sobre fixtures access-only-sample.ndjson", () => {
  const fixture = path.join(__dirname, "fixtures", "access-only-sample.ndjson");
  const out = execFileSync(process.execPath, [scriptPath, "--file", fixture], { encoding: "utf8" });
  const j = JSON.parse(out);
  assert.equal(j.source.access_rows, 6);
  assert.equal(j.by_operation.chat.count, 6);
  assert.equal(j.by_operation.chat.duration_ms_p95, 50);
});

test("CLI sobre fixtures workers-trace-sample.ndjson", () => {
  const fixture = path.join(__dirname, "fixtures", "workers-trace-sample.ndjson");
  const out = execFileSync(process.execPath, [scriptPath, "--file", fixture], { encoding: "utf8" });
  const j = JSON.parse(out);
  assert.equal(j.source.access_rows, 2);
  assert.ok(j.by_operation.chat);
  assert.ok(j.by_operation.ping);
});

test("CLI con --script-name reduce filas", () => {
  const fixture = path.join(__dirname, "fixtures", "workers-trace-sample.ndjson");
  const out = execFileSync(process.execPath, [scriptPath, "--file", fixture, "--script-name", "ia-agent-worker"], {
    encoding: "utf8",
  });
  const j = JSON.parse(out);
  assert.equal(j.source.access_rows, 1);
  assert.equal(j.by_operation.chat.duration_ms_p95, 42);
});

test("CLI sin filas access emite código de salida 2", () => {
  const emptyPath = path.join(__dirname, "fixtures", "empty.ndjson");
  fs.writeFileSync(emptyPath, '{"ScriptName":"x","Logs":[]}\n', "utf8");
  try {
    const r = spawnSync(process.execPath, [scriptPath, "--file", emptyPath], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.ok(String(r.stdout).includes("access_rows"));
  } finally {
    fs.unlinkSync(emptyPath);
  }
});
