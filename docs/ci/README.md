# CI/CD — ia-agent-worker

Índice de pipelines y smoke tests del Worker (PAN-35 y anteriores).

| Documento | Audiencia | Cuándo leerlo |
|-----------|-----------|---------------|
| [`recipes/developer-push-flow.md`](./recipes/developer-push-flow.md) | Desarrollador | Primer PR / dudas de checks |
| [`diagrams/pipeline-overview.mmd`](./diagrams/pipeline-overview.mmd) | Todos | Visión de workflows en GitHub Actions |
| [`PAN-35-linear-descripcion-cierre.md`](../PAN-35-linear-descripcion-cierre.md) | Todos | Smoke WS C3 y variables de preview |

## Workflows (`.github/workflows/`)

| Workflow | Obligatorio en PR | Qué valida |
|----------|-------------------|------------|
| `ci.yml` | Sí (recomendado) | `npm test` — protocolo WS, payload Telegram, handlers |
| `worker-smoke.yml` → job `smoke` | Sí (branch protection) | HTTP `/ping` contra `WORKER_SMOKE_URL` |
| `worker-smoke.yml` → job `langsmith` | No | Eval LangSmith si existe `LANGSMITH_API_KEY` |
| `c3-smoke-ws.yml` | No | WS `ready` + `ping`/`pong` si `WORKER_SMOKE_URL` + `WS_TICKET_SECRET` |
