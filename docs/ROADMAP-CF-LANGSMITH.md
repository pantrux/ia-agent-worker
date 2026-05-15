# Roadmap: Cloudflare (WAF / edge) + LangSmith (LLMOps SaaS)

Este documento baja a **decisiones**, **criterios** y **entregables** la arquitectura acordada:

- **Cloudflare**: frontera de tráfico de usuarios (WAF, CDN, Access, rate limits, secretos, colas, datos edge).
- **LangSmith**: SaaS de LLMOps (trazas, proyectos, datasets, evaluaciones, opcionalmente despliegue LangGraph gestionado).

Contexto del repo: [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md).  
Trazas Worker ↔ LangSmith: [langsmith-integration-plan.md](./langsmith-integration-plan.md).

**Seguimiento de implementación (PR y estados):** [ROADMAP-IMPLEMENTATION.md](./ROADMAP-IMPLEMENTATION.md) — tablero de auditoría por fase; actualizarlo en cada PR o cierre de hito. Este archivo (`ROADMAP-CF-LANGSMITH.md`) se mantiene como **visión y criterios**; el detalle de avance vive en el tablero.

**Estrategia LLMOps (datasets y evals):** la **fuente de verdad operativa** para datasets de calidad y experimentos es **LangSmith** (runs, comparativas, umbrales en la UI). El repo mantiene un **snapshot versionado** en `evals/dataset-v0.json` y scripts `npm run langsmith:*` para sincronizar y evaluar; la CI puede actuar como puerta si está configurado `LANGSMITH_API_KEY`. Detalle: [B3-langsmith-llmops.md](./B3-langsmith-llmops.md).

---

## 1. Registro de decisiones (ADR resumido)

| ID | Decisión | Opciones | Estado | Criterio de cierre |
|----|-----------|----------|--------|---------------------|
| **ADR-01** | Frontera única de usuarios | CF vs otro CDN | **Aceptado: CF** | DNS + proxy naranja; reglas WAF versionadas (Terraform o dashboard con export). |
| **ADR-02** | LLMOps | LangSmith vs solo logs CF | **Aceptado: LangSmith** | Proyecto dedicado; API keys por entorno; política de retención alineada con privacidad. |
| **ADR-03** | Runtime del grafo en prod | Worker isolate vs CF Containers vs LangGraph Cloud | **MVP: Worker** (revisable al exigir CPU largo o Agent Server en prod) | Ver §2.1 matriz y bloque §5. |
| **ADR-04** | Studio en producción | No / dev local / LangGraph Cloud / DIY Agent Server en CF | **MVP: No** (`langgraph dev` + LangSmith traces; Studio prod solo si se elige Fase F) | Sin URL público Agent Server en este sprint. |
| **ADR-05** | Observabilidad LLM en edge | AI Gateway obligatorio u opcional | **MVP: Sí (PoC Fase B)** | Gateway de staging; obligatorio en prod tras validar coste/latencia. |

### 2.1 Matriz ADR-03 / ADR-04 (elegir una fila “objetivo”)

| Objetivo de producto | Runtime recomendado | Studio prod | Notas |
|----------------------|----------------------|-------------|--------|
| Mínima complejidad, edge puro | **Worker** + LangGraph.js (hoy) | No (solo LangSmith traces + `langgraph dev` en dev) | Menor coste ops; límites de CPU/tiempo por request. |
| LangGraph “tipo servidor” sin salir de CF | **CF Containers** + Worker como ingress | Posible si implementas API compatible Agent Server | Más ops (imagen Docker, DO por contenedor, egress). |
| Studio + SDK gestionados sin DIY | **LangGraph Cloud** (LangSmith) | Sí (documentado) | Compute en **AWS/GCP** bajo LangSmith — híbrido de facturación; CF sigue siendo WAF delante. |

**TARGET MVP (2026-05-13):** fila 1 — **Worker** + LangGraph.js, **Studio solo en dev**, **LangSmith** como única observabilidad LLM en prod, **AI Gateway** en PoC (Fase B) con intención de generalizar.

**Trade-offs aceptados (MVP):** límites de CPU/tiempo por request del isolate; sin Studio remoto para usuarios finales; si más adelante se requiere Agent Server gestionado, valorar **Fase F** (LangGraph Cloud) o **Fase E** (Containers) sin reescribir el grafo.

---

## 2.0 Inventario de rutas públicas (WAF / rate limit)

Aplicar en **reglas de zona** (recomendado) o complementar con lógica en Worker (KV/DO). Origen del cliente: `CF-Connecting-IP`.

