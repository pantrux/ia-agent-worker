# ADR C3 — WebSocket híbrido (Agents SDK + LangGraph)

**Estado:** Aceptado (PAN-19, 2026-05-17)  
**Contexto:** [PAN-19](https://linear.app/pantrux/issue/PAN-19), [PAN-19-c3-websocket-design.md](https://github.com/pantrux/aaas-landing/blob/main/docs/PAN-19-c3-websocket-design.md)

## Decisión

Usar **Cloudflare Agents SDK** (`Agent` / `WebSessionAgent` DO) como capa de **sesión WebSocket** y mantener **LangGraph.js + D1** como motor de razonamiento, checkpoints e HITL.

## Alternativas consideradas

| Opción | Pros | Contras | Veredicto |
|--------|------|---------|-----------|
| Migración total a `AIChatAgent` | Un solo stack CF | Reescribir grafo, HITL, CRM tools, LangSmith | Rechazada |
| DO manual sin SDK | Control total | Boilerplate WS/hibernación/routing | Rechazada |
| **Híbrido Agents SDK + LangGraph** | Reutiliza C1/C2/B3 | Dos capas de estado | **Elegida** |
| Solo HTTP (status quo) | Simple | Sin tiempo real en demo | Insuficiente para PAN-19 |

## Identidades

| ID | Ámbito | Generación |
|----|--------|------------|
| `session_id` | Instancia DO / pestaña WS | BFF `POST /api/ws/session` |
| `thread_id` | Checkpoints LangGraph / D1 | Primer mensaje en sesión (UUID v4) |
| `user_id` | Metadata / logs | `X-AAAS-User-Id` vía ticket (o `anonymous`) |

v1: **1 sesión → 1 thread** (persistido en estado DO).

## Partición de estado

- **D1:** CRM + checkpoints LangGraph (fuente de verdad del hilo).
- **DO:** `threadId`, `userId`, conexiones WS (efímero + reconnect).
- **KV:** solo Telegram (`CHAT_THREAD_KV`); web no usa KV en v1.

## Auth WebSocket

- Pages valida `aaas_session` → emite ticket HMAC (`WS_TICKET_SECRET` compartido).
- Cliente conecta a Worker: `/agents/web-session-agent/{session_id}?ticket=...`
- `onConnect` valida ticket; rechazo `4001` si inválido/expirado.
- TTL ticket: **60 segundos**.

## Ejecución del grafo

- v1: `onMessage` invoca grafo **inline** (como `POST /api/chat`).
- v2: encolar en `CHAT_INGEST_QUEUE` si timeouts en producción.

## LangSmith

Metadata obligatoria en invoke desde DO:

- `session_id`, `thread_id`, `channel` (`web`), `user_id`, `operation` (`ws_chat` | `ws_resume`)

## Costes estimados (orientación)

Supuestos: 100 sesiones concurrentes, 10 mensajes/min, mensajes cortos.

| Recurso | Impacto |
|---------|---------|
| DO `WebSessionAgent` | Duración instancia + requests WS; hibernación SDK reduce idle |
| D1 | Sin duplicar checkpoints (sin coste extra vs HTTP) |
| Worker HTTP legacy | Sin cambio de tráfico si demo migra a WS gradualmente |

**Orden de magnitud:** marginal frente a coste LLM (Copilot/Gateway). Monitorizar instancias DO activas en dashboard CF tras despliegue preview.

## Consecuencias

- `wrangler.toml` requiere migración DO `new_sqlite_classes`.
- Export de `WebSessionAgent` en entry Worker.
- Dependencia `agents` con `--legacy-peer-deps` (peer `zod@4` vs LangChain `zod@3`).

## Referencias

- [Cloudflare Agents](https://developers.cloudflare.com/agents/)
- [`building-ai-agent-on-cloudflare` skill](https://developers.cloudflare.com/agents/getting-started/)
