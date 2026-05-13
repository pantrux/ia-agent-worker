# ia-agent-worker — Serverless IA Agent on Cloudflare Workers

Port completo del agente [`pantrux/ia-agent-mvp`](https://github.com/pantrux/ia-agent-mvp) (Python / LangGraph) a **TypeScript** ejecutándose como **Cloudflare Worker serverless** — sin Docker, sin Containers, plan Free de Workers.

**Producción:** `https://ia-agent-worker.<tu-subdominio>.workers.dev`

## Arquitectura del producto

| Repo | Rol |
|------|-----|
| **`pantrux/aaas-landing`** | Landing pública + cliente `/demo` (Next.js / Cloudflare Pages) |
| **`pantrux/ia-agent-worker`** *(este repo)* | Agente serverless (LangGraph.js + D1) en Cloudflare Worker |
| **`pantrux/ia-agent-mvp`** | Implementación de referencia en Python (LangGraph + FastAPI), no en prod |

📐 **Documentación canónica:** [`docs/PROJECT-OVERVIEW.md`](docs/PROJECT-OVERVIEW.md)
🗺 **Diagrama SVG en HTML:** [`docs/architecture.html`](docs/architecture.html)

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Cloudflare Worker (V8 isolate, `nodejs_compat`) |
| Agente | LangGraph.js (`@langchain/langgraph`) |
| LLM | GitHub Models API (`@langchain/openai` → `https://models.github.ai/inference`) |
| Persistencia | Cloudflare D1 (SQLite serverless) — CRM + checkpoints |
| HITL | `interrupt()` + `Command({ resume })` de LangGraph.js |
| Auth LLM | Token GitHub (`gh auth token`) reusado como Bearer hacia GitHub Models |

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/ping` | Healthcheck |
| POST | `/api/chat` | Enviar mensaje al agente. Si el Worker tiene `BFF_API_TOKEN`, enviar `Authorization: Bearer …`. |
| POST | `/api/chat/resume` | Reanudar tras HITL (aprobar/denegar); misma regla Bearer si aplica. |

### POST /api/chat

```json
{ "message": "Show me customer Acme Retail", "thread_id": "optional-uuid" }
```

Respuesta exitosa:
```json
{ "thread_id": "...", "reply": "...", "industry": "retail", "intent": "..." }
```

Respuesta HITL (requiere aprobación):
```json
{ "thread_id": "...", "status": "pending_approval", "interrupt": { "kind": "tool_approval", "tool": "delete_customer_record", "args": {...} } }
```

### POST /api/chat/resume

```json
{ "thread_id": "the-same-uuid", "approved": true }
```

## Setup

```bash
npm install

# Crear base de datos D1
npx wrangler d1 create ia-agent-db
# Copiar el database_id devuelto al wrangler.toml

# Aplicar schema y datos semilla
npx wrangler d1 execute ia-agent-db --local --file=schema.sql
npx wrangler d1 execute ia-agent-db --local --file=seed.sql

# Secreto para LLM
npx wrangler secret put COPILOT_GITHUB_TOKEN

# Secreto para trazas en LangSmith
npx wrangler secret put LANGSMITH_API_KEY

# Opcional (A2): token compartido para el BFF — exige Bearer en POST /api/chat y /api/chat/resume
npx wrangler secret put BFF_API_TOKEN
```

## Autenticación del BFF (Bearer, A2)

Si defines el secreto **`BFF_API_TOKEN`** en el Worker (`npx wrangler secret put BFF_API_TOKEN` y, en preview, `--env preview`), las rutas **`POST /api/chat`** y **`POST /api/chat/resume`** rechazan peticiones sin cabecera válida:

```http
Authorization: Bearer <mismo valor que BFF_API_TOKEN>
```

Si el secreto **no** está definido, el comportamiento es el de antes (útil en desarrollo). En **producción** conviene definirlo y rotarlo con el proceso habitual de secretos.

Desarrollo local: copia [`.dev.vars.example`](.dev.vars.example) a `.dev.vars` y rellena `BFF_API_TOKEN` si quieres probar el flujo autenticado.

Smoke remoto (`npm run smoke:worker` con `SMOKE_INCLUDE_CHAT`): si el Worker exige Bearer, define **`WORKER_SMOKE_BFF_TOKEN`** con el mismo valor (en GitHub Actions: secreto `WORKER_SMOKE_BFF_TOKEN`).

Checklist **WAF / rate limit (A1)** en Cloudflare: [docs/A1-checklist-waf.md](docs/A1-checklist-waf.md).

## Desarrollo local

```bash
npx wrangler dev
```

Requiere: D1 local (aplicar schema/seed con `--local`).

## LangSmith Studio (grafo local)

[LangSmith Studio](https://docs.langchain.com/langsmith/studio) necesita el **Agent Server** de LangGraph, no el HTTP del Worker. Este repo expone el mismo grafo vía [`langgraph.json`](langgraph.json) y [`src/agent-server/graph.ts`](src/agent-server/graph.ts): en Node.js usa **sql.js** (SQLite en memoria) con el mismo `schema.sql` / `seed.sql` que el CRM en D1, y **MemorySaver** como checkpointer (el Worker sigue usando **D1Saver** en producción).

1. Copia [`.env.example`](.env.example) a `.env` en la raíz del repo y rellena `COPILOT_GITHUB_TOKEN` (y opcionalmente `LANGSMITH_*`). El archivo `.env` está en `.gitignore`.
2. Arranca el servidor (escucha en **todas las interfaces IPv4**, puerto **2024**):

```bash
npm run studio
```

La consola puede mostrar un enlace a Studio con `baseUrl=http://0.0.0.0:2024` (por cómo escucha el servidor en la red). **No lo uses:** LangSmith **rechaza el host `0.0.0.0`** (“domain is not allowed”). En **Configure connection** escribe **`http://127.0.0.1:2024`** (sin barra final) y conecta; si tu org lo pide, añade `127.0.0.1` en *Advanced Settings* / lista permitida. Esa URL también evita el caso típico de Windows en el que `localhost` resuelve a IPv6 `::1` y no hay nada escuchando ahí.

3. Con el servidor **en marcha**, en **otra** terminal ejecuta:

```bash
npm run studio:check
```

Debe imprimir `OK http://127.0.0.1:2024/ok → 200`. Si falla, el Agent Server no está levantado o el firewall bloquea Node.

4. En LangSmith Studio, **Configure connection** / URL base: **`http://127.0.0.1:2024`** (sin barra final). No uses `http://localhost:2024` si ves `ECONNREFUSED` solo con `localhost`.
5. El asistente expuesto se llama **`agent`** (coincide con la clave en `langgraph.json` → `graphs`).

Detalle: [`src/agent-server/load-env.ts`](src/agent-server/load-env.ts) carga **`.env` desde la raíz del repo** (no depende del directorio desde el que arranque el CLI).

### Comprobar que el Agent Server responde

Con `npm run studio` en marcha, en el mismo equipo deberías poder abrir en el navegador:

- [http://127.0.0.1:2024/ok](http://127.0.0.1:2024/ok) → JSON `{ "ok": true }`
- [http://127.0.0.1:2024/info](http://127.0.0.1:2024/info) → metadatos de la API

La raíz `http://127.0.0.1:2024/` puede responder **404** (no hay página HTML); eso no indica que el servidor esté caído.

### LangSmith Studio no conecta (Chrome / Safari / Brave)

Sigue la guía oficial [Studio troubleshooting](https://docs.langchain.com/langsmith/troubleshooting-studio):

1. **Chrome 142+ (Private Network Access):** `https://smith.langchain.com` es HTTPS y el agente local es HTTP en `127.0.0.1`. Chrome puede bloquear la petición. En el candado de la barra de direcciones de **smith.langchain.com**, sitio → **Acceso a la red local** → **Permitir**, y recarga. Si ves *Failed to fetch* / *unknown address space*, suele ser esto.
2. **Safari / Brave:** pueden bloquear HTTP en localhost; usa **`npm run studio:tunnel`** (túnel Cloudflare temporal). Copia la URL `https://….trycloudflare.com`, abre Studio → conectar al servidor local → pega esa URL (paso manual de seguridad).
3. **Variables:** sin `.env` con `COPILOT_GITHUB_TOKEN`, el módulo del grafo falla al cargar; revisa la salida de la terminal donde ejecutaste `npm run studio`.

## Despliegue

```bash
# Schema en producción
npx wrangler d1 execute ia-agent-db --file=schema.sql
npx wrangler d1 execute ia-agent-db --file=seed.sql

# Deploy del Worker
npx wrangler deploy
```

### Entorno `preview` (Fase A — LangSmith / metadata)

En [`wrangler.toml`](wrangler.toml) existe **`[env.preview]`** (`ia-agent-worker-preview`). En Wrangler, **`vars` no se heredan** entre entornos: `[env.preview.vars]` repite las mismas claves que producción y cambia `DEPLOYMENT_ENV` y `LANGSMITH_PROJECT` para LangSmith.

```bash
# Desplegar el Worker de preview
npx wrangler deploy --env preview

# Secretos por entorno (mismos nombres que en prod, valores pueden ser distintos)
npx wrangler secret put COPILOT_GITHUB_TOKEN --env preview
npx wrangler secret put LANGSMITH_API_KEY --env preview
npx wrangler secret put BFF_API_TOKEN --env preview
```

La URL pública será `https://ia-agent-worker-preview.<subdominio>.workers.dev`. Úsala en `WORKER_SMOKE_URL` del CI si quieres validar preview en lugar de prod.

Sin Docker. Sin plan Workers Paid. Sin Containers.

## CI: smoke remoto (GitHub Actions)

El workflow [`.github/workflows/worker-smoke.yml`](.github/workflows/worker-smoke.yml) ejecuta `npm run smoke:worker` contra la URL pública del Worker.

1. En el repo de GitHub: **Settings → Secrets and variables → Actions → Variables**.
2. Crea **`WORKER_SMOKE_URL`** con la base **sin** barra final, por ejemplo `https://ia-agent-worker.<cuenta>.workers.dev` (puede ser el mismo hostname que uses para “preview” si despliegas allí versiones de prueba).
3. Opcional: variable **`SMOKE_INCLUDE_CHAT`** con valor `1` o `true` para que el smoke también haga `POST /api/chat` (consume tokens del LLM en el Worker; requiere `COPILOT_GITHUB_TOKEN` configurado en ese despliegue).

Sin `WORKER_SMOKE_URL`, el job **falla** a propósito (evita un CI verde que no comprueba nada).

Local:

```bash
WORKER_SMOKE_URL=https://ia-agent-worker.<cuenta>.workers.dev npm run smoke:worker
# Con chat (opcional):
SMOKE_INCLUDE_CHAT=1 WORKER_SMOKE_URL=https://... npm run smoke:worker
```

## Integración con la landing

La landing [`pantrux/aaas-landing`](https://github.com/pantrux/aaas-landing) **llama directamente al Worker**: la URL queda hardcodeada en `lib/site.ts`. Se eliminaron las Pages Functions de proxy.

El Worker autoriza orígenes con la variable `ALLOWED_ORIGINS` (puede incluir `*` para abrir cualquier origen o una lista separada por comas).

## Arquitectura interna

```
Navegador
  └─ POST {worker}/api/chat            (CORS directo)
       │
       └─► src/index.ts (HTTP handler · CORS · ruteo)
             │
             └─► src/graph.ts — StateGraph (LangGraph.js)
                   │
                   ├─ router_node         (clasifica industria/intent · zod)
                   ├─ model_node          (ChatOpenAI .bindTools + fallback)
                   ├─ tools_node          (CRM SQL en D1 · HITL via interrupt)
                   └─ validation_node     (regex por industria · retries)
             │
             └─► D1Saver (BaseCheckpointSaver) ───► D1: ia-agent-db
                                                    ├─ customers · orders · leads
                                                    └─ checkpoints · checkpoint_writes
             │
             └─► ChatOpenAI ───► GitHub Models API
                                  https://models.github.ai/inference
                                  modelo: openai/gpt-4o-mini
```

## Variables de entorno

| Variable | Tipo | Descripción | Valor habitual |
|----------|------|-------------|----------------|
| `COPILOT_GITHUB_TOKEN` | Secreto | Token GitHub (PAT o `gh auth token`). Reusado como Bearer hacia GitHub Models. | `gho_…` / `ghu_…` |
| `ALLOWED_ORIGINS` | Var | Orígenes CORS (separados por coma). Usa `*` para abrir todos. | `*,http://localhost:3000` |
| `COPILOT_MODEL` | Var | Modelo LLM. | `openai/gpt-4o-mini` |
| `OPENAI_API_BASE` | Var | Base URL del LLM. | `https://models.github.ai/inference` |
| `LANGSMITH_API_KEY` | Secreto | API key de LangSmith para enviar runs/traces. | `lsv2_…` |
| `LANGSMITH_TRACING` | Var | Activa tracing de LangSmith. | `true` |
| `LANGSMITH_PROJECT` | Var | Proyecto destino para las trazas. | `ia-agent-worker-demo` |
| `LANGCHAIN_CALLBACKS_BACKGROUND` | Var | En serverless, usar `false` para esperar flush de callbacks antes de cerrar la request. | `false` |

> Si quieres apuntar al endpoint real de GitHub Copilot (`https://api.individual.githubcopilot.com`), `src/copilot-token.ts` intentará intercambiar el GitHub token por un session token Copilot. Si no, usa el GitHub token tal cual.