| Método | Ruta | Uso | Notas WAF |
|--------|------|-----|-----------|
| `GET` | `/ping` | Health | Baja sensibilidad; limitar si abuso de escaneo. |
| `POST` | `/api/chat` | Chat + posible HITL `pending_approval` | **Alta prioridad** rate limit + tamaño de body. |
| `POST` | `/api/chat/resume` | HITL resume | **Alta prioridad** misma política que chat. |
| `OPTIONS` | `*` | CORS preflight | Permitir sin contar contra límite estricto de chat si el WAF lo distingue. |

CORS hoy: `ALLOWED_ORIGINS` en Worker — endurecer en prod (sin `*`).

### Nota de implementación — AI Gateway + custom provider (2026-05-13)

La visión de **ADR-05** (gateway delante del LLM, observabilidad y políticas en CF) **no cambia**. Lo que se refinó en implementación fue el **contrato con el SDK OpenAI** cuando el upstream es un **custom provider** (p. ej. GitHub Models): la ruta recomendada quedó en **`…/compat`** con el modelo en forma **`custom-{slug}/{modelo}`**, en lugar de anclar el cliente solo en la URL **provider-specific** `…/custom-{slug}` (eso generaba resoluciones upstream inválidas con LangSmith). Detalle: merge [PR #9](https://github.com/pantrux/ia-agent-worker/pull/9) en `ia-agent-worker`.

---

## 2. Fases del roadmap (entregables y salidas)

### Fase A — Baseline de gobernanza (1–2 semanas)

**Objetivo:** tráfico de usuarios bajo políticas explícitas y secretos ordenados.

| Entregable | Cloudflare | LangSmith |
|------------|------------|-----------|
| A1 | Reglas WAF (OWASP baseline, rate limit por ruta `/api/chat`), Bot Fight si aplica | — |
| A2 | **Access** o JWT en Worker BFF (si aún no hay auth fuerte) | — |
| A3 | Secretos: `LANGSMITH_API_KEY`, tokens LLM, sin duplicar en `[vars]` sensibles | Proyecto `ia-agent-worker-prod` / `preview` separados |
| A4 | Logs estructurados + retención | Tags/metadata ya alineados con `thread_id` / canal |

**Criterio de salida:** checklist de pentest ligero + run de prueba visible en LangSmith con tags `environment:preview`.

### Fase B — LLMOps v1 (2–3 semanas)

**Objetivo:** trazas útiles + primera línea de calidad.

| Entregable | Cloudflare | LangSmith |
|------------|------------|-----------|
| B1 | Opcional: **AI Gateway** delante de llamadas al modelo ([Workers AI + Gateway](https://developers.cloudflare.com/ai-gateway/usage/providers/workersai/)) | Correlación de runs con `gateway` request id si se usa |
| B2 | Métricas Worker (errores, latencia p95) en dashboard | Dashboards por `LANGSMITH_PROJECT` |
| B2b | **Pipeline de export o agregación** (p. ej. **Logpush**) sobre logs `ia_agent_access` para **p95 / histórico** sin depender solo de la UI de Observability; seguimiento [PAN-9](https://linear.app/pantrux/issue/PAN-9/b2b-export-o-agregacion-automatica-de-metricas-worker-p95-historico) | Opcional: correlación manual con runs (misma ventana temporal) si el export incluye `thread_id` / `CF-Ray` |
| B3 | Target HTTP del Worker (`WORKER_SMOKE_URL`, token BFF si aplica) usado como **función objetivo** del experimento LangSmith | **Dataset y evaluación en LangSmith** (fuente de verdad); JSON en repo solo como snapshot versionado; experimentos, runs y métricas en la UI LangSmith |

**Criterio de salida:** dataset v0 operativo en LangSmith + experimento reproducible; **opcionalmente** pipeline CI que, si hay `LANGSMITH_API_KEY`, sincronice el snapshot y falle si la media de `eval_pass` cae bajo el umbral acordado (ver `docs/B3-langsmith-llmops.md`).

### Fase C — Multicanal / desac acoplamiento (3–6 semanas, paralelizable)

**Objetivo:** nuevos canales sin tocar el núcleo del grafo en cada PR.

| Entregable | Cloudflare | LangSmith |
|------------|------------|-----------|
| C1 | **Queues** + consumer: normalizar payload `{ channel, user_id, text, thread_hint }` | Metadata `channel` en todas las trazas |
| C2 | Worker BFF por canal (webhooks Slack/Teams/etc.) o un solo endpoint con verificación de firma | — |
| C3 | **Durable Objects** o **Agents SDK** si necesitas WebSocket / estado de sala ([Agents](https://developers.cloudflare.com/agents/)) | Trazas por `session_id` DO |

**Criterio de salida:** 2 canales de prueba (ej. Web + Slack test) con el mismo backend de agente.

### Fase D — MCP y A2A (continuo, tras C1)

**Objetivo:** herramientas y delegación sin romper WAF.

| Entregable | Cloudflare | LangSmith |
|------------|------------|-----------|
| D1 | Allowlist de hosts MCP salientes; timeouts; circuit breaker | Spans por tool con nombre MCP |
| D2 | A2A: HTTP interno entre Workers (service bindings) o cola con contrato versionado | Jerarquía de runs padre/hijo si aplica |

**Criterio de salida:** documento de amenazas (SSRF, exfiltración) firmado + prueba de carga MCP acotada.

### Fase E — PoC Containers (opcional, 2–4 semanas)

**Solo si ADR-03 elige Containers.**

| Entregable | Cloudflare | LangSmith |
|------------|------------|-----------|
| E1 | Imagen Docker mínima + routing Worker ([Containers get started](https://developers.cloudflare.com/containers/get-started/)) | Mismas variables `LANGSMITH_*` |
| E2 | Presupuesto egress ([pricing](https://developers.cloudflare.com/containers/pricing/)) | Comparativa coste vs Worker-only |

**Criterio de salida:** decisión Go/No-Go para mover parte del grafo o solo “tool runners” pesados.

### Fase F — LangGraph Cloud (opcional)

**Solo si ADR-04 exige Studio/SDK gestionado en prod.**

Seguir [Deploy your app to cloud](https://docs.langchain.com/langsmith/deployment-quickstart). El Worker CF puede quedar como **BFF** hacia la URL del deployment.

---

## 3. Backlog inmediato (próximas 2 semanas)

Los entregables siguientes se reflejan también en el tablero [ROADMAP-IMPLEMENTATION.md](./ROADMAP-IMPLEMENTATION.md) (columna **Estado** y **PR**).

Orden sugerido; asignar dueño en tu tablero.

1. ~~**Cerrar ADR-03/04**~~ Hecho por defecto MVP en §5 (reabrir solo si cambian requisitos).
2. **Inventario WAF**: rutas Worker en §2.0; añadir dominio del front cuando exista; aplicar rate limit en zona a `/api/chat` y `/api/chat/resume`.
3. **Proyectos LangSmith**: crear `…-prod` y `…-preview`; rotación de API keys documentada.
4. **AI Gateway PoC** (si ADR-05 → sí): un gateway de staging; el Worker usa **`/compat`** y, con **custom provider** (p. ej. GitHub Models), el modelo **`custom-{slug}/{openai/…}`** — validar en dashboard de CF y trazas LangSmith (sin `MODEL_NOT_FOUND`).
5. **Dataset LangSmith v0**: mantener `evals/dataset-v0.json` en repo y sincronizar a LangSmith (`npm run langsmith:dataset:sync`); métrica `eval_pass` documentada en `docs/B3-langsmith-llmops.md`.
6. **CI smoke + eval opcional**: workflow [`.github/workflows/worker-smoke.yml`](../.github/workflows/worker-smoke.yml) + variable `WORKER_SMOKE_URL`; opcional `SMOKE_INCLUDE_CHAT` (ver README). Si existe el secreto `LANGSMITH_API_KEY`, mismo workflow sincroniza el dataset y ejecuta `npm run langsmith:eval`.

---

## 4. Riesgos y dependencias

| Riesgo | Mitigación |
|--------|------------|
| Datos sensibles en trazas | Proyectos separados, muestreo, políticas de equipo en LangSmith |
| Límites Worker (CPU) con MCP largos | Timeouts agresivos; mover herramienta pesada a Fase E |
| Vendor híbrido (CF + LangSmith) | Contratos claros en ADR; runbooks de incidente por lado |

---

## 5. Decisión registrada (MVP)

```text
TARGET_RUNTIME: Worker
STUDIO_PROD: No
AI_GATEWAY: Yes (PoC Fase B → prod tras validación)
FECHA_DECISION: 2026-05-13
NOTAS: LangGraph Cloud / CF Containers quedan como opciones documentadas (§2.1, Fases E–F), no en el camino crítico actual.
```

Con esta decisión, prioriza **Fase A → B** sin reabrir arquitectura salvo cambio de requisitos.

## 6. Checklist Fase A (esta semana)

Para **estado y PR** asociados a cada ítem, usa [ROADMAP-IMPLEMENTATION.md](./ROADMAP-IMPLEMENTATION.md) (filas A1–A4 y T0).

- [ ] Reglas WAF en zona: rate limit `POST /api/chat` y `POST /api/chat/resume` (umbrales por IP).
- [ ] Proyectos LangSmith: `ia-agent-worker-prod` vs `ia-agent-worker-preview` + `LANGSMITH_PROJECT` por entorno en Wrangler (`[env.*]` o vars de preview).
- [ ] `ALLOWED_ORIGINS` sin `*` en el entorno de producción.
- [ ] Variable opcional `DEPLOYMENT_ENV` en el Worker para filtrar runs (metadata `deployment`). *Implementado en código; falta definirla en Wrangler por entorno.*
