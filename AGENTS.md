# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Serverless CRM chatbot using **LangGraph.js** deployed as a **Cloudflare Worker**. Exposes `/api/chat`, `/api/chat/resume` (HITL), and `/ping`. Uses D1 for CRM data + LangGraph checkpoints.

### Running locally

- `npm run dev -- --port 8765` — starts wrangler dev on port 8765 (use a non-default port if the sibling `aaas-auth-worker` is also running on 8787, to avoid inspector port conflicts; add `--inspector-port 9231` if needed).
- Requires `.dev.vars` with at least `COPILOT_GITHUB_TOKEN` set to a valid GitHub PAT with Models access. Without it, `/api/chat` will fail at LLM invocation.
- Local D1 database must be initialized before first run: `npm run db:migrate:local && npm run db:seed:local`.

### Checks

- No lint or test scripts are defined in this repo's `package.json`. TypeScript checking can be done with `npx tsc --noEmit` but the project has no `tsconfig.json` — types come from wrangler's built-in TS support.
- Smoke test: `curl http://localhost:8765/ping` should return `{"status":"ok","service":"ia-agent-worker"}`.

### Environment variables

- `COPILOT_GITHUB_TOKEN` — **required** for LLM calls (GitHub PAT with Models scope).
- `BFF_API_TOKEN` — optional; if set, `/api/chat` and `/api/chat/resume` require `Authorization: Bearer <token>`.
- `EXPOSE_CHAT_ERROR=true` — useful in local dev to surface stack traces in 500 responses.
- See `.dev.vars.example` and `.env.example` for full list.

### Gotchas

- `wrangler.toml` contains a real `account_id` and `database_id` — these are for remote deployment. Local dev uses `--local` flag which creates a SQLite file under `.wrangler/state/`.
- The `npm run studio` command launches LangGraph Studio (port 2024) using in-memory SQLite instead of D1 — useful for debugging the agent graph without Cloudflare bindings.
