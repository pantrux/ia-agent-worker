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
| T0.7 | LLM: GitHub Models y/o Copilot Enterprise; rotación `COPILOT_GITHUB_TOKEN`, catálogo y doc BFF/Pages | [PR #14](https://github.com/pantrux/ia-agent-worker/pull/14) (merge 2026-05-14), [PR #17](https://github.com/pantrux/ia-agent-worker/pull/17) (merge 2026-05-15), [PR #19](https://github.com/pantrux/ia-agent-worker/pull/19) (merge 2026-05-15), [PR #25](https://github.com/pantrux/ia-agent-worker/pull/25) | Ejecutado | PR #14: scripts `rotate:copilot-github-token`, `list:github-models`; AI Gateway. PR #17: Copilot Enterprise e intercambio Openclaw. PR #18: cabeceras IDE Copilot en inferencia. PR #19 documentó compatibilidad de modelos; PR #25/#26 fijan Copilot Enterprise en `gpt-5.4` sin remap ni fallback automático; el transporte Gateway para GPT-5/O usa `/v1/responses`. |

---

## Fase A — Baseline de gobernanza

| ID | Entregable (según roadmap) | PR / referencia | Estado | Notas |
|----|-----------------------------|-----------------|--------|-------|
| A1 | Reglas WAF + rate limit `/api/chat`, `/api/chat/resume` | — | Pendiente | Acción principal en **dashboard Cloudflare** (§2.0 del roadmap). Checklist repo: [A1-checklist-waf.md](./A1-checklist-waf.md). |
| A2 | Access o JWT en BFF | [PR #6](https://github.com/pantrux/ia-agent-worker/pull/6) (merge 2026-05-13) | Ejecutado | Bearer opcional vía secreto `BFF_API_TOKEN`; smoke con `WORKER_SMOKE_BFF_TOKEN` en Actions. Ver README. |
| A3 | Secretos + proyectos LangSmith prod/preview | [PR #4](https://github.com/pantrux/ia-agent-worker/pull/4) (merge 2026-05-13) | Ejecutado | Wrangler `preview` + vars; **pendiente manual:** `wrangler secret put … --env preview`, proyecto LangSmith, D1 dedicado cuando toque. |
| A4 | Logs estructurados + retención; metadata `thread_id` / canal | [PR #5](https://github.com/pantrux/ia-agent-worker/pull/5) (merge 2026-05-13) | Ejecutado | JSON `msg: ia_agent_access`, `requestTs` al inicio del handler; sin cuerpos de chat. Retención / Logpush: dashboard CF (manual). |
| A5 | Hardening `ALLOWED_ORIGINS` sin `*` en producción ([PAN-25](https://linear.app/pantrux/issue/PAN-25)) | rama `fix-pan-25-allowed-origins-no-wildcard` | En curso | Lista explícita en `wrangler.toml` `[vars]` y `[env.preview.vars]`; comodín neutralizado en `src/cors.ts`; tests unitarios en `src/cors.test.ts`; checklist [A1-checklist-waf.md §5](./A1-checklist-waf.md). |

---

## Fase B — LLMOps v1

| ID | Entregable | PR / referencia | Estado | Notas |
|----|------------|-----------------|--------|-------|
| B1 | AI Gateway (PoC staging → prod) | [PR #7](https://github.com/pantrux/ia-agent-worker/pull/7) (merge 2026-05-13); [PR #20](https://github.com/pantrux/ia-agent-worker/pull/20) (merge 2026-05-15); [PR #22](https://github.com/pantrux/ia-agent-worker/pull/22) (merge 2026-05-15); [PR #23](https://github.com/pantrux/ia-agent-worker/pull/23) (merge 2026-05-15) | Ejecutado | PR #20: gateway + proveedor Copilot (`v1`), provision dual, cabeceras IDE. **PR #22:** Router no usa `json_schema` para evitar error 400. **PR #23:** Fix definitivo error 2005; Copilot por gateway usa ruta *provider-specific* con path **vacío** (`""`) para llegar directo a `/chat/completions` sin `/v1` adicional. |
| B1b | AI Gateway + **custom provider** (GitHub Models) sin romper el SDK OpenAI | [PR #8](https://github.com/pantrux/ia-agent-worker/pull/8) (merge 2026-05-13); [PR #9](https://github.com/pantrux/ia-agent-worker/pull/9) (merge 2026-05-13) | Ejecutado | **Evolución:** PR #8 probó URL **provider-specific** `…/custom-{slug}`; LangSmith seguía con `MODEL_NOT_FOUND` / rutas upstream inválidas con el cliente OpenAI. **PR #9 (definitivo):** se mantiene **`/compat`** y el modelo pasa a `custom-{slugClean}/{modelo}` cuando hay `AI_GATEWAY_PROVIDER_SLUG` (patrón Cloudflare + OpenAI SDK). README + `ai-gateway.ts` + `provision-ai-gateway.mjs` alineados. |
| B2 | Métricas Worker + dashboards LangSmith | [PR #35](https://github.com/pantrux/ia-agent-worker/pull/35) | Ejecutado | Guía [B2-worker-metrics-langsmith.md](./B2-worker-metrics-langsmith.md). Issue [PAN-7](https://linear.app/pantrux/issue/PAN-7/b2-metricas-worker-dashboards-langsmith). |
| B2b | Export / agregación automática de métricas Worker (p95, histórico) | [PR #38](https://github.com/pantrux/ia-agent-worker/pull/38) | En curso | [PAN-9](https://linear.app/pantrux/issue/PAN-9/b2b-export-o-agregacion-automatica-de-metricas-worker-p95-historico). Decisión + pipeline: [B2b-worker-access-metrics-export.md](./B2b-worker-access-metrics-export.md); `logpush` en `wrangler.toml`; agregador `scripts/aggregate-ia-agent-access.mjs`. |
| B3 | Dataset mínimo + eval en LangSmith (snapshot en repo + CI opcional) | [PR #29](https://github.com/pantrux/ia-agent-worker/pull/29) (merge 2026-05-15) | Ejecutado | Estrategia: fuente de verdad del dataset en **LangSmith**; `evals/dataset-v0.json` + `npm run langsmith:dataset:sync` / `langsmith:eval`; umbral `EVAL_MIN_MEAN_SCORE`. Ver [B3-langsmith-llmops.md](./B3-langsmith-llmops.md). |

---

## Fase C — Multicanal

| ID | Entregable | PR / referencia | Estado | Notas |
|----|------------|-----------------|--------|-------|
| C1 | Queues + payload normalizado + metadata `channel` | [PR #39](https://github.com/pantrux/ia-agent-worker/pull/39) (merge `efbbc4f`, 2026-05-16) | Ejecutado | Contrato y runbook: [CHAT-QUEUE-PAYLOAD.md](./CHAT-QUEUE-PAYLOAD.md). Linear [PAN-17](https://linear.app/pantrux/issue/PAN-17) Done. |
| C2 | BFF / webhooks por canal (Telegram v1) | [PR #41](https://github.com/pantrux/ia-agent-worker/pull/41) (merge `62971de`) + [PR #33 `aaas-landing`](https://github.com/pantrux/aaas-landing/pull/33) (`c2cb3ab`) | Ejecutado | `delivery` en cola, `CHAT_THREAD_KV`, pending por `update_id`, `sendTelegramMessage`; webhook en Pages. Ver [`CHAT-QUEUE-PAYLOAD.md`](./CHAT-QUEUE-PAYLOAD.md) § Telegram y [`PAN-18-c2-channel-webhooks-design.md`](https://github.com/pantrux/aaas-landing/blob/main/docs/PAN-18-c2-channel-webhooks-design.md). [PAN-18](https://linear.app/pantrux/issue/PAN-18) Done. |
| C3 | Durable Objects / Agents SDK (WebSocket) | [PAN-19](https://linear.app/pantrux/issue/PAN-19) | En curso | [`PAN-19-c3-websocket-design.md`](https://github.com/pantrux/aaas-landing/blob/main/docs/PAN-19-c3-websocket-design.md) · [`ADR-C3-websocket-langgraph-hybrid.md`](./ADR-C3-websocket-langgraph-hybrid.md) |

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
| 2026-05-13 | Regla operativa `.cursor/rules/pr-documentacion-espanol.mdc` en `main` (documentación y trazabilidad de PR en español). |
| 2026-05-13 | Merge [PR #5](https://github.com/pantrux/ia-agent-worker/pull/5); A4 → **Ejecutado** (logs estructurados en Worker). |
| 2026-05-13 | A2 en curso: autenticación Bearer BFF (`BFF_API_TOKEN`); checklist A1 en [A1-checklist-waf.md](./A1-checklist-waf.md). |
| 2026-05-13 | Abierto [PR #6](https://github.com/pantrux/ia-agent-worker/pull/6) (A2 Bearer BFF + checklist A1). |
| 2026-05-13 | Merge [PR #7](https://github.com/pantrux/ia-agent-worker/pull/7); B1 → **Ejecutado** (enrutado opcional AI Gateway compat + documentación). |
| 2026-05-13 | **B1b:** abierto [PR #8](https://github.com/pantrux/ia-agent-worker/pull/8) — provider-specific AI Gateway + `EXPOSE_CHAT_ERROR` opt-in; al merge: B1b → **Ejecutado**. |
| 2026-05-13 | **PR #8 (revisión):** `EXPOSE_CHAT_ERROR` retirado de `[vars]` prod; helper `chatInternalErrorBody`; slug normalizado en `provision-ai-gateway.mjs`; guarda `slugClean` vacío en `ai-gateway.ts`. |
| 2026-05-13 | Merge [PR #8](https://github.com/pantrux/ia-agent-worker/pull/8) a `main` (`252def3`); **B1b** → **Ejecutado**. Greptile (último commit) sin bloqueos; checks smoke + Workers Builds en verde. |
| 2026-05-13 | Script `check:ai-gateway` + workflow «Provision AI Gateway» (API Token); despliegue Worker desde `main` con código al día; pendiente aprovisionar AI Gateway en CF mientras `CLOUDFLARE_API_TOKEN` esté vacío en local/repo. |
| 2026-05-13 | **Operación:** `AI_GATEWAY_*` comentado en `wrangler.toml` (prod/preview); LLM directo a GitHub Models; plantilla `.env` en disco (gitignored). Smoke `/api/chat` OK. Reactivar gateway tras `CLOUDFLARE_API_TOKEN` + `provision:ai-gateway`. |
| 2026-05-13 | **Tokens:** scripts AI Gateway leen **`CF_AI_GATEWAY_API_TOKEN`** primero (evita que `CLOUDFLARE_API_TOKEN` en `.env` rompa `wrangler deploy` con OAuth). Workflow mapea secret `CLOUDFLARE_API_TOKEN` → `CF_AI_GATEWAY_API_TOKEN`. |
| 2026-05-13 | Merge [PR #9](https://github.com/pantrux/ia-agent-worker/pull/9) a `main`: AI Gateway **/compat** + modelo `custom-{slug}/…` para custom provider; nit CodeRabbit (strip de prefijo solo al construir `compatModel`). **B1b** actualizado en tablero para reflejar la decisión final (ya no depende de la ruta `…/custom-{slug}` en runtime). |
| 2026-05-14 | Merge [PR #16](https://github.com/pantrux/ia-agent-worker/pull/16): GitHub Models + AI Gateway con **ruta provider-specific** (`…/custom-{slug}/{path}`), `AI_GATEWAY_PROVIDER_PATH` (defecto `inference`), `base_url` del proveedor = host `https://models.github.ai`, provision con PATCH ampliado; corrige **404 / MODEL_NOT_FOUND** que producía solo `/compat` contra `models.github.ai/inference`. |
| 2026-05-15 | **B3 / LLMOps:** estrategia centrada en LangSmith (dataset operativo + experimentos); snapshot `evals/dataset-v0.json`, scripts `langsmith:*`, paso opcional en `worker-smoke.yml`. Ver [B3-langsmith-llmops.md](./B3-langsmith-llmops.md). |
| 2026-05-15 | Merge [PR #29](https://github.com/pantrux/ia-agent-worker/pull/29) a `main` (`470ef101`); **B3** → **Ejecutado** (dataset operativo en LangSmith, eval remota contra el Worker, job opcional `langsmith` en CI). Issue Linear [PAN-6](https://linear.app/pantrux/issue/PAN-6/b3-dataset-minimo-evaluacion-en-ci) cerrada. |
| 2026-05-15 | **B2 / PAN-7:** guía métricas Worker (Observability + `ia_agent_access`) y dashboards LangSmith en [B2-worker-metrics-langsmith.md](./B2-worker-metrics-langsmith.md); seguimiento en [PR #35](https://github.com/pantrux/ia-agent-worker/pull/35). |
| 2026-05-15 | **B2b / PAN-9:** fila **B2b** en tablero y en `ROADMAP-CF-LANGSMITH` (export/agregación p95); issue [PAN-9](https://linear.app/pantrux/issue/PAN-9); grupo Linear **Área** (Observabilidad, Frontend, Backend-Worker, Seguridad). |
| 2026-05-16 | **B2b / PAN-9:** [PR #38](https://github.com/pantrux/ia-agent-worker/pull/38) — documento [B2b-worker-access-metrics-export.md](./B2b-worker-access-metrics-export.md), agregador NDJSON + CI, `logpush = true` en Wrangler; guía B2 §2.4 enlazada. |
| 2026-05-16 | **C1 / PAN-17:** merge [PR #39](https://github.com/pantrux/ia-agent-worker/pull/39) a `main` (`efbbc4f`); colas + DLQ, `POST /api/agent/messages`, consumer `queue()`, metadata `channel` en LangSmith; Greptile 5/5; [CHAT-QUEUE-PAYLOAD.md](./CHAT-QUEUE-PAYLOAD.md). |
| 2026-05-16 | **C2 / PAN-18:** merge [PR #41](https://github.com/pantrux/ia-agent-worker/pull/41) (`62971de`); entrega Telegram en consumer (KV hilo + pending + Bot API); BFF webhook en [PR #33 aaas-landing](https://github.com/pantrux/aaas-landing/pull/33); validado en producción. |

Actualiza esta tabla al cierre de cada hito relevante.
