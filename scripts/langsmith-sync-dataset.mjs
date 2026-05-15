/**
 * Sincroniza evals/dataset-v0.json → dataset en LangSmith (reemplaza ejemplos).
 * Requiere LANGSMITH_API_KEY.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "langsmith";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATASET_FILE = path.join(ROOT, "evals", "dataset-v0.json");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function listAllExampleIds(client, datasetId) {
  const ids = [];
  for await (const ex of client.listExamples({ datasetId, limit: 500 })) {
    ids.push(ex.id);
  }
  return ids;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  if (!process.env.LANGSMITH_API_KEY?.trim()) {
    fail(`LANGSMITH_API_KEY no está definida.

Define la API key de LangSmith (workspace) antes de sincronizar, por ejemplo:
  export LANGSMITH_API_KEY=lsv2_…
`);
  }

  const raw = await readFile(DATASET_FILE, "utf8");
  const spec = JSON.parse(raw);
  if (!spec?.datasetName || !Array.isArray(spec.examples)) {
    fail("dataset-v0.json inválido: faltan datasetName o examples[].");
  }

  const client = new Client();
  let dataset;
  if (await client.hasDataset({ datasetName: spec.datasetName })) {
    dataset = await client.readDataset({ datasetName: spec.datasetName });
    if (spec.description) {
      dataset = await client.updateDataset({
        datasetId: dataset.id,
        description: spec.description,
      });
    }
  } else {
    dataset = await client.createDataset(spec.datasetName, {
      description: spec.description ?? "ia-agent-worker eval v0",
    });
  }

  const existingIds = await listAllExampleIds(client, dataset.id);
  for (const part of chunk(existingIds, 50)) {
    if (part.length) await client.deleteExamples(part, { hardDelete: true });
  }

  const uploads = spec.examples.map((ex) => ({
    inputs: ex.inputs,
    outputs: ex.outputs ?? {},
    metadata: {
      ...(ex.metadata ?? {}),
      snapshotVersion: spec.version,
      snapshotFile: "evals/dataset-v0.json",
    },
    dataset_id: dataset.id,
  }));

  await client.createExamples(uploads);

  const url = await client.getDatasetUrl({ datasetId: dataset.id });
  console.log(`Dataset "${spec.datasetName}" sincronizado (${uploads.length} ejemplos).`);
  console.log(url);
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
