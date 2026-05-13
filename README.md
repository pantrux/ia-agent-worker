# ia-agent-worker — Serverless IA Agent on Cloudflare Workers

Port completo del agente [`pantrux/ia-agent-mvp`](https://github.com/pantrux/ia-agent-mvp) (Python / LangGraph) a **TypeScript** ejecutándose como **Cloudflare Worker serverless** — sin Docker, sin Containers, plan Free de Workers.

**Producción:** `https://ia-agent-worker.<tu-subdominio>.workers.dev`

## Arquitectura del producto

| Repo | Rol |
|------|-----|
| **`pantrux/aaas-landing`** | Landing pública + cliente `/demo` (Next.js / Cloudflare Pages) |
| **`pantrux/ia-agent-worker`** *(este repo)* | Agente serverless (LangGraph.js + D1) en Cloudflare Worker |
| **`pantrux/ia-agent-mvp`** | Implementación de referencia en Python (LangGraph + FastAPI), no en prod |

📐 **Documentación canónica:** [`docs/PROJECT-OVERVIEW.md`](docs/PROJECT-OVERVIEW.md)
🗺 **Diagrama SVG en HTML:** [`docs/architecture.html`](docs/architecture.html)

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Cloudflare Worker (V8 isolate, `nodejs_compat`) |
| Agente | LangGraph.js (`@langchain/langgraph`) |
| LLM | GitHub Models API (`@langchain/openai` → `https://models.github.ai/inference`) |
| Persistencia | Cloudflare D1 (SQLite serverless) — CRM + checkpoints |
| HITL | `interrupt()` + `Command({ resume })` de LangGraph.js |
| Auth LLM | Token GitHub (`gh auth token`) reusado como Bearer hacia GitHub Models |

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/ping` | Healthcheck |
| POST | `/api/chat` | Enviar mensaje al agente |
| POST | `/api/chat/resume` | Reanudar tras HITL (aprobar/denegar) |

### POST /api/chat

```json
{ "message": "Show me customer Acme Retail", "thread_id": "optional-uuid" }
```

Respuesta exitosa:
```json
{ "thread_id": "...", "reply": "...", "industry": "retail", "intent": "..." }
```

Respuesta HITL (requiere aprobación):
```json
{ "thread_id": "...", "status": "pending_approval", "interrupt": { "kind": "tool_approval", "tool": "delete_customer_record", "args": {...} } }
```

### POST /api/chat/resume

```json
{ "thread_id": "the-same-uuid", "approved": true }
```

## Setup

```bash
npm install

# Crear base de datos D1
npx wrangler d1 create ia-agent-db
# Copiar el database_id devuelto al wrangler.toml

# Aplicar schema y datos semilla
npx wrangler d1 execute ia-agent-db --local --file=schema.sql
npx wrangler d1 execute ia-agent-db --local --file=seed.sql

# Secreto para LLM
npx wrangler secret put COPILOT_GITHUB_TOKEN
```

## Desarrollo local

```bash
npx wrangler dev
```

Requiere: D1 local (aplicar schema/seed con `--local`).

## Despliegue

```bash
# Schema en producción
npx wrangler d1 execute ia-agent-db --file=schema.sql
npx wrangler d1 execute ia-agent-db --file=seed.sql

# Deploy del Worker
npx wrangler deploy
```

Sin Docker. Sin plan Workers Paid. Sin Containers.

## Integración con la landing

La landing [`pantrux/aaas-landing`](https://github.com/pantrux/aaas-landing) **llama directamente al Worker**: la URL queda hardcodeada en `lib/site.ts`. Se eliminaron las Pages Functions de proxy.

El Worker autoriza orígenes con la variable `ALLOWED_ORIGINS` (puede incluir `*` para abrir cualquier origen o una lista separada por comas).

## Arquitectura interna

```
Navegador
  └─ POST {worker}/api/chat            (CORS directo)
       │
       └─► src/index.ts (HTTP handler · CORS · ruteo)
             │
             └─► src/graph.ts — StateGraph (LangGraph.js)
                   │
                   ├─ router_node         (clasifica industria/intent · zod)
                   ├─ model_node          (ChatOpenAI .bindTools + fallback)
                   ├─ tools_node          (CRM SQL en D1 · HITL via interrupt)
                   └─ validation_node     (regex por industria · retries)
             │
             └─► D1Saver (BaseCheckpointSaver) ───► D1: ia-agent-db
                                                    ├─ customers · orders · leads
                                                    └─ checkpoints · checkpoint_writes
             │
             └─► ChatOpenAI ───► GitHub Models API
                                  https://models.github.ai/inference
                                  modelo: openai/gpt-4o-mini
```

## Variables de entorno

| Variable | Tipo | Descripción | Valor habitual |
|----------|------|-------------|----------------|
| `COPILOT_GITHUB_TOKEN` | Secreto | Token GitHub (PAT o `gh auth token`). Reusado como Bearer hacia GitHub Models. | `gho_…` / `ghu_…` |
| `ALLOWED_ORIGINS` | Var | Orígenes CORS (separados por coma). Usa `*` para abrir todos. | `*,http://localhost:3000` |
| `COPILOT_MODEL` | Var | Modelo LLM. | `openai/gpt-4o-mini` |
| `OPENAI_API_BASE` | Var | Base URL del LLM. | `https://models.github.ai/inference` |

> Si quieres apuntar al endpoint real de GitHub Copilot (`https://api.individual.githubcopilot.com`), `src/copilot-token.ts` intentará intercambiar el GitHub token por un session token Copilot. Si no, usa el GitHub token tal cual.
