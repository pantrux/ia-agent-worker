# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Serverless AI Agent built with LangGraph.js on Cloudflare Workers + D1. CRM assistant with industry routing and human-in-the-loop approval. Uses GitHub Models API (GPT-4o-mini) via `@langchain/openai`.

### Running the service

| Command | Description | Port |
|---|---|---|
| `npm run dev` | Start wrangler dev server | 8787 |
| `npm run studio` | LangGraph Studio (optional, debugging) | 2024 |

### Local D1 database setup

Before running, apply schema and seed data:
```
npm run db:migrate:local
npm run db:seed:local
```

### Secrets / `.dev.vars`

Create `.dev.vars` from `.dev.vars.example`. The key required secret is `COPILOT_GITHUB_TOKEN` (GitHub PAT or `gh auth token` output for LLM inference). Without a valid token, `/api/chat` calls will fail at LLM invocation, but the worker itself starts and `/ping` works.

### Gotchas

- **`/ping` always works** without any secrets — use it to verify the worker is running.
- **Chat requires a valid `COPILOT_GITHUB_TOKEN`**: The worker starts fine with a placeholder, but actual chat requests to `/api/chat` need a real GitHub token for LLM calls.
- **D1 is local**: Wrangler stores local D1 in `.wrangler/state/v3/d1/`. Re-run `db:migrate:local` and `db:seed:local` if you need to reset.
- **`EXPOSE_CHAT_ERROR=true`** in `.dev.vars` enables detailed error responses on `/api/chat` 500s — useful for debugging.

### Typecheck

`npx tsc --noEmit` (no dedicated npm script, but works from repo root).
