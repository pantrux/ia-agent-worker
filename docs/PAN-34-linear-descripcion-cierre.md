# Cierre — PAN-34 (rate limit WebSocket C3)

**Issue:** [PAN-34](https://linear.app/pantrux/issue/PAN-34) · padre [PAN-19](https://linear.app/pantrux/issue/PAN-19)

## Ámbito

Seguridad C3: rate limiting en upgrade WS (edge) y en mensajes por sesión DO.

## Contexto

Tras PoC WS (PAN-19), faltaba endurecer abuso: emisión masiva de tickets BFF, upgrades WS y mensajes `chat`/`resume` contra el grafo.

## Fuente documental

- [`PAN-19-c3-websocket-design.md`](https://github.com/pantrux/aaas-landing/blob/main/docs/PAN-19-c3-websocket-design.md)
- [`A1-checklist-waf.md`](./A1-checklist-waf.md) §8 (este repo)
- [`aaas-landing/docs/A1-checklist-waf.md`](https://github.com/pantrux/aaas-landing/blob/main/docs/A1-checklist-waf.md) §8 (BFF + RL HTTP unificado)

## Criterio de cierre

- [x] Contador mensajes/min en `WebSessionAgent` — `src/ws-message-rate-limit.ts` (**10**/min `chat`+`resume`; `ping` excluido)
- [x] Plantilla RL por IP en ruta WS (dashboard CF) — [A1-checklist-waf.md](./A1-checklist-waf.md) §8.2
- [x] Tests Vitest (`ws-message-rate-limit.test.ts`, `web-session-ws-handler.test.ts`)

**Operación pendiente (dashboard):** desplegar regla §8.2 en la zona del hostname del Worker si aún no existe; ampliar **RL HTTP** en `e-scale.cl` con `POST /api/ws/session` (checklist landing §8).

## Hallazgos o Mejoras

- El límite DO es **por sesión** (estado SQLite del DO), no global por IP: el edge debe cubrir upgrades y BFF.
- **Seguridad (follow-up):** upgrade WS en `*.workers.dev` queda **fuera** de WAF zona `e-scale.cl` (mismo Worker prod = puerta trasera). **[PAN-41](https://linear.app/pantrux/issue/PAN-41):** custom hostname + RL CF + **allowlist `Host` en prod** (403 a `workers.dev`). Doc [`PAN-34-hallazgo-custom-hostname-worker-waf.md`](./PAN-34-hallazgo-custom-hostname-worker-waf.md). **No** RL de upgrade en código; **sí** bloqueo de host en prod.
- `routeAgentRequest({ cors: true })` no sustituye `ALLOWED_ORIGINS`; auth WS sigue por ticket. Endurecer `Origin` en `onConnect` queda como mejora opcional (mencionado en reviews PR C3).

## Bloqueantes

Ninguno para merge de código; despliegue WAF Worker es operación de zona (puede hacerse tras merge del PR).
