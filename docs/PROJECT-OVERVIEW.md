# Orquesta — Visión del ecosistema completo

Este documento describe el **proyecto Orquesta** tal y como está desplegado en producción. El ecosistema está formado por **tres repositorios** con responsabilidades bien delimitadas:

| Repositorio | Rol | Ruta de producción |
|-------------|-----|---------------------|
| **`pantrux/aaas-landing`** | Landing pública (Next.js) + cliente del chat `/demo` | Cloudflare Pages → `aaas-landing.pages.dev` |
| **`pantrux/ia-agent-worker`** | Agente LangGraph.js como Cloudflare Worker serverless + D1 | Cloudflare Worker → `ia-agent-worker.<subdominio>.workers.dev` |
| **`pantrux/ia-agent-mvp`** *(referencia)* | Implementación original Python / FastAPI / LangGraph | **No en producción** — sirve como referencia y banco local |

> El despliegue **serverless** (Worker + D1) sustituyó a la primera iteración basada en Cloudflare Containers (FastAPI dentro de un Durable Object). Se hizo el porting tras confirmar que el plan Workers actual no incluía Containers; toda la lógica está ahora en TypeScript y D1.

---

## 1. Objetivo de producto

- **Landing (aaas-landing).** Sitio público multi-idioma (`/es`, `/en`) que vende la propuesta **Agentic-as-a-Service**. La ruta **`/demo`** incrusta un chat funcional contra el agente.
- **Agente (ia-agent-worker).** Orquestación **LangGraph.js** multi-industria (`retail`, `finance`, `health`), con:
  - Persistencia por `thread_id` (Cloudflare D1).
  - **Human-in-the-loop** sobre acciones críticas de CRM (`delete_customer_record`).
  - Validación de respuestas por industria.
  - Inferencia LLM contra **GitHub Models API** (compatible OpenAI).
- **Referencia (ia-agent-mvp).** Mismo grafo, mismas tools, en Python + FastAPI. Útil para desarrollo local, exploración y comparación de comportamiento.

---

## 2. Diagrama

Representación gráfica autocontenida (HTML + SVG, se abre en cualquier navegador sin servidor):

- **Archivo:** [`docs/architecture.html`](architecture.html)

---

## 3. Flujo de datos en producción

```text
Navegador
  │
  ├─ GET sitio + /demo  ─────────► Cloudflare Pages (aaas-landing)
  │                                Next.js export estático, HTML/JS/CSS
  │
  └─ POST /api/chat (CORS) ──────► Cloudflare Worker (ia-agent-worker)
                                    │
                                    ├─ LangGraph.js StateGraph
                                    │   router → model ⇄ tools → validation
                                    │
                                    ├─ D1Saver (checkpointer)  ┐
                                    │                          ├─► Cloudflare D1
                                    └─ CRM tools (SQL queries) ┘   (customers, orders, leads,
                                                                    checkpoints, checkpoint_writes)
                                    │
                                    └─ ChatOpenAI → GitHub Models API
                                                    https://models.github.ai/inference
                                                    modelo: openai/gpt-4o-mini
```

Notas:

- El cliente del chat **llama al Worker directamente** (no hay Pages Functions de proxy). El Worker autoriza orígenes con `ALLOWED_ORIGINS`.
- D1 alberga tanto la **simulación CRM** como los **checkpoints** de LangGraph (mismos esquemas, base `ia-agent-db`).
- Autenticación al LLM: el secreto `COPILOT_GITHUB_TOKEN` es un token de `gh auth token`; el código (`src/copilot-token.ts`) intenta intercambiar a token Copilot y, si la base URL no es la de Copilot, lo usa **tal cual** contra GitHub Models.

---

## 4. Repositorio `pantrux/aaas-landing`

### 4.1 Stack

- **Next.js 15** (App Router, Server Components, TypeScript) en modo **export estático** (`output: "export"`).
- **Tailwind v4** con tokens CSS-first (`@theme`) en `app/globals.css`.
- **shadcn/ui** + **Radix** + **Framer Motion** + **lucide-react**.
- **next-intl** v3 (rutas `/es` y `/en`).

### 4.2 Cómo encaja con el agente

| Pieza | Detalle |
|-------|---------|
| `lib/site.ts` | Resuelve `AGENT_API_BASE`. En producción está **hardcodeado** a la URL del Worker (`https://ia-agent-worker.<subdominio>.workers.dev`). |
| `components/demo/agent-chat.tsx` | Componente cliente que hace `fetch(POST /api/chat)` y `fetch(POST /api/chat/resume)` directos al Worker. Gestiona thread_id en `localStorage` y auto-scroll interno (la página no se mueve al enviar). |
| `app/[locale]/demo/page.tsx` | Wrapper RSC que renderiza el `AgentChat`. |
| `public/_redirects` | `/` → `/es/` (manejado por Cloudflare Pages). |

