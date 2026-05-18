# Hallazgo de seguridad — custom hostname del Worker + WAF en upgrade WebSocket

**Origen:** [PAN-34](https://linear.app/pantrux/issue/PAN-34) (cerrado) · seguimiento **[PAN-41](https://linear.app/pantrux/issue/PAN-41)** (hija — custom hostname + WAF upgrade WS).

**Estado:** Abierto — **no** mitigar con rate limit en código del Worker para el upgrade WS; la corrección es **infraestructura Cloudflare** (custom hostname en zona propia + regla RL).

---

## Problema

El demo y el BFF emiten `ws_url` contra el hostname **`*.workers.dev`** del script (`ia-agent-worker.jandradecatalan.workers.dev`). Ese tráfico **no atraviesa la zona** `e-scale.cl` donde está desplegada la regla **RL HTTP** (auth, chat, `/api/ws/session`).

| Tráfico | Host actual | ¿RL HTTP `e-scale.cl`? |
|---------|-------------|-------------------------|
| BFF `POST /api/ws/session` | `www.e-scale.cl` | Sí |
| Upgrade `GET /agents/web-session-agent/*` | `*.workers.dev` | **No** |

Validación (2026-05-18): ráfagas de upgrade al hostname `workers.dev` → **400** (sin ticket), **sin 429** de WAF; Security Analytics solo muestra bloqueos RL en rutas del landing.

La plantilla A1 §8.2 que cita `http.host eq "ia-agent-worker....workers.dev"` **no es aplicable** en el dashboard del cliente: el subdominio vive bajo la zona de Cloudflare, no bajo `e-scale.cl`.

---

## Corrección recomendada (sin parche en código)

1. **Custom hostname** en zona `e-scale.cl` (ej. `agent.e-scale.cl`) → script Worker `ia-agent-worker`, proxy naranja.
2. **Regla Rate limiting** en esa zona (misma cuenta/plan que el landing), expresión orientada a upgrade WS — ver [A1-checklist-waf.md](./A1-checklist-waf.md) §8.2 (ajustar `http.host` al subdominio elegido).
3. **Producción:** `AGENT_API_URL` en Pages y cualquier cliente deben usar **solo** el custom hostname (HTTPS/WSS).
4. Mantener mitigaciones ya en código: ticket HMAC, RL BFF, RL DO 10 msg/min — **no** duplicar RL de upgrade en `index.ts` como sustituto del edge.

---

## `*.workers.dev` vs custom hostname

| Pregunta | Respuesta |
|----------|-----------|
| ¿Se elimina `workers.dev`? | **No.** Cloudflare asigna siempre una URL `&lt;script&gt;.&lt;cuenta&gt;.workers.dev` por Worker desplegado. |
| ¿Hay que mantenerla? | **Sí, para operación:** smoke CI (`WORKER_SMOKE_URL`), worker **preview** (`ia-agent-worker-preview`), pruebas locales contra remoto, depuración en dashboard. |
| ¿Usarla en producción? | **No** como URL canónica del producto. No ponerla en `AGENT_API_URL` de Pages prod ni en `ws_url` hacia usuarios finales. |
| ¿Riesgo residual? | Quien conozca la URL `workers.dev` podría saltarse WAF de zona si el Worker sigue público ahí. Mitigación: no publicar la URL; opcionalmente limitar rutas en Worker solo al custom hostname (follow-up si hace falta). |

**Preview:** `ia-agent-worker-preview.*.workers.dev` puede seguir sin custom hostname; documentar si el WAF de prod no cubre preview o añadir hostname preview aparte.

---

## Referencias

- [Cloudflare — Custom domains for Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [PAN-19-c3-websocket-design.md](https://github.com/pantrux/aaas-landing/blob/main/docs/PAN-19-c3-websocket-design.md) § Seguridad y rate limits
- [aaas-landing A1 §8](https://github.com/pantrux/aaas-landing/blob/main/docs/A1-checklist-waf.md)
