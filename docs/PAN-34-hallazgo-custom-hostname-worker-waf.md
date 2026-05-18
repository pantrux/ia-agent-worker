# Hallazgo de seguridad — custom hostname del Worker + WAF en upgrade WebSocket

**Origen:** [PAN-34](https://linear.app/pantrux/issue/PAN-34) (cerrado) · seguimiento **[PAN-41](https://linear.app/pantrux/issue/PAN-41)** (hija — custom hostname + WAF + cierre puerta `workers.dev`).

**Estado:** Abierto.

---

## Problema

El demo y el BFF emiten `ws_url` contra el hostname **`*.workers.dev`** del script (`ia-agent-worker.jandradecatalan.workers.dev`). Ese tráfico **no atraviesa la zona** `e-scale.cl` donde está la regla **RL HTTP** (auth, chat, `/api/ws/session`).

| Tráfico | Host actual | ¿RL HTTP `e-scale.cl`? |
|---------|-------------|-------------------------|
| BFF `POST /api/ws/session` | `www.e-scale.cl` | Sí |
| Upgrade `GET /agents/web-session-agent/*` | `*.workers.dev` | **No** |

Validación (2026-05-18): ráfagas de upgrade al hostname `workers.dev` → **400** (sin ticket), **sin 429** de WAF; el tráfico **sí llega al Worker de producción** (mismo script que serviría el custom hostname).

La plantilla A1 §8.2 sobre `http.host eq "ia-agent-worker....workers.dev"` **no es aplicable** en el dashboard del cliente: el subdominio vive bajo la zona de Cloudflare, no bajo `e-scale.cl`.

---

## Riesgo: puerta trasera `workers.dev`

Cloudflare **no elimina** la URL `ia-agent-worker.<cuenta>.workers.dev` al añadir un custom hostname. Es el **mismo despliegue** de producción.

| Escenario | Riesgo |
|-----------|--------|
| URL `workers.dev` de prod conocida o filtrada | Se **salta el WAF** de zona; posible **DoS** (ráfagas de upgrade/HTTP sin RL edge) |
| Ticket WS válido | Solo vía BFF en `e-scale.cl` (WAF + RL); el atacante aún podría usar el ticket contra `workers.dev` si obtuvo uno legítimamente |
| `POST /api/chat` en `workers.dev` | Mitigado si `BFF_API_TOKEN` está activo (401 sin Bearer) |

**No basta** “no publicar” la URL: hace falta **defensa en profundidad**.

---

## Corrección (PAN-41) — tres capas obligatorias

### 1. Edge (zona `e-scale.cl`)

1. **Custom hostname** (p. ej. `agent.e-scale.cl`) → script `ia-agent-worker`, proxy naranja.
2. **Regla Rate limiting** en CF para upgrade WS — [A1-checklist-waf.md](./A1-checklist-waf.md) §8.2.
3. **`AGENT_API_URL`** y `ws_url` de producción **solo** con ese hostname (Pages + secretos).

### 2. Worker producción — allowlist de `Host` (obligatorio)

En el script **`ia-agent-worker`** (prod), al inicio del `fetch`:

- Aceptar solo hostnames de producción acordados (p. ej. `agent.e-scale.cl`).
- Si `Host` termina en `.workers.dev` (o no está en la lista) → **403** sin ejecutar grafo ni upgrade.

**No es** un “parche de rate limit” del upgrade: es **cerrar la puerta trasera** que el WAF de zona no puede cubrir.

Implementación sugerida: variable `ALLOWED_WORKER_HOSTS` (lista separada por comas) en `[vars]` de `wrangler.toml` prod; el worker **preview** (`ia-agent-worker-preview`) **no** aplica este bloqueo (sigue en `*.workers.dev` para CI/smoke).

### 3. Lo que ya existe (mantener)

- Ticket HMAC WS, RL BFF 30/min, RL DO 10 msg/min, `BFF_API_TOKEN` en HTTP.
- **No** añadir RL de upgrade en código como sustituto del edge.

---

## `*.workers.dev` — un Worker, dos URLs

| Pregunta | Respuesta |
|----------|-----------|
| ¿Segundo Worker en paralelo? | **No.** Mismo script prod; custom hostname + URL automática `workers.dev`. |
| ¿Eliminar `workers.dev`? | **No** (Cloudflare siempre la asigna). |
| ¿Uso en prod | **No** en secretos ni clientes; **sí** bloquear `Host` en el script prod (§2 arriba). |
| ¿CI / smoke | **`ia-agent-worker-preview`** en `WORKER_SMOKE_URL`, o smoke contra custom hostname prod. |
| ¿Preview | `ia-agent-worker-preview.*.workers.dev` sin allowlist estricta; WAF prod no aplica (riesgo aceptado o hostname preview aparte). |

---

## Verificación de cierre (PAN-41)

- [ ] `curl -H "Host: ia-agent-worker....workers.dev" https://<custom-host>/ping` o request directo a URL `workers.dev` de prod → **403** (prod).
- [ ] Upgrade WS por custom hostname → **429** HTML CF al superar RL.
- [ ] Smoke CI sigue en verde (preview o custom hostname documentado).
- [ ] `AGENT_API_URL` prod sin `workers.dev`.

---

## Referencias

- [Cloudflare — Custom domains for Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [PAN-19-c3-websocket-design.md](https://github.com/pantrux/aaas-landing/blob/main/docs/PAN-19-c3-websocket-design.md) § Seguridad y rate limits
- [aaas-landing A1 §8](https://github.com/pantrux/aaas-landing/blob/main/docs/A1-checklist-waf.md)
