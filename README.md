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
| Ingesta multicanal (PAN-17) | Cloudflare Queues — producer `POST /api/agent/messages`, consumer en el mismo Worker |
| HITL | `interrupt()` + `Command({ resume })` de LangGraph.js |
| Auth LLM | Token GitHub (`gh auth token`) reusado como Bearer hacia GitHub Models |

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/ping` | Healthcheck |
| POST | `/api/chat` | Enviar mensaje al agente (síncrono). Metadata LangSmith: `channel: web`. Si el Worker tiene `BFF_API_TOKEN`, enviar `Authorization: Bearer …`. |
| POST | `/api/chat/resume` | Reanudar tras HITL (aprobar/denegar); misma regla Bearer si aplica. |
| POST | `/api/agent/messages` | Encolar mensaje con payload normalizado (202). Misma regla Bearer si aplica. Ver [`docs/CHAT-QUEUE-PAYLOAD.md`](docs/CHAT-QUEUE-PAYLOAD.md). |

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

# Opcional (A2): token compartido para el BFF — exige Bearer en POST /api/chat, /api/chat/resume y /api/agent/messages
npx wrangler secret put BFF_API_TOKEN
```

### Cloudflare Queues (PAN-17)

Crea las colas referenciadas en `wrangler.toml` (nombres distintos para preview):

```bash
npm run ensure:chat-queues
# o manualmente (incluye colas DLQ para mensajes tras max_retries):
npx wrangler queues create ia-agent-chat-queue
npx wrangler queues create ia-agent-chat-queue-dlq
npx wrangler queues create ia-agent-chat-queue-preview
npx wrangler queues create ia-agent-chat-queue-preview-dlq
```

Contrato del mensaje y política HITL en cola: [`docs/CHAT-QUEUE-PAYLOAD.md`](docs/CHAT-QUEUE-PAYLOAD.md).

**Workers Builds (PR / ramas no producción):** el despliegue por defecto ejecuta `npx wrangler versions upload`. Con colas nuevas, configura en el panel de Cloudflare el comando **no producción** a `npm run cf:versions-upload` (crea las colas si faltan y luego sube la versión). En **producción** (`main`), si el comando es `npm run deploy`, ya incluye `ensure-chat-queues` antes de `wrangler deploy`.

## Autenticación del BFF (Bearer, A2)

Si defines el secreto **`BFF_API_TOKEN`** en el Worker (`npx wrangler secret put BFF_API_TOKEN` y, en preview, `--env preview`), las rutas **`POST /api/chat`**, **`POST /api/chat/resume`** y **`POST /api/agent/messages`** rechazan peticiones sin cabecera válida:

```http
Authorization: Bearer <mismo valor que BFF_API_TOKEN>
```

Si el secreto **no** está definido, el comportamiento es el de antes (útil en desarrollo). En **producción** conviene definirlo y rotarlo con el proceso habitual de secretos.

Desarrollo local: copia [`.dev.vars.example`](.dev.vars.example) a `.dev.vars` y rellena `BFF_API_TOKEN` si quieres probar el flujo autenticado.

**Chat en `aaas-landing` (producción):** el navegador no debe llamar al `*.workers.dev` sin Bearer. Con `BFF_API_TOKEN` en el Worker, en **Cloudflare Pages** del landing configura `AGENT_API_URL` y `BFF_API_TOKEN` (mismo valor); el proxy en `functions/api/chat/*` añade la cabecera. Para propagar el UUID de usuario autenticado al agente (AL.10 / Linear PAN-10), configura también **`AUTH_WORKER_URL`** y **`AUTH_SERVICE_TOKEN`** (mismos valores que el BFF de `/api/auth/*`); el proxy valida la cookie `aaas_session` con `GET /v1/me` y solo entonces envía **`X-AAAS-User-Id`**. En el Worker, esa cabecera solo se usa si `BFF_API_TOKEN` está definido (si no, se ignora). Si usas **dominio propio** en Pages, define también `NEXT_PUBLIC_CHAT_SAME_ORIGIN=1` en el build (ver README de `aaas-landing`). Si no, el cliente puede ir directo al Worker y recibirás `{"error":"No autorizado"}`.

Smoke remoto (`npm run smoke:worker` con `SMOKE_INCLUDE_CHAT`): si el Worker exige Bearer, define **`WORKER_SMOKE_BFF_TOKEN`** con el mismo valor (en GitHub Actions: secreto `WORKER_SMOKE_BFF_TOKEN`).