### 4.3 Despliegue

- **GitHub Actions / Cloudflare Pages CI**: cada `git push` a `main` dispara build.
- Build: `npm run build` → carpeta `out/`.
- No requiere variables de entorno para que `/demo` funcione (la URL del Worker viene compilada). Opcionalmente se puede sobreescribir con `NEXT_PUBLIC_AGENT_API_URL`.

---

## 5. Repositorio `pantrux/ia-agent-worker`

### 5.1 Stack

- **Cloudflare Worker** (TypeScript, V8 isolate, `nodejs_compat`).
- **LangGraph.js** (`@langchain/langgraph`) — StateGraph + Annotation API.
- **@langchain/openai** — cliente Chat compatible OpenAI.
- **@langchain/langgraph-checkpoint** — base abstracta para el checkpointer.
- **Cloudflare D1** (SQLite serverless) — binding `env.DB`.
- **zod** — schemas de structured output para el router.

### 5.2 Estructura

| Ruta | Función |
|------|---------|
| `src/index.ts` | Entry HTTP del Worker (`fetch`): CORS + ruteo (`/ping`, `/api/chat`, `/api/chat/resume`). |
| `src/graph.ts` | `buildGraph(env)`: compone el StateGraph con los nodos y aristas condicionales. |
| `src/state.ts` | `GraphAnnotation` con `messages`, `industry`, `intent`, `toolState`, `validationPass`, `policyFeedback`, `retryCount`. |
| `src/nodes/router.ts` | Clasificador de industria/intent con structured output (zod). |
| `src/nodes/model.ts` | Llamada al LLM con tools-bound + fallback de modelo. |
| `src/nodes/tools.ts` | Ejecuta tool calls; lanza `interrupt()` para tools sensibles (HITL). |
| `src/nodes/validation.ts` | Aplica regex/keywords por industria; reintenta si falla. |
| `src/tools/crm.ts` | Tools LangChain que consultan/mutan D1 (CRM mock). |
| `src/validators/` | Reglas por industria (`retail.ts`, `finance.ts`, `health.ts`) + `index.ts`. |
| `src/persistence/d1-saver.ts` | `D1Saver` (extiende `BaseCheckpointSaver`): `getTuple`, `list`, `put`, `putWrites`. Serializa con `JsonPlusSerializer` y guarda como TEXT UTF-8. |
| `src/copilot-token.ts` | Estrategia de auth: intenta exchange Copilot; cae a usar el token directo si el base URL no es Copilot. |
| `schema.sql` | DDL de las 5 tablas D1 (`customers`, `orders`, `leads`, `checkpoints`, `checkpoint_writes`). |
| `seed.sql` | Datos iniciales del CRM mock. |
| `wrangler.toml` | Worker name, D1 binding, vars y flags. |

### 5.3 StateGraph

```
START → router → model ─┐
                        │
                  (tool_calls)
                        ▼
                       tools ──► (vuelve a) model
                                       │
                                  (sin tool_calls)
                                       ▼
                                  validation ──► END
                                       │
                                  (fail + retries<máx)
                                       ▼
                                     model
```

- HITL: `tools_node` detecta `delete_customer_record` y llama `interrupt({...})`. El frontend recibe `status: pending_approval` + payload; al reanudar con `POST /api/chat/resume` el Worker hace `graph.invoke(new Command({ resume: { approved } }))`.

### 5.4 Endpoints

| Método | Ruta | Cuerpo | Respuesta |
|--------|------|--------|-----------|
| `GET` | `/ping` | – | `{ status: "ok" }` |
| `POST` | `/api/chat` | `{ message, thread_id? }` | `{ thread_id, reply, industry, intent, tool_state }` o `{ status: "pending_approval", interrupt }` |
| `POST` | `/api/chat/resume` | `{ thread_id, approved }` | `{ thread_id, reply, industry, tool_state }` |

### 5.5 Variables y secretos

```toml
# wrangler.toml
[[d1_databases]]
binding       = "DB"
database_name = "ia-agent-db"
database_id   = "..."

[vars]
ALLOWED_ORIGINS = "*,http://localhost:3000,http://127.0.0.1:3000"
COPILOT_MODEL   = "openai/gpt-4o-mini"
OPENAI_API_BASE = "https://models.github.ai/inference"
```

Secretos:

- `COPILOT_GITHUB_TOKEN` — token GitHub (PAT o salida de `gh auth token`).

### 5.6 Despliegue

```bash
# Crear D1 (una sola vez)
npx wrangler d1 create ia-agent-db
# Pegar el database_id devuelto en wrangler.toml

# Aplicar schema y semillas
npx wrangler d1 execute ia-agent-db --remote --file=schema.sql
npx wrangler d1 execute ia-agent-db --remote --file=seed.sql

# Subir secreto
npx wrangler secret put COPILOT_GITHUB_TOKEN

# Deploy
npx wrangler deploy
```

