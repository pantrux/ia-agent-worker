# PAN-35 — Espejo en repo (Linear, cierre)

Espejo de [PAN-35](https://linear.app/pantrux/issue/PAN-35) (hija de [PAN-19](https://linear.app/pantrux/issue/PAN-19)). Smoke **WebSocket directo** al Worker y **CI de tests** en PR.

Spec multicanal completa (BFF + Telegram): [`aaas-landing` — `PAN-35-linear-descripcion-cierre.md`](https://github.com/pantrux/aaas-landing/blob/main/docs/PAN-35-linear-descripcion-cierre.md).

---

## Ámbito

- Workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): `npm test` en push/PR (protocolo WS, payload cola Telegram, tickets, handlers).
- Workflow [`.github/workflows/c3-smoke-ws.yml`](../.github/workflows/c3-smoke-ws.yml): smoke remoto opcional `ready` + `ping`/`pong` contra `WebSessionAgent`.
- Script [`scripts/smoke-c3-ws.mjs`](../scripts/smoke-c3-ws.mjs).

---

## Contexto

El smoke HTTP existente (`worker-smoke.yml` + `/ping`) no cubría el upgrade WebSocket ni la regresión de esquema Telegram en cada PR.

---

## Fuente documental

| Documento | Rol |
|-----------|-----|
| [PAN-35 (Linear)](https://linear.app/pantrux/issue/PAN-35) | Issue |
| [`PAN-19-c3-websocket-design.md`](https://github.com/pantrux/aaas-landing/blob/main/docs/PAN-19-c3-websocket-design.md) | Matriz C3 |
| [`src/ws-protocol.ts`](../src/ws-protocol.ts) | Contrato mensajes v1 |
| [`src/chat-queue-payload.ts`](../src/chat-queue-payload.ts) | Payload Telegram en cola |

---

## Criterio de cierre

- [x] Tests unitarios WS + Telegram en CI de PR.
- [x] Job opcional de smoke WS cuando `WORKER_SMOKE_URL` + `WS_TICKET_SECRET` están configurados.

---

## Hallazgos o Mejoras

- Preferir smoke **end-to-end** vía Pages (`aaas-landing` `smoke:c3`) para validar alineación `WS_TICKET_SECRET` Pages ↔ Worker; `smoke:c3-ws` sirve cuando solo se quiere aislar el DO.
- Si `ci.yml` y Workers Builds duplican tiempo de CI, valorar unificar en el futuro (no bloqueante).

---

## Bloqueantes

**Ninguno.**

```bash
WORKER_SMOKE_URL=https://ia-agent-worker-preview....workers.dev \
WS_TICKET_SECRET=... npm run smoke:c3-ws
```
