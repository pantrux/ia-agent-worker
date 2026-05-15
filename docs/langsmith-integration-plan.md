# Plan: LangSmith + este Worker (Cloudflare)

Integración de **LangSmith** para depuración, monitorización y trazas del agente **LangGraph.js** desplegado como Cloudflare Worker (este repo).

Contexto del ecosistema: [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md).

## Alcance

- **Implementación en este repo:** Worker serverless, **LangGraph.js**, **D1**, `@langchain/openai`, rutas `POST /api/chat` y resume HITL.
- **Fuera de alcance:** el repo de referencia Python (`ia-agent-mvp` / FastAPI en contenedor); solo sirve para comparar comportamiento.

## Arquitectura objetivo

```mermaid
sequenceDiagram
  participant Client
  participant Worker as CF_Worker_LangGraphJS
  participant D1
  participant LLM as GitHubModels_OpenAI
  participant LS as LangSmith

  Client->>Worker: POST /api/chat
  Worker->>Worker: graph.invoke / stream
  Worker->>D1: checkpoints
  Worker->>LLM: ChatOpenAI
  Worker-->>LS: runs / spans
  Worker-->>Client: JSON
```

La orquestación corre **en el Worker**; LangSmith recibe trazas desde el mismo isolate.

### Datasets y evaluación (B3 / LLMOps)

Además del **tracing** en tiempo real, LangSmith concentra el **dataset de referencia** y los **experimentos** contra el despliegue real del Worker:

| Artefacto | Dónde vive | Notas |
|-----------|------------|--------|
| Snapshot versionado (casos de prueba) | Repo: `evals/dataset-v0.json` | Revisión en PR; no sustituye al dataset operativo en LangSmith. |
| Dataset operativo y ejemplos | LangSmith (nombre configurable) | Se actualiza con `npm run langsmith:dataset:sync`. |
| Resultados de eval (scores, runs) | LangSmith (vista de experimento) | `npm run langsmith:eval` usa `evaluate()` del SDK; el target es HTTP `POST /api/chat` al Worker remoto. |
| Puerta CI opcional | GitHub Actions | Tras smoke: si existe `LANGSMITH_API_KEY`, sync + eval; umbral `EVAL_MIN_MEAN_SCORE`. |

Documentación operativa: [B3-langsmith-llmops.md](./B3-langsmith-llmops.md).

## Diseño

### 1) Dependencias (npm)

Añadir **`langsmith`** al `package.json` solo si se requieren imports directos del SDK; verificar primero con `npm ls langsmith` qué versión ya resuelve `@langchain/core` y alinear el rango para evitar conflictos.

### 2) Variables de entorno en Cloudflare

En **`wrangler.toml`** / dashboard:

| Variable | Notas |
|----------|--------|
| `LANGSMITH_TRACING` | `true` |
| `LANGCHAIN_CALLBACKS_BACKGROUND` | `false` en serverless para forzar flush de callbacks antes de terminar la request |
| `LANGSMITH_API_KEY` | Secreto: `wrangler secret put LANGSMITH_API_KEY` |
| `LANGSMITH_PROJECT` | Nombre del proyecto en LangSmith (puede ir en `[vars]`) |

Si la versión instalada documenta `LANGCHAIN_TRACING_V2` / `LANGCHAIN_API_KEY`, unificar con el esquema `LANGSMITH_*` vigente para no duplicar claves.

### 3) Código del Worker

Donde se invoque el grafo (`invoke`, `stream`, etc.), pasar en el config **`metadata`** y opcionalmente **`tags`**:

- `thread_id` (coherente con D1 / cliente demo)
- `operation`: `chat` vs `resume` (HITL)
- `deployment`: `production` / `preview` si aplica

La forma exacta del config depende de la versión de **LangGraph.js**; seguir la documentación oficial LangGraph JS + LangSmith para esa versión.

### 4) Compatibilidad Workers

- HTTPS saliente hacia la API de LangSmith debe estar permitido.
- Si el SDK asume solo Node, revisar soporte edge / `fetch` en Workers.
- Añadir `compatibility_flags = ["nodejs_compat"]` en `wrangler.toml` si el SDK usa APIs de Node internamente (`buffer`, `https`, etc.).

### 5) CI/CD

- **Tracing en deploy:** propagar `LANGSMITH_API_KEY` en el workflow de deploy (como otros secretos), o documentar `secret put` manual.
- **Eval B3:** secreto `LANGSMITH_API_KEY` en Actions + `WORKER_SMOKE_URL` (misma variable que el smoke); ver `docs/B3-langsmith-llmops.md` y el job `langsmith` en `worker-smoke.yml`.

### 6) Verificación

- Tras deploy: petición desde la landing `/demo` o `curl` al Worker → **runs** en LangSmith con `thread_id` en metadata.
- Probar **resume** tras interrupt para validar trazas de HITL.

### 7) Privacidad

Los contenidos de chat y herramientas se envían a LangSmith según el proyecto elegido; usar un proyecto dedicado para demos.

## Tareas de implementación

1. Añadir dependencia `langsmith` y actualizar lockfile.
2. Definir vars/secrets en Wrangler + nota en README.
3. En la invocación del grafo: `metadata` / `tags` (`thread_id`, `operation`, …).
4. Validar en la UI de LangSmith tras deploy a preview/staging.
5. Dataset v0: editar `evals/dataset-v0.json` y ejecutar `npm run langsmith:dataset:sync` con `LANGSMITH_API_KEY`.
6. Antes de depurar 403: `npm run langsmith:api-preflight` y [LANGSMITH-API-CONTRACT.md](./LANGSMITH-API-CONTRACT.md).
7. Eval remota: `npm run langsmith:eval` (requiere `LANGSMITH_TRACING=true`, Worker accesible y dataset ya sincronizado).
8. (Opcional) Secreto `LANGSMITH_API_KEY` en GitHub para el paso de eval en CI.
