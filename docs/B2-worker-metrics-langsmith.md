# B2 — Métricas del Worker (Cloudflare) y dashboards LangSmith

Este documento cierra el entregable **B2** del roadmap LLMOps: **observabilidad operativa** del HTTP del Worker (volumen, errores, latencia por ruta) y **vistas en LangSmith** alineadas con proyecto y entorno. Complementa el tracing descrito en [langsmith-integration-plan.md](./langsmith-integration-plan.md) y el dataset/eval de [B3-langsmith-llmops.md](./B3-langsmith-llmops.md).

**Issue de seguimiento:** [PAN-7](https://linear.app/pantrux/issue/PAN-7/b2-metricas-worker-dashboards-langsmith).

**Seguimiento implementación (B2b):** [PAN-9](https://linear.app/pantrux/issue/PAN-9/b2b-export-o-agregacion-automatica-de-metricas-worker-p95-historico) — entregable **B2b** declarado en [ROADMAP-IMPLEMENTATION.md](./ROADMAP-IMPLEMENTATION.md) y [ROADMAP-CF-LANGSMITH.md](./ROADMAP-CF-LANGSMITH.md) (Fase B). Etiquetas Linear del issue: **Feature** + **Área → Observabilidad**.

## 1. Fuentes de verdad (decisión de arquitectura)

| Necesidad | Fuente recomendada en este proyecto | Cuándo considerar otra cosa |
|-----------|-------------------------------------|----------------------------|
| Volumen, códigos HTTP, latencia **por petición HTTP** (incl. `/ping`, CORS, 404) | **Workers Observability** + logs JSON `ia_agent_access` emitidos por [`src/access-log.ts`](../src/access-log.ts) | Si necesitas **percentiles globales** (p. ej. p95 oficial) sin exportar datos: valorar **Logpush** hacia SIEM/analytics o métricas agregadas vía API de observabilidad según tu plan de Cloudflare. |
| Métricas agregadas del isolate (invocaciones, errores de runtime) | **Dashboard del Worker** en Cloudflare (Workers & Pages) | Útil como vista rápida; no sustituye el desglose por `path` / `operation` del access log. |
| Calidad y comportamiento del **grafo** (spans, LLM, herramientas) | **LangSmith** (runs en el proyecto configurado con `LANGSMITH_PROJECT`) | Los logs del Worker no deben incluir cuerpos de chat; el detalle LLM vive en LangSmith. |

**Workers Analytics** (métricas de plataforma sin logs estructurados) puede coexistir con lo anterior; el diseño de este repo se apoya en **logs estructurados + LangSmith** porque ya están implementados y permiten correlación fina (`operation`, `status`, `duration_ms`, `thread_id`, `CF-Ray`).

Referencias oficiales:

- [Workers Observability](https://developers.cloudflare.com/workers/observability/)
- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Logpush](https://developers.cloudflare.com/logs/logpush/) (retención larga / terceros)

## 2. Cloudflare — panel operativo del Worker

### 2.1 Dónde ver el servicio

1. Cloudflare Dashboard → **Workers & Pages**.
2. Abre el Worker de producción (`ia-agent-worker` en `wrangler.toml`) o el de preview (`[env.preview]` → nombre `ia-agent-worker-preview`).

En esa vista suelen aparecer **invocaciones**, errores y tendencias agregadas del isolate.

### 2.2 Observability y logs `ia_agent_access`

En [`wrangler.toml`](../wrangler.toml) está **`[observability] enabled = true`**, lo que habilita el flujo de observabilidad descrito en la documentación de Cloudflare enlazada arriba.

Cada respuesta HTTP relevante pasa por `logWorkerAccess`, que escribe **una línea JSON** con `msg: ia_agent_access` y campos estables:

| Campo | Uso para métricas |
|-------|-------------------|
| `path` | Ruta HTTP (`/api/chat`, `/api/chat/resume`, `/ping`, …) |
| `operation` | Clase lógica (`chat`, `resume`, `ping`, `bff_auth`, …) |
| `status` | Código HTTP de salida |
| `duration_ms` | Latencia de la petición en el Worker (desde entrada al handler hasta respuesta) |
| `deployment` | Valor de `DEPLOYMENT_ENV` (`production` / `preview`) |
| `thread_id` | UUID de hilo si aplica (no PII del mensaje) |
| `cf_ray` / `colo` | Correlación con incidencias de red o edge |

**Latencia tipo p95:** la consola de logs permite filtrar y ordenar por `duration_ms` para inspección; para **p95 continuo** en el tiempo suele hacer falta export (Logpush) o una herramienta de analytics que consuma esos eventos. El **mínimo viable de B2** es: dashboard del Worker + consultas sobre `ia_agent_access` para detectar picos y regresiones.

### 2.3 Retención de logs en Cloudflare

La **retención efectiva** de Workers Logs depende del plan y del producto de observabilidad contratado; revísalo en la documentación actual de Cloudflare y en la configuración de tu cuenta. Si el equipo necesita histórico > ventana por defecto o correlación centralizada, la vía estándar es **Logpush** hacia tu almacén o SIEM (coste y gobernanza aparte).

## 3. LangSmith — vistas por proyecto y entorno

### 3.1 Mapeo con `wrangler.toml`

| Entorno Wrangler | `LANGSMITH_PROJECT` (ejemplo en repo) | `DEPLOYMENT_ENV` |
|------------------|--------------------------------------|------------------|
| Producción (default) | `ia-agent-worker-demo` | `production` |
| `[env.preview]` | `ia-agent-worker-preview` | `preview` |

Cada despliegue envía runs al **proyecto de trazas** indicado en `LANGSMITH_PROJECT`. Mantén **proyectos separados** para prod y preview para evitar mezclar tráfico real con pruebas.

### 3.2 Filtros estables (metadata y tags)

En [`src/index.ts`](../src/index.ts), las invocaciones del grafo usan:

- **Tags:** `api:chat` o `api:resume`, `langsmith`, y `env:production` / `env:preview` según `DEPLOYMENT_ENV`.
- **Metadata:** `thread_id`, `operation` (`chat` / `resume`), `runtime: cloudflare-worker`, `deployment` (mismo valor que `DEPLOYMENT_ENV`).

En la UI de LangSmith, construye vistas guardadas filtrando por esos campos (el nombre exacto del menú puede cambiar; busca en la documentación actual [LangSmith](https://docs.langchain.com/langsmith/home) las secciones de **tracing**, filtros de runs y vistas del proyecto).

### 3.3 Dashboards e Insights

LangSmith permite analizar runs agregados (latencias, errores, costes si aplica) dentro del proyecto. Para no acoplar este repo a nombres de menú concretos:

1. Entra al proyecto de trazas correspondiente (`LANGSMITH_PROJECT`).
2. Usa los **filtros** por tag (`env:…`, `api:chat`, `api:resume`) y por metadata (`deployment`, `operation`).
3. Guarda la vista o crea un **dashboard / panel de Insights** según las opciones de tu plan (ver documentación de producto en [docs.langchain.com/langsmith](https://docs.langchain.com/langsmith/home)).

## 4. Alertas y operación continua

### 4.1 LangSmith

LangSmith ofrece **alertas por umbral** sobre métricas del proyecto (conteo de runs, errores, latencia media, coste si está configurado el seguimiento de costes, etc.). Flujo general: proyecto → **Alerts** → crear regla → ventana de agregación (p. ej. 5 o 15 minutos) → canal de notificación. Detalle: [Alerts in LangSmith](https://docs.langchain.com/langsmith/alerts).

Recomendación práctica: empezar con una alerta de **tasa de errores** o **conteo de errores** filtrada por tag `env:production`, y refinar umbrales tras observar el baseline.

### 4.2 Cloudflare

Las alertas de **infraestructura** (caídas del Worker, picos de 5xx a nivel de cuenta) se configuran en el ecosistema Cloudflare (Notifications / Health Checks / reglas WAF según tu arquitectura). No duplican las alertas de **calidad LLM** en LangSmith; son complementarias.

## 5. Checklist de verificación (cierre B2)

- [ ] En Cloudflare: localizar Worker prod y preview y confirmar que aparecen logs con `msg: ia_agent_access` tras tráfico de prueba.
- [ ] Filtrar por `operation: chat` y revisar distribución de `status` y `duration_ms`.
- [ ] En LangSmith: abrir cada `LANGSMITH_PROJECT` y confirmar runs con tags `env:…` y metadata `deployment` / `operation`.
- [ ] Documentar en el equipo al menos una **vista guardada** o dashboard LangSmith y la política de **retención** (Cloudflare + LangSmith) acordada con privacidad.

## 6. Referencias internas

- Tablero de implementación: [ROADMAP-IMPLEMENTATION.md](./ROADMAP-IMPLEMENTATION.md) (fila B2).
- Roadmap estratégico: [ROADMAP-CF-LANGSMITH.md](./ROADMAP-CF-LANGSMITH.md) (Fase B).
- Contrato API LangSmith: [LANGSMITH-API-CONTRACT.md](./LANGSMITH-API-CONTRACT.md).
