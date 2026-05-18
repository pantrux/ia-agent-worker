# Checklist A1 — WAF y rate limiting (Cloudflare)

Este entregable se cumple **principalmente en el dashboard de la zona** (o vía Terraform/API). El Worker ya documenta rutas en [ROADMAP-CF-LANGSMITH.md §2.0](./ROADMAP-CF-LANGSMITH.md).

## 1. Inventario y prioridad

- [ ] Confirmar que el subdominio del Worker pasa por **proxy naranja** (DNS en Cloudflare).
- [ ] Revisar **reglas WAF** existentes (Managed Rules OWASP / Cloudflare recommendations) y activar baseline si no está.

## 2. Rate limiting por ruta

- [ ] Crear regla de **rate limit** para `POST /api/chat` (y misma política para `POST /api/chat/resume`) usando la ruta del Worker público.
- [ ] Definir umbral por IP de origen (`CF-Connecting-IP`) acorde al producto (p. ej. ventana + máximo de peticiones por minuto).
- [ ] Excluir o relajar **OPTIONS** para CORS si el WAF lo permite sin abrir abuso masivo.

## 3. Protección adicional

- [ ] Valorar **Bot Fight Mode** / Super Bot Fight según tráfico esperado.
- [ ] Limitar tamaño de body en capa CF si aplica (complemento a límites del Worker).

## 4. Verificación

- [ ] Probar desde IP limpia: chat OK bajo el límite.
- [ ] Forzar superación del límite (script o herramienta) y comprobar **429** o bloqueo WAF documentado.
- [ ] Registrar en el tablero [ROADMAP-IMPLEMENTATION.md](./ROADMAP-IMPLEMENTATION.md) la fila **A1** como **Ejecutado** con enlace a export Terraform o nota de reglas aplicadas.

## 5. Posteriores (fuera de A1 estricto)

- [ ] Endurecer `ALLOWED_ORIGINS` en producción (sin `*`) — alineado con el roadmap §2.0.

## 8. WebSocket C3 ([PAN-34](https://linear.app/pantrux/issue/PAN-34))

Complementa el rate limit **por sesión DO** en código (`src/ws-message-rate-limit.ts`, **10** mensajes `chat`/`resume` por minuto). El upgrade WS y el BFF de tickets requieren reglas en **zona** del hostname del Worker y/o del landing.

### 8.1 Rutas

| Capa | Método / tráfico | Ruta | Límite en código | WAF zona (dashboard) |
|------|------------------|------|------------------|----------------------|
| Pages BFF | `POST` | `/api/ws/session` | **30**/min por IP (`aaas-landing` → `ws-session-rate-limit.ts`) | Ampliar **RL HTTP** en `e-scale.cl` (§7.1 en repo landing) |
| Worker | `GET` upgrade WS | `/agents/web-session-agent/*` | Ticket HMAC en `onConnect` | Regla RL por IP en zona del **Worker** (§8.2) |
| DO | frames `chat` / `resume` | sesión WS | **10**/min por `session_id` | — |

`ping` no cuenta contra el límite DO.

### 8.2 Plantilla RL — upgrade WebSocket (zona del Worker)

Aplicar en la zona que sirve el hostname público del Worker (`*.workers.dev` del script o custom hostname). Ajusta el host si difiere:

```text
(http.host eq "ia-agent-worker.<tu-cuenta>.workers.dev")
and http.request.method eq "GET"
and starts_with(http.request.uri.path, "/agents/web-session-agent/")
and any(http.request.headers["upgrade"][*] eq "websocket")
```

**Umbrales sugeridos (orientación):** periodo **60 s**, conteo **IP**, umbral **60** upgrades/min (≥ sesiones BFF 30/min + margen reconexión). Acción **Block** o **Managed Challenge** según plan.

Si el plan Free no permite segunda regla RL en la zona del Worker, priorizar el límite DO + BFF Pages y documentar riesgo residual en el PR.

### 8.3 Verificación

- [ ] BFF: `POST /api/ws/session` → **429** tras 30 peticiones/min desde la misma IP (tests Vitest en landing).
- [ ] DO: enviar **11** mensajes `chat` en &lt;60 s en la misma sesión → `{"type":"error","code":"rate_limited"}` sin invocar grafo.
- [ ] WAF Worker: forzar superación del umbral de upgrade y comprobar bloqueo en edge (opcional si regla desplegada).
