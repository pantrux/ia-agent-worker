# B3 — LLMOps: datasets y evaluación centrados en LangSmith

Este documento sustituye la idea de un **dataset solo en Git** como fuente de verdad para calidad. La estrategia acordada es:

- **LangSmith** es la plataforma unificada para trazas, datasets, experimentos y métricas de evaluación.
- El repositorio mantiene un **snapshot versionado** (`evals/dataset-v0.json`) para revisiones en PR y reproducibilidad; el **dataset operativo** vive en LangSmith y se actualiza con el script de sincronización.
- **GitHub Actions** actúa como puerta opcional: si existen credenciales, ejecuta sincronización + experimento y **falla** si la media de la métrica `eval_pass` cae por debajo del umbral.

## Referencia de API (sin prueba y error)

Contrato oficial de host, cabeceras `X-Api-Key` / `X-Tenant-Id` y rutas `/api/v1`: [LANGSMITH-API-CONTRACT.md](./LANGSMITH-API-CONTRACT.md).  
Diagnóstico rápido: `npm run langsmith:api-preflight`.

## Flujo

1. Editas `evals/dataset-v0.json` (inputs `message`, salidas de referencia opcionales `replyMustInclude`).
2. `npm run langsmith:dataset:sync` — crea el dataset si no existe, reemplaza ejemplos en LangSmith según el JSON del repo.
3. `npm run langsmith:eval` — lanza un experimento contra el Worker remoto (`WORKER_SMOKE_URL`): cada caso genera runs en LangSmith y evaluadores registran `eval_pass`.
4. Revisas el experimento en la UI de LangSmith (comparación entre despliegues, trazas por ejemplo fallido).

## Variables de entorno

| Variable | Obligatoria | Uso |
|----------|-------------|-----|
| `LANGSMITH_API_KEY` | Sí (sync y eval) | API key del workspace LangSmith. |
| `LANGSMITH_WORKSPACE_ID` | A veces (service key multi-workspace) | UUID del workspace en LangSmith. Si la API responde **403** en `/datasets` pese a una service key válida, define esta variable (local y/o **Variable** en GitHub Actions). El SDK la envía como cabecera de tenant. **No confundir** con el ID de un **proyecto** (`LANGSMITH_PROJECT`). |
| `LANGSMITH_ENDPOINT` | Solo cuentas/región distinta | URL base de la API. Por defecto el SDK usa la región US. Cuentas **EU** suelen requerir `https://eu.api.smith.langchain.com` (variable en GitHub y/o local). Sin esto, la clave puede parecer válida pero `/datasets` devuelve **403**. |
| `LANGSMITH_TRACING` | Recomendada (`true` en eval) | El runner de `evaluate()` exige trazas en el target. |
| `LANGSMITH_PROJECT` | Opcional | Proyecto de trazas (mismo criterio que el Worker). |
| `LANGSMITH_EVAL_DATASET_NAME` | No | Nombre del dataset en LangSmith (por defecto coincide con `datasetName` del JSON). |
| `WORKER_SMOKE_URL` | Sí en eval | Base URL del Worker (sin path). |
| `WORKER_SMOKE_BFF_TOKEN` | Según despliegue | Bearer si el Worker exige `BFF_API_TOKEN`. |
| `EVAL_MIN_MEAN_SCORE` | No | Media mínima de `eval_pass` (0–1). Por defecto `0.875`. |

## Métrica inicial (`eval_pass`)

Por cada ejemplo del dataset:

- `httpOk`: la petición `POST /api/chat` respondió HTTP 2xx.
- `reply` no vacío.
- Si en el JSON hay `outputs.replyMustInclude`, la respuesta debe contener esa subcadena (sin distinguir mayúsculas).

`eval_pass = 1` solo si se cumplen todas las condiciones anteriores.

## CI

En [`.github/workflows/worker-smoke.yml`](../.github/workflows/worker-smoke.yml), tras el smoke remoto, si `secrets.LANGSMITH_API_KEY` está definido se ejecuta primero **`npm run langsmith:api-preflight`** (mismas variables `LANGSMITH_*` que el sync) y después `langsmith:dataset:sync` y `langsmith:eval`. Si el secreto no existe, los pasos LangSmith se omiten con aviso. Para **puerta estricta** en `main`, configura el secreto en el repositorio. Opcional: **`LANGSMITH_WORKSPACE_ID`** (UUID del **workspace**, no del proyecto). Opcional: **`LANGSMITH_ENDPOINT`** (p. ej. `https://eu.api.smith.langchain.com` para cuentas EU) si ves **403** en `/datasets` con la URL por defecto.

## Referencias

- Contrato API (OpenAPI / cabeceras / regiones): [LANGSMITH-API-CONTRACT.md](./LANGSMITH-API-CONTRACT.md)
- Roadmap: [ROADMAP-CF-LANGSMITH.md](./ROADMAP-CF-LANGSMITH.md) (Fase B, B3).
- Trazas del Worker: [langsmith-integration-plan.md](./langsmith-integration-plan.md).
- API datasets: [gestión programática de datasets](https://docs.langchain.com/langsmith/manage-datasets-programmatically) (LangChain Docs).
