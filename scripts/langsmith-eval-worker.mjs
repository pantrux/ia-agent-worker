/**
 * Evalúa el dataset LangSmith contra el Worker remoto (POST /api/chat).
 * Requiere LANGSMITH_API_KEY, LANGSMITH_TRACING=true, WORKER_SMOKE_URL.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { traceable } from "langsmith/traceable";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATASET_FILE = path.join(ROOT, "evals", "dataset-v0.json");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function resolveBaseUrl() {
  const raw = process.env.WORKER_SMOKE_URL?.trim();
  if (!raw) {
    fail(`WORKER_SMOKE_URL no está definida.

Misma variable que el smoke HTTP: URL base del Worker sin path final.
`);
  }
  return raw.replace(/\/+$/, "");
}

async function readDatasetName() {
  const raw = process.env.LANGSMITH_EVAL_DATASET_NAME?.trim();
  if (raw) return raw;
  const j = JSON.parse(await readFile(DATASET_FILE, "utf8"));
  return j.datasetName;
}

function buildTarget(baseUrl) {
  return traceable(
    async (inputs) => {
      const message = inputs?.message;
      if (typeof message !== "string" || !message.trim()) {
        return { httpOk: false, reply: "", error: "inputs.message requerido" };
      }
      const body = { message: message.trim() };
      if (typeof inputs.thread_id === "string" && inputs.thread_id.trim()) {
        body.thread_id = inputs.thread_id.trim();
      }
      const headers = { "Content-Type": "application/json" };
      const bff = process.env.WORKER_SMOKE_BFF_TOKEN?.trim();
      if (bff) headers.Authorization = `Bearer ${bff}`;

      const url = `${baseUrl}/api/chat`;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 120_000);
      try {
        const r = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        const text = await r.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          return { httpOk: r.ok, reply: "", error: "body_no_json", status: r.status };
        }
        const reply = typeof data?.reply === "string" ? data.reply : "";
        return {
          httpOk: r.ok,
          status: r.status,
          reply,
          thread_id: data?.thread_id,
          chatStatus: data?.status,
        };
      } catch (e) {
        return {
          httpOk: false,
          reply: "",
          error: String(e?.cause?.message ?? e?.message ?? e),
        };
      } finally {
        clearTimeout(t);
      }
    },
    { name: "ia_agent_worker_chat_eval" }
  );
}

function evaluators() {
  return [
    async ({ outputs, referenceOutputs }) => {
      const reply = String(outputs?.reply ?? "").trim();
      const must = referenceOutputs?.replyMustInclude != null
        ? String(referenceOutputs.replyMustInclude).trim()
        : "";
      const httpOk = outputs?.httpOk === true;
      const usable = httpOk && reply.length > 0;
      const match = !must || reply.toLowerCase().includes(must.toLowerCase());
      const score = usable && match ? 1 : 0;
      return {
        results: [
          {
            key: "eval_pass",
            score,
            comment: JSON.stringify({
              httpOk,
              usable,
              match,
              preview: reply.slice(0, 160),
            }),
          },
        ],
      };
    },
  ];
}

async function main() {
  if (!process.env.LANGSMITH_API_KEY?.trim()) {
    fail("LANGSMITH_API_KEY es obligatoria para evaluar en LangSmith.");
  }
  process.env.LANGSMITH_TRACING = process.env.LANGSMITH_TRACING ?? "true";
  if (process.env.LANGSMITH_TRACING !== "true") {
    fail("LANGSMITH_TRACING debe ser true para el runner evaluate() del SDK.");
  }

  const baseUrl = resolveBaseUrl();
  const datasetName = await readDatasetName();
  const minMean = Number.parseFloat(process.env.EVAL_MIN_MEAN_SCORE ?? "0.875");
  if (Number.isNaN(minMean) || minMean < 0 || minMean > 1) {
    fail("EVAL_MIN_MEAN_SCORE debe ser un número entre 0 y 1.");
  }

  const client = new Client();
  const target = buildTarget(baseUrl);

  const prefix =
    process.env.LANGSMITH_EXPERIMENT_PREFIX?.trim() ||
    (process.env.GITHUB_SHA ? `ci-${process.env.GITHUB_SHA.slice(0, 7)}` : "local-eval");

  console.log(`Experimento LangSmith: dataset="${datasetName}" target=${baseUrl} prefix=${prefix}`);

  const expResults = await evaluate(target, {
    data: datasetName,
    evaluators: evaluators(),
    client,
    maxConcurrency: 2,
    experimentPrefix: prefix,
    description: "Eval remota ia-agent-worker (POST /api/chat)",
    metadata: {
      worker_base_url: baseUrl,
      repo: "ia-agent-worker",
    },
  });

  const scores = [];
  // Tras `await evaluate()`, `ExperimentResults.results` ya es un array materializado (ver SDK langsmith).
  for (const row of expResults.results) {
    const results = row.evaluationResults?.results ?? [];
    for (const r of results) {
      if (r.key === "eval_pass" && typeof r.score === "number") scores.push(r.score);
    }
  }

  if (!scores.length) {
    fail("No se obtuvieron puntuaciones eval_pass; revisa el experimento en LangSmith.");
  }

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`Media eval_pass=${mean.toFixed(4)} (n=${scores.length}), umbral=${minMean}`);

  if (mean < minMean) {
    fail(`Evaluación por debajo del umbral (${mean} < ${minMean}).`);
  }

  console.log("Evaluación superada.");
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
