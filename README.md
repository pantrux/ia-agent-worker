# ia-agent-worker — Serverless IA Agent on Cloudflare Workers

Port completo del agente [ia-agent-mvp](https://github.com/pantrux/ia-agent-mvp) (Python/LangGraph) a **TypeScript** para ejecutarse como **Cloudflare Worker serverless** — sin Docker, sin Containers, plan Free de Workers.

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Cloudflare Worker (V8 isolate) |
| Agente | LangGraph.js (`@langchain/langgraph`) |
| LLM | GitHub Copilot (`@langchain/openai` → `api.individual.githubcopilot.com`) |
| Persistencia | Cloudflare D1 (SQLite serverless) |
| HITL | `interrupt()` + `Command({ resume })` de LangGraph.js |

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

La landing ([aaas-landing](https://github.com/pantrux/aaas-landing)) solo necesita actualizar el secreto `AGENT_API_URL` en Cloudflare Pages al nuevo dominio del Worker:

```
https://ia-agent-worker.<tu-subdomain>.workers.dev
```

Las Pages Functions proxy (`functions/api/chat/*`) siguen funcionando igual.

## Arquitectura

```
Navegador → POST /api/chat (mismo origen via Pages Functions)
         → Worker ia-agent-worker
         → LangGraph.js (StateGraph: router → model → tools → validation)
         → D1 (CRM data + checkpoints)
         → GitHub Copilot API (LLM inference)
```

## Variables de entorno

| Variable | Tipo | Descripción |
|----------|------|-------------|
| `COPILOT_GITHUB_TOKEN` | Secreto | PAT u OAuth token con scope Copilot |
| `ALLOWED_ORIGINS` | Var | Orígenes CORS (separados por coma, `*` = todos) |
| `COPILOT_MODEL` | Var | Modelo LLM (default: `gpt-5.4-mini`) |
| `OPENAI_API_BASE` | Var | Base URL del LLM |
