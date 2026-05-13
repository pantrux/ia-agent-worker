# Seguimiento de implementación del roadmap (PR y estado)

Este documento es el **tablero de auditoría**: cada fila enlaza un entregable del [roadmap estratégico](./ROADMAP-CF-LANGSMITH.md) con **PR(s)** y **estado**. El roadmap principal conserva visión, ADR y fases; aquí se actualiza el avance **cada vez que abras/cierres un PR o completes trabajo fuera de PR** (p. ej. solo dashboard Cloudflare).

## Cómo usarlo

1. **Al planificar un entregable:** crea o enlaza el PR y pon estado **En curso** (o **Pendiente** si aún no hay rama).
2. **Al fusionar:** estado **Ejecutado** y enlace al PR cerrado (o nota `merge directo a main` + SHA corto si no hubo PR).
3. **Si se cancela el alcance:** **Descartado** y una línea en *Notas* con el motivo.
4. **Si no aplica** (p. ej. fase opcional no iniciada): **N/A**.

## Leyenda de estados

| Estado | Significado |
|--------|-------------|
| **Pendiente** | Sin PR o sin trabajo iniciado. |
| **En curso** | PR abierto, o rama activa, o trabajo en curso fuera de repo. |
| **Ejecutado** | Mergeado / desplegado / checklist operativa cerrada según el entregable. |
| **Descartado** | Se decidió no hacerlo (documentar por qué en *Notas*). |
| **N/A** | Fuera de alcance actual o fase no iniciada. |

**Repositorio de referencia:** [`pantrux/ia-agent-worker`](https://github.com/pantrux/ia-agent-worker) (ajusta enlaces si usas fork).

---

## T0 — Transversal (documentación y bases de desarrollo)

Entregables que soportan el MVP del roadmap pero no encajan en una sola celda A1–B3.

| ID | Entregable | PR / referencia | Estado | Notas |
|----|------------|-----------------|--------|-------|
| T0.1 | Documento roadmap CF + LangSmith (`ROADMAP-CF-LANGSMITH.md`) | [PR #3](https://github.com/pantrux/ia-agent-worker/pull/3) (merge 2026-05-13) | Ejecutado | — |
| T0.2 | Este tablero (`ROADMAP-IMPLEMENTATION.md`) | [PR #3](https://github.com/pantrux/ia-agent-worker/pull/3) | Ejecutado | Actualizar filas por hito. |
| T0.3 | Agent Server local + `langgraph dev` (Studio solo dev) | [PR #3](https://github.com/pantrux/ia-agent-worker/pull/3) | Ejecutado | — |
| T0.4 | Abstracción CRM (`CrmDatabase` + sql.js local / D1 Worker) | [PR #3](https://github.com/pantrux/ia-agent-worker/pull/3) | Ejecutado | — |
| T0.5 | Metadata LangSmith `deployment` (var `DEPLOYMENT_ENV`) en código Worker | [PR #3](https://github.com/pantrux/ia-agent-worker/pull/3) | Ejecutado | Vars por entorno: ver Fase A / `wrangler.toml` `[env.preview]`. |
| T0.6 | CI smoke remoto (`worker-smoke.yml` + `scripts/smoke-worker.mjs`) | — | Ejecutado | Integrado en `main` (sin PR único de feature); variable `WORKER_SMOKE_URL` en GitHub. |

---

## Fase A — Baseline de gobernanza

| ID | Entregable (según roadmap) | PR / referencia | Estado | Notas |
|----|-----------------------------|-----------------|--------|-------|
| A1 | Reglas WAF + rate limit `/api/chat`, `/api/chat/resume` | — | Pendiente | Acción principal en **dashboard Cloudflare** (§2.0 del roadmap). |
| A2 | Access o JWT en BFF | — | Pendiente | |
| A3 | Secretos + proyectos LangSmith prod/preview | [PR #4](https://github.com/pantrux/ia-agent-worker/pull/4) (merge 2026-05-13) | Ejecutado | Wrangler `preview` + vars; **pendiente manual:** `wrangler secret put … --env preview`, proyecto LangSmith, D1 dedicado cuando toque. |
| A4 | Logs estructurados + retención; metadata `thread_id` / canal | [PR #5](https://github.com/pantrux/ia-agent-worker/pull/5) | En curso | JSON `msg: ia_agent_access` en Worker (`access-log.ts`); sin cuerpos de chat. Retención / Logpush: dashboard CF (manual). |

---

## Fase B — LLMOps v1

| ID | Entregable | PR / referencia | Estado | Notas |
|----|------------|-----------------|--------|-------|
| B1 | AI Gateway (PoC staging → prod) | — | Pendiente | ADR-05 MVP: PoC en esta fase. |
| B2 | Métricas Worker + dashboards LangSmith | — | Pendiente | |
| B3 | Dataset mínimo + eval en CI (más allá del smoke `/ping`) | — | Pendiente | El smoke actual no sustituye eval de calidad. |

---

## Fase C — Multicanal

| ID | Entregable | PR / referencia | Estado | Notas |
|----|------------|-----------------|--------|-------|
| C1 | Queues + payload normalizado + metadata `channel` | — | N/A | |
| C2 | BFF / webhooks por canal | — | N/A | |
| C3 | Durable Objects / Agents SDK si aplica | — | N/A | |

---

## Fase D — MCP y A2A

| ID | Entregable | PR / referencia | Estado | Notas |
|----|------------|-----------------|--------|-------|
| D1 | Allowlist MCP + timeouts | — | N/A | |
| D2 | A2A interno (bindings / cola) | — | N/A | |

---

## Fase E — PoC Containers (opcional)

| ID | Entregable | PR / referencia | Estado | Notas |
|----|------------|-----------------|--------|-------|
| E1 | Imagen + routing Worker | — | N/A | Solo si ADR-03 pivota a Containers. |
| E2 | Presupuesto egress + comparativa | — | N/A | |

---

## Fase F — LangGraph Cloud (opcional)

| ID | Entregable | PR / referencia | Estado | Notas |
|----|------------|-----------------|--------|-------|
| F1 | Deploy gestionado + BFF Worker si aplica | — | N/A | Solo si ADR-04 exige Studio/SDK en prod. |

---

## Historial de cambios (opcional)

| Fecha | Cambio |
|-------|--------|
| 2026-05-13 | Creación del tablero; T0.1–T0.5 ligados a PR #3; T0.6 smoke CI marcado Ejecutado en `main`. |
| 2026-05-13 | Merge [PR #3](https://github.com/pantrux/ia-agent-worker/pull/3) a `main`; T0.1–T0.5 → **Ejecutado**. [PR #4](https://github.com/pantrux/ia-agent-worker/pull/4): A3 (Wrangler `preview` + vars). |
| 2026-05-13 | Merge [PR #4](https://github.com/pantrux/ia-agent-worker/pull/4); A3 → **Ejecutado** (config repo); respuesta Greptile D1 compartido en el hilo del PR. |
| 2026-05-13 | [PR #5](https://github.com/pantrux/ia-agent-worker/pull/5): A4 logs estructurados en Worker; estado **En curso** hasta merge. |

Actualiza esta tabla al cierre de cada hito relevante.
