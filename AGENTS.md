# AGENTS.md

## Cursor Cloud specific instructions

### Overview

`ia-agent-worker` is a **Cloudflare Worker** running a LangGraph.js AI agent (CRM assistant). It uses `@langchain/langgraph` + `@langchain/openai` with GitHub Models API (GPT-4o-mini) as the LLM backend, and Cloudflare D1 (SQLite) for CRM data + LangGraph checkpoints.

### Dev commands

| Task | Command |
|------|---------|
| Dev server | `npx wrangler dev --port 8765` (default port for landing page integration) |
| Typecheck | `npx tsc --noEmit` |
| DB migrate (local) | `npm run db:migrate:local` |
| DB seed (local) | `npm run db:seed:local` |

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ping` | Health check |
| POST | `/api/chat` | Send message to agent (`{ "message": "...", "thread_id?": "..." }`) |
| POST | `/api/chat/resume` | Resume HITL flow (`{ "thread_id": "...", "approved": true/false }`) |

### Secrets management

All secrets are managed via **local files** (gitignored), never through GitHub repo secrets:

- **`.dev.vars`** — Wrangler loads these as Worker secrets/vars at dev time. Copy from `.dev.vars.example`.
- **`.env`** — Used by helper scripts (`provision:ai-gateway`, `check:ai-gateway`, Studio). Copy from `.env.example`.

Key secret: **`COPILOT_GITHUB_TOKEN`** in `.dev.vars` — required for LLM calls. Needs a GitHub PAT with `models:read` scope (the default `gh auth token` does NOT have Models API access).

### Important notes
- After `npm install`, always run `npm run db:migrate:local && npm run db:seed:local` to initialize the local D1 SQLite database before starting the worker.
- Wrangler automatically creates the local D1 database under `.wrangler/state/v3/d1/`. This directory is gitignored.
- The worker defaults to port 8787 but the landing page expects port 8765 — always start with `--port 8765`.
- To enable detailed error responses locally, add `EXPOSE_CHAT_ERROR=true` to `.dev.vars`.
- There is no test suite (`vitest`/`jest`) in this repo; validation is done via `tsc --noEmit` and the smoke script `npm run smoke:worker` (requires the worker to be running).