CI: el repo está conectado a **Cloudflare Workers Builds**; cada push a `main` ejecuta `wrangler deploy` automáticamente.

---

## 6. Repositorio `pantrux/ia-agent-mvp` (referencia, Python)

### 6.1 Estado

- Implementación original del agente en **Python 3.10+**: LangGraph + LangChain + FastAPI.
- Sigue siendo válida para desarrollo local; expone el mismo contrato HTTP (`/api/chat`, `/api/chat/resume`, `/ping`) mediante `uvicorn web.serve:app`.
- **Históricamente** se intentó llevar este código a **Cloudflare Containers** con un Worker que reenvía al contenedor FastAPI (carpeta `cloudflare-worker/`, `Dockerfile.cf`). La cuenta Cloudflare actual no tiene Containers habilitado, por eso se hizo el porting a `ia-agent-worker`.

### 6.2 Cuándo usarlo

- Comparar comportamiento entre la implementación Python y la TypeScript.
- Iterar el grafo con tooling Python (debug, notebooks, etc.) antes de portar al Worker.
- Documentar y reproducir el flujo de OAuth con GitHub Copilot (scripts en `scripts/copilot_oauth_*.py`).

---

## 7. Persistencia D1 (`ia-agent-db`)

| Tabla | Origen | Uso |
|-------|--------|-----|
| `customers` | `seed.sql` | CRM mock |
| `orders` | `seed.sql` | CRM mock |
| `leads` | – | CRM mock (escrito por la tool `create_lead`) |
| `checkpoints` | LangGraph | Estado canónico de cada thread |
| `checkpoint_writes` | LangGraph | Escrituras pendientes (HITL, retries) |

Notas operativas:

- El payload de `checkpoint` y `checkpoint_writes.value` se guarda como **TEXT UTF-8** (no BLOB). El `D1Saver` codifica/decodifica con `TextEncoder` / `TextDecoder` y normaliza el shape del checkpoint al leer (compatible con rows antiguas).
- Para resetear sesiones en un thread:
  ```bash
  npx wrangler d1 execute ia-agent-db --remote \
    --command "DELETE FROM checkpoint_writes; DELETE FROM checkpoints;"
  ```

---

## 8. Autenticación LLM

El Worker llama al LLM con `ChatOpenAI` (`@langchain/openai`):

```
OPENAI_API_BASE = https://models.github.ai/inference
COPILOT_MODEL   = openai/gpt-4o-mini
COPILOT_GITHUB_TOKEN = gho_... | ghu_... | ghp_...
```

`src/copilot-token.ts`:

1. Si `OPENAI_API_BASE` apunta a `*.githubcopilot.com`, intenta intercambiar el GitHub token por un Copilot session token (`/copilot_internal/v2/token`).
2. Si el intercambio falla **o** el base URL no es Copilot (caso actual: GitHub Models), usa el GitHub token tal cual como `Authorization: Bearer …`.

Esto permite usar el mismo secreto contra cualquiera de los dos endpoints OpenAI-compatibles.

---

## 9. CI/CD resumen

| Repo | CI/CD | Disparador | Acción |
|------|-------|------------|--------|
| `aaas-landing` | Cloudflare Pages | push a `main` | `npm run build` → publica `out/` |
| `ia-agent-worker` | Cloudflare Workers Builds | push a `main` | `npx wrangler deploy` |
| `ia-agent-mvp` | (manual / Actions opcionales) | – | Ya no se publica en CF; solo dev local |

---

## 10. Checklist mínimo de variables (producción)

**Cloudflare Worker (`ia-agent-worker`):**

- `[vars]` en `wrangler.toml`: `ALLOWED_ORIGINS`, `COPILOT_MODEL`, `OPENAI_API_BASE`.
- Secret: `COPILOT_GITHUB_TOKEN`.
- Binding: `[[d1_databases]] binding = "DB"` apuntando a `ia-agent-db`.

**Cloudflare Pages (`aaas-landing`):**

- Opcional `NEXT_PUBLIC_AGENT_API_URL` para sobrescribir el endpoint del Worker en build.
- Sin secretos necesarios.

---

## 11. Referencias internas

- Worker: [`README.md`](https://github.com/pantrux/ia-agent-worker) del repo `ia-agent-worker`.
- Landing: [`README.md`](https://github.com/pantrux/aaas-landing) del repo `aaas-landing`.
- Python: [`README.md`](https://github.com/pantrux/ia-agent-mvp) del repo `ia-agent-mvp`.
- Diagrama: [`docs/architecture.html`](architecture.html) en cualquiera de los tres repos.
