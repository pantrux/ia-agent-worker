# Cómo fluye mi commit hasta los checks del Worker

## Resumen en 30 segundos

En cada PR se ejecutan tests unitarios (`ci.yml`) y smoke HTTP remoto (`worker-smoke.yml`). El smoke WebSocket C3 es **opcional** y solo corre si configuraste secretos de preview.

## Quality gates (orden típico)

1. **CI** — `npm test` (protocolo WS, cola Telegram, tickets).
2. **Worker smoke** — `GET /ping` (y opcionalmente chat si `SMOKE_INCLUDE_CHAT`).
3. **C3 smoke WS** (opcional) — upgrade WebSocket con ticket HMAC.
4. **Workers Builds** — build/deploy Cloudflare (integración Git).

## Variables GitHub

| Nombre | Tipo | Workflow | Notas |
|--------|------|----------|-------|
| `WORKER_SMOKE_URL` | Variable | `worker-smoke`, `c3-smoke-ws` | Base sin barra final |
| `WS_TICKET_SECRET` | Secreto | `c3-smoke-ws` | Mismo valor que Worker/Pages |
| `LANGSMITH_API_KEY` | Secreto | `langsmith` job | Opcional |

## Smoke local

```bash
# HTTP (mismo que CI obligatorio)
WORKER_SMOKE_URL=https://ia-agent-worker.<cuenta>.workers.dev npm run smoke:worker

# WebSocket directo (Node >= 22)
WORKER_SMOKE_URL=... WS_TICKET_SECRET=... npm run smoke:c3-ws
```

## Si algo falla

- Sin `WORKER_SMOKE_URL` en `worker-smoke` → configurar variable en Settings → Actions.
- `c3-smoke-ws` omitido → esperado sin secretos; no usar ese job como required check.
- Ver diagrama: [`../diagrams/pipeline-overview.mmd`](../diagrams/pipeline-overview.mmd).