Checklist **WAF / rate limit (A1)** en Cloudflare: [docs/A1-checklist-waf.md](docs/A1-checklist-waf.md).

## Desarrollo local

```bash
npx wrangler dev
```

Requiere: D1 local (aplicar schema/seed con `--local`).

### Listar modelos del catálogo (GitHub Models)

Con `COPILOT_GITHUB_TOKEN` en `.env` o sesión `gh auth login -h github.com`, consulta el catálogo oficial ([documentación](https://docs.github.com/en/rest/models/catalog?apiVersion=2026-03-10#list-all-models)):

```bash
npm run list:github-models
npm run list:github-models -- --json
```

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

El workflow [`.github/workflows/worker-smoke.yml`](.github/workflows/worker-smoke.yml) ejecuta primero el job **`smoke`** (`npm run smoke:worker` contra la URL pública del Worker). Si existe el secreto **`LANGSMITH_API_KEY`**, un segundo job **`langsmith`** ejecuta preflight, sync de dataset y eval (B3); puedes exigir en branch protection solo el job `smoke` para no bloquear merges por fallos de la API LangSmith.

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

### LangSmith y Cloudflare: métricas operativas (B2)

Paneles recomendados: **Workers Observability** (logs `ia_agent_access`) + vistas en LangSmith por `LANGSMITH_PROJECT` y tags `env:*`. Detalle: [`docs/B2-worker-metrics-langsmith.md`](docs/B2-worker-metrics-langsmith.md).

### LangSmith: dataset + eval (B3)

La estrategia LLMOps define **LangSmith** como sitio donde vive el dataset operativo y los **experimentos** de calidad; el fichero [`evals/dataset-v0.json`](evals/dataset-v0.json) es un snapshot versionado en repo. Guía: [`docs/B3-langsmith-llmops.md`](docs/B3-langsmith-llmops.md).

```bash
export LANGSMITH_API_KEY=lsv2_…
export LANGSMITH_TRACING=true
export WORKER_SMOKE_URL=https://ia-agent-worker.<cuenta>.workers.dev
# Opcional pero recomendable antes del primer sync (ver docs/LANGSMITH-API-CONTRACT.md):
# npm run langsmith:api-preflight
npm run langsmith:dataset:sync
npm run langsmith:eval
```

En GitHub Actions, si configuras el secreto **`LANGSMITH_API_KEY`**, el mismo workflow de smoke (tras `/ping`) sincroniza el dataset y ejecuta la eval; sin ese secreto el paso se omite con un aviso. Variables opcionales: `LANGSMITH_WORKSPACE_ID` (UUID del **workspace**), `LANGSMITH_ENDPOINT` (p. ej. API EU: `https://eu.api.smith.langchain.com` si tu cuenta está en esa región), `LANGSMITH_EVAL_DATASET_NAME`, `EVAL_MIN_MEAN_SCORE`, `LANGSMITH_EXPERIMENT_PREFIX` y **`LANGSMITH_EVAL_ENFORCE`** (`true` => score bajo falla CI; vacío/`false` => solo diagnóstico con resumen agregado en logs).

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
             └─► ChatOpenAI ───► GitHub Models API (o Copilot)
                                  base: OPENAI_API_BASE (p. ej. models.github.ai/inference)
                                  opcional: AI Gateway ruta específica `…/custom-{slug}/inference` + model id catálogo
```

## Variables de entorno

| Variable | Tipo | Descripción | Valor habitual |
|----------|------|-------------|----------------|
| `COPILOT_GITHUB_TOKEN` | Secreto | Token GitHub (PAT o `gh auth token`). Reusado como Bearer hacia GitHub Models. | `gho_…` / `ghu_…` |
| `ALLOWED_ORIGINS` | Var | Orígenes CORS (separados por coma). Usa `*` para abrir todos. | `*,http://localhost:3000` |
| `COPILOT_MODEL` | Var | Modelo LLM. Con Copilot Enterprise usa ids estilo [Openclaw](https://github.com/openclaw/openclaw) sin publisher; con GitHub Models y `models.github.ai`, el Worker prefija `openai/` cuando aplica. | `gpt-5.4-mini` |
| `OPENAI_API_BASE` | Var | Base URL del LLM. | `https://api.enterprise.githubcopilot.com` |
| `LANGSMITH_API_KEY` | Secreto | API key de LangSmith para enviar runs/traces. | `lsv2_…` |
| `LANGSMITH_TRACING` | Var | Activa tracing de LangSmith. | `true` |
| `LANGSMITH_PROJECT` | Var | Proyecto destino para las trazas. | `ia-agent-worker-demo` |
| `LANGCHAIN_CALLBACKS_BACKGROUND` | Var | En serverless, usar `false` para esperar flush de callbacks antes de cerrar la request. | `false` |
| `BFF_API_TOKEN` | Secreto opcional | Si existe, `POST /api/chat` y `/api/chat/resume` exigen `Authorization: Bearer …`. | `wrangler secret put BFF_API_TOKEN` |
| `EXPOSE_CHAT_ERROR` | Var opcional | Si es `true`/`1`/`yes`, los 500 de chat incluyen `detail` y trozo de `stack` (solo depuración; definir en `.dev.vars` local, **no** en `[vars]` de producción). | — |
| `AI_GATEWAY_DISABLED` | Var opcional | Si es `1`/`true`/`yes`/`on`, **ignora** `AI_GATEWAY_*` y el cliente usa solo `OPENAI_API_BASE` (útil para aislar fallos del gateway). | — |
| `AI_GATEWAY_ACCOUNT_ID` | Var opcional | Cuenta Cloudflare; con `AI_GATEWAY_ID` activa el AI Gateway en la URL base del cliente. Si faltan o `AI_GATEWAY_DISABLED` está activo, el LLM usa solo `OPENAI_API_BASE`. | — |
| `AI_GATEWAY_ID` | Var opcional | Identificador del gateway en la URL. | — |
| `AI_GATEWAY_API_TOKEN` | Secreto opcional | Token para cabecera `cf-aig-authorization` si el gateway lo requiere. | `wrangler secret put AI_GATEWAY_API_TOKEN` |
| `AI_GATEWAY_PROVIDER_SLUG` | Var opcional | Slug del custom provider (sin `custom-`). **GitHub Models:** `github-models`, `base_url` = `https://models.github.ai`, path típico `inference`. **Copilot Enterprise:** `github-copilot-enterprise`, `base_url` = host Copilot; el Worker usa la ruta del gateway con path vacío. Sin slug: solo **`/compat`**. | `github-copilot-enterprise` (este repo, Copilot) |
| `AI_GATEWAY_PROVIDER_PATH` | Var opcional | **GitHub Models:** `inference` (`…/custom-{slug}/inference/…`). **Copilot:** debe estar vacío o no definirse; el Worker elige `…/custom-{slug}/v1/responses` para GPT-5/O y conserva `…/custom-{slug}/chat/completions` para modelos chat legacy. | Vacío para Copilot |
| `GITHUB_MODELS_ORG` | Var opcional | Login de la org GitHub. Si `OPENAI_API_BASE` es `https://models.github.ai/inference`, las peticiones van a **`…/orgs/{org}/inference`** (cuando solo la org tiene modelos habilitados). | — |
| `GITHUB_MODELS_API_VERSION` | Var opcional | Valor de la cabecera `X-GitHub-Api-Version` hacia GitHub Models. | `2026-03-10` |

> Si quieres apuntar al endpoint real de GitHub Copilot (`https://api.individual.githubcopilot.com`), `src/copilot-token.ts` intentará intercambiar el GitHub token por un session token Copilot. Si no, usa el GitHub token tal cual.

> **Copilot Enterprise en este repo:** el modelo por defecto es `gpt-5.4-mini` y no hay fallback automático a `gpt-4o`; el `model` enviado al gateway debe coincidir con `COPILOT_MODEL`. Cuando el tráfico va por AI Gateway y el modelo es GPT-5/O, el Worker usa `/v1/responses` porque la ruta `chat/completions` del custom provider devuelve 404 aunque la llamada directa a Copilot funcione.

> **Openclaw vs GitHub Models en este repo:** [openclaw/openclaw](https://github.com/openclaw/openclaw) documenta ids cortos de Copilot (p. ej. `gpt-5.4-mini` en `extensions/github-copilot/models-defaults.ts`) contra la API interna. Aquí, con **`OPENAI_API_BASE`** apuntando a **`models.github.ai`**, el cuerpo debe usar el id del **catálogo REST** (`publisher/modelo`, p. ej. `openai/gpt-4o-mini`). Si defines `COPILOT_MODEL` sin `/` y la base incluye `models.github.ai`, el Worker añade el prefijo **`openai/`** automáticamente para nombres tipo `gpt-*` / `o*`.

### AI Gateway (PoC B1)

#### Opción A — Automático (recomendado)

1. Crea un [API Token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) con permiso **Account → AI Gateway → Edit** y permiso para **listar la cuenta** (p. ej. **Account → Account Settings → Read**, o un token de plantilla que incluya acceso a la cuenta), para que `GET https://api.cloudflare.com/client/v4/accounts` funcione sin `wrangler`.
2. Crea en la raíz del repo un fichero **`.env`** (gitignored) o **`.env.ai-gateway.local`**, y define **`CF_AI_GATEWAY_API_TOKEN=…`** (recomendado; plantillas: [`.env.example`](.env.example), [`.env.ai-gateway.example`](.env.ai-gateway.example)). Evita poner un token solo de AI Gateway en **`CLOUDFLARE_API_TOKEN`** dentro de `.env` si usas `wrangler deploy` con OAuth: Wrangler leería ese token y puede fallar sin permiso Workers.
3. En la raíz del repo: `npm run provision:ai-gateway`  
   Crea si no existen el gateway `ia-agent-worker-llm`, el custom provider **`github-models`** (host `https://models.github.ai`) y **`github-copilot-enterprise`** (host `AI_GATEWAY_COPILOT_BASE_URL`, o `OPENAI_API_BASE` si no apunta a GitHub Models, o `https://api.enterprise.githubcopilot.com`). Si `OPENAI_API_BASE` es solo GitHub Models, el script **no** reutiliza esa URL para el proveedor Copilot (evita `base_url` erróneo en Cloudflare). Omite el segundo proveedor con `AI_GATEWAY_SKIP_COPILOT_PROVIDER=1`. Al final imprime URLs para pegar en el Worker.
4. **Antes del primer deploy** con vars de gateway activas: `npm run check:ai-gateway` (salida 0). El custom provider Copilot debe tener `base_url` = `https://api.enterprise.githubcopilot.com` (sin `/v1` ni query de depuración). Si el CD despliega sin gateway/proveedor aún creados, `/api/chat` fallará hasta ejecutar el paso 3 (o usar `AI_GATEWAY_DISABLED=true` temporalmente). Añade en **[vars]** `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID` y **`AI_GATEWAY_PROVIDER_SLUG=github-copilot-enterprise`** (Copilot vía custom provider; `AI_GATEWAY_PROVIDER_PATH=""`). Para aislar fallos del gateway, `AI_GATEWAY_DISABLED=true`. Despliega con `npm run deploy`.
5. Prueba desde el frontend con el mismo `POST` a `/api/chat`; en **AI Gateway → tu gateway** deberías ver peticiones.

#### Comprobar estado (API Cloudflare)

- Con **`CF_AI_GATEWAY_API_TOKEN`** (o `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN`) en **`.env`** o **`.env.ai-gateway.local`** en la raíz del repo: **`npm run check:ai-gateway`** — código de salida **0** si existen el gateway `AI_GATEWAY_ID` y el custom provider con slug `AI_GATEWAY_PROVIDER_SLUG`; **2** si falta el token (el OAuth de `wrangler login` no sustituye al token del panel para esta API).
- En **GitHub Actions**, workflow **«Provision AI Gateway»** (`workflow_dispatch`): crea el secret **`CLOUDFLARE_API_TOKEN`** en el repo (mismos permisos que arriba; el workflow lo inyecta como **`CF_AI_GATEWAY_API_TOKEN`**) y ejecútalo una vez; opcionalmente variables `CLOUDFLARE_ACCOUNT_ID`, `AI_GATEWAY_ID`, `AI_GATEWAY_PROVIDER_SLUG`, `AI_GATEWAY_CUSTOM_BASE_URL`, `AI_GATEWAY_COPILOT_BASE_URL`, `AI_GATEWAY_COPILOT_SLUG` si no usas los valores por defecto.

#### Si `/api/chat` devuelve 500 y en logs aparece `MODEL_NOT_FOUND` / `404 page not found`

1. **Prueba sin AI Gateway:** define **`AI_GATEWAY_DISABLED=true`** (o `1`) y despliega; el Worker hablará solo con `OPENAI_API_BASE`. Si así funciona, el 404 venía del **gateway** o de la ruta del custom provider, no del catálogo en GitHub.
2. Falta el **custom provider** o el **gateway**: ejecuta `npm run provision:ai-gateway` (local) o el workflow **Provision AI Gateway**, luego **`npm run check:ai-gateway`** hasta salida 0.
3. **GitHub Models + AI Gateway:** el proveedor personalizado debe tener **`base_url` = `https://models.github.ai`** (sin `/inference`). Con la URL antigua, el reenvío puede apuntar a una ruta inexistente (`…/inference/v1/…`) y GitHub responde **404**; LangChain lo muestra como `MODEL_NOT_FOUND`. Vuelve a ejecutar `provision:ai-gateway` y **despliega** el Worker con la versión actual del código (`…/custom-{slug}/inference` en la base del cliente).
4. **Copilot Enterprise + AI Gateway:** el proveedor `github-copilot-enterprise` debe tener **`base_url`** = solo el host del API (p. ej. `https://api.enterprise.githubcopilot.com`). Para modelos GPT-5/O (`gpt-5.4`, etc.) el Worker llama a la ruta específica del proveedor vía **`.../custom-{slug}/v1/responses`**; `.../custom-{slug}/chat/completions` puede devolver 404 desde Cloudflare aunque la llamada directa a Copilot responda 200. Las cabeceras IDE Copilot se envían si el token upstream es `*.githubcopilot.com`.

#### Si el cliente o LangSmith muestra **400** con `[{"code":2005,"message":"Failed to get response from provider"}]`

Eso lo devuelve **AI Gateway** cuando no obtiene una respuesta válida del upstream (timeout, TLS, cuerpo vacío, o ruta incorrecta). Pasos:

1. En **AI Gateway → Logs** del gateway, revisa el error real del intento upstream.
2. **Prueba sin gateway:** `AI_GATEWAY_DISABLED=true` y despliega; si funciona, el fallo está en la ruta/proveedor del gateway.
3. **Copilot:** asegúrate de tener el custom provider con `base_url` solo host y despliega un Worker que no fuerce rutas erróneas. Asegúrate que `AI_GATEWAY_PROVIDER_PATH` esté **vacío**. Si aprovisionaste con una `base_url` errónea, vuelve a ejecutar `npm run provision:ai-gateway`.

#### Si en logs o LangSmith aparece **`403`** / **`No access to model`**

Eso indica que la petición **ya llega** a GitHub Models (ruta e id reconocibles), pero **GitHub deniega el uso** de ese modelo con tu token o contexto (no es un fallo de LangChain).

1. **Token:** la inferencia REST exige alcance **`models: read`** en PAT *fine-grained* (u otro token admitido). Ver [Inferencia (REST)](https://docs.github.com/en/rest/models/inference). Un token solo de `repo` o un `gh auth token` sin permisos de modelos suele producir **403** en chat aunque otras APIs respondan.
2. **Organización:** si los modelos están habilitados para una **org** y no para tu usuario, define en el Worker la variable **`GITHUB_MODELS_ORG`** con el *login* de la org (p. ej. `mi-org`): el Worker usará `https://models.github.ai/orgs/{org}/inference` en lugar de la inferencia global.
3. **Catálogo:** con el mismo token que el Worker, **`npm run list:github-models`**. Si falla con 401/403, corrige el token antes de probar chat. Si lista modelos, usa un **`id`** del listado en **`COPILOT_MODEL`**.
4. **Cabeceras REST:** el Worker envía `Accept: application/vnd.github+json` y `X-GitHub-Api-Version` (por defecto `2026-03-10`; opcional **`GITHUB_MODELS_API_VERSION`**) en llamadas cuya base es `models.github.ai`, como indica la documentación de GitHub.

#### Opción B — Manual (dashboard)

1. En el dashboard de Cloudflare, crea un **AI Gateway** y anota **account id** + **gateway id** (segmentos de la URL `…/v1/{account}/{gateway}/…`).
2. Para **GitHub Models** (`OPENAI_API_BASE=https://models.github.ai/inference` en el Worker para llamadas directas), crea un **custom provider** con **`base_url` = `https://models.github.ai`** (solo el host) y slug `github-models`.
3. En el Worker, define `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID` y `AI_GATEWAY_PROVIDER_SLUG`. Las peticiones van a **`…/custom-{slug}/inference/chat/completions`** en el gateway; el cuerpo lleva **`"model": "openai/gpt-4o-mini"`** (id de catálogo, sin prefijo `custom-`). Ver [custom providers](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/) (ruta específica del proveedor cuando el upstream no sigue solo `/v1/chat/completions`).
4. Si tu gateway exige autenticación de cliente, guarda `AI_GATEWAY_API_TOKEN` como secreto (`wrangler secret put AI_GATEWAY_API_TOKEN`). Referencia compat (sin slug): [Unified API](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/).
