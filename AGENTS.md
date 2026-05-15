# AGENTS.md

## Cursor Cloud specific instructions

### Service overview

This is the **ia-agent-worker** repo — a serverless AI agent (LangGraph.js + Cloudflare D1) on Cloudflare Workers.

### Running locally

```bash
npm run dev          # wrangler dev → http://localhost:8787
```

### Local D1 setup (required before first run)

```bash
npm run db:migrate:local   # creates schema (CRM + LangGraph checkpointer tables)
npm run db:seed:local      # inserts sample CRM data (customers, orders)
```

### Environment files

- `.dev.vars` — local Wrangler secrets. Copy from `.dev.vars.example`. Key value: `COPILOT_GITHUB_TOKEN` (GitHub PAT with models:read scope or Copilot token).
- `.env` — used by LangGraph Studio and utility scripts. Copy from `.env.example`.

Without a valid `COPILOT_GITHUB_TOKEN`, the worker starts and accepts requests but LLM calls fail with 400. The rest of the CRM/D1/routing logic still works.

### Key endpoints

- `POST /api/chat` — main conversational endpoint (body: `{ message, threadId?, industry? }`)
- `POST /api/chat/resume` — resume after HITL interrupt (body: `{ threadId, resumeValue }`)

### CI / checks

The repo has no test suite or lint configured. CI workflows (`worker-smoke.yml`, `provision-ai-gateway.yml`) are GitHub Actions that run against deployed environments, not locally.

### Caveats

- The `wrangler.toml` contains a real `account_id` and `database_id`. Local dev (`wrangler dev`) uses a local D1 SQLite emulator and does not touch remote resources.
- `npm run studio` starts a LangGraph Agent Server on port 2024 using in-memory checkpointing (sql.js MemorySaver, not D1). Useful for graph debugging but not for testing D1-backed persistence.
