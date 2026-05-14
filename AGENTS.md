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

### Important notes

- **`COPILOT_GITHUB_TOKEN`** must be set in `.dev.vars` for the LLM to work. The default `gh auth token` does NOT have GitHub Models API access — a PAT with `models:read` scope or a Copilot-enabled token is required.
- After `npm install`, always run `npm run db:migrate:local && npm run db:seed:local` to initialize the local D1 SQLite database before starting the worker.
- Wrangler automatically creates the local D1 database under `.wrangler/state/v3/d1/`. This directory is gitignored.
- The worker defaults to port 8787 but the landing page expects port 8765 — always start with `--port 8765`.
- To enable detailed error responses locally, add `EXPOSE_CHAT_ERROR=true` to `.dev.vars`.
- There is no test suite (`vitest`/`jest`) in this repo; validation is done via `tsc --noEmit` and the smoke script `npm run smoke:worker` (requires the worker to be running).
