# B2b — Export y agregación de métricas HTTP del Worker (p95, histórico)

Este documento cierra el entregable **B2b** del roadmap: **decisión de arquitectura**, **pipeline mínimo verificable** y **operación** para obtener percentiles (p. ej. **p95 de `duration_ms` por `operation`**) y conteos de error **sin depender solo de filtros manuales** en Workers Observability.

**Issues:** [PAN-9](https://linear.app/pantrux/issue/PAN-9/b2b-export-o-agregacion-automatica-de-metricas-worker-p95-historico) (implementación B2b), antecedente [PAN-7](https://linear.app/pantrux/issue/PAN-7/b2-metricas-worker-dashboards-langsmith) (guía B2).

**Relación con B2:** la guía operativa de paneles sigue en [B2-worker-metrics-langsmith.md](./B2-worker-metrics-langsmith.md). B2b añade **retención larga** y **cálculos agregados reproducibles** sobre el mismo contrato de log JSON `ia_agent_access` definido en [`src/access-log.ts`](../src/access-log.ts).

---

## 1. Decisión de destino (fuente y retención)

| Opción | Ventaja | Inconveniente | Uso en este proyecto |
|--------|---------|----------------|----------------------|
| **Solo Workers Observability** | Sin coste adicional de almacén; correlación inmediata en consola | Retención acotada al plan; p95 «oficial» por ventana exige export o trabajo manual | Sigue siendo la primera línea (B2). |
| **Logpush `workers_trace_events` → R2 / S3 / SIEM** | NDJSON en tu cuenta; retención y políticas tuyas; compatible con `console.log` que ya emite `ia_agent_access` | Requiere **Workers Paid** y rol con permisos Logpush; coste de almacenamiento y posible ingest en SIEM | **Elegido como vía principal B2b** para histórico y agregados. |
| **Logpush → endpoint HTTP** | Integración directa con pipeline propio | Operación del receptor (disponibilidad, auth, backpressure) | Opcional si ya tenéis un colector estándar. |
| **Analytics Engine** u otros productos CF | Consultas SQL sobre series en edge | Curva de aprendizaje y línea de coste distinta | Valorar solo si el equipo ya usa AE y acepta el modelo de facturación. |

**Motivo de coste y operación:** Logpush de **Workers Trace Events** reutiliza el mismo instrumento que ya escribe los logs estructurados (`ia_agent_access` via `console.log`). No introduce un segundo path en el código del agente ni cambia el contrato HTTP. El coste marginal es el de **Logpush** (plan Workers) + **almacén** (p. ej. R2 barato para NDJSON particionado por fecha) + el **job ocasional** (CI o cron interno) que ejecuta el agregador de este repo.

**Retención objetivo:** gobernanza del equipo (p. ej. 30–90 días en R2 con ciclo de vida, o más en data lake corporativo). Cloudflare conserva en Observability según plan; Logpush desacopla el histórico de esa ventana.

**Habilitación en el Worker:** en `wrangler.toml` está `logpush = true` (producción y `env.preview`). Tras desplegar, en el dashboard del Worker → **Settings → Observability → Logpush** debe figurar **Enabled** una vez exista al menos un **Logpush job** de dataset `workers_trace_events` en la cuenta (véase documentación oficial [Workers Logpush](https://developers.cloudflare.com/workers/observability/logs/logpush/)).

---

## 2. Implementación mínima verificable (agregación)

### 2.1 Script de agregación

El script **`scripts/aggregate-ia-agent-access.mjs`** consume **NDJSON**:

1. **Líneas de access directas:** cada línea es el JSON emitido por `logWorkerAccess` (`msg: ia_agent_access`, …).
2. **Líneas de Logpush (trace):** cada línea es un evento con campo `Logs` (mensajes de consola); el script extrae los JSON `ia_agent_access` embebidos.

**Métricas expuestas** (esquema `ia_agent_access_aggregate_v1` en salida JSON):

- Por `operation`: `count`, `duration_ms_p50`, `duration_ms_p95`, `http_4xx`, `http_5xx`.
- **Totales** globales en la ventana del fichero.

**Percentil:** regla de **rango más cercano** (habitual en SLIs de latencia).

**Filtro opcional:** `--script-name ia-agent-worker` para ignorar otros scripts en el mismo dataset de cuenta.

**Comandos:**

```bash
npm ci
npm run metrics:access-aggregate -- --file ./ruta/a/logs.ndjson
# o bien
cat logs.ndjson | npm run metrics:access-aggregate
```

**Pruebas automatizadas:** `npm run test:access-aggregate` (fixtures en `scripts/fixtures/`).

### 2.2 Flujo operativo recomendado

1. Crear job Logpush **Workers trace events** hacia **R2** (o destino aprobado por seguridad), incluyendo el campo **`Logs`** (y los demás necesarios para correlación, p. ej. `ScriptName`, `EventTimestampMs`). Ejemplo de referencia en la documentación de Cloudflare: [Create a Logpush job](https://developers.cloudflare.com/workers/observability/logs/logpush/).
2. Habilitar Logpush en el Worker (`logpush = true` ya en repo) y desplegar.
3. Periódicamente (o vía pipeline de datos), **descargar** los objetos NDJSON del bucket y ejecutar el agregador, o bien encadenar el agregador en un job que lea desde stdin.
4. Guardar el JSON de salida en artefacto interno, BI o sistema de alertas (véase §3).

---

## 3. Alertas (opcional)

Los JSON agregados no sustituyen por sí solos una alerta; hace falta un **evaluador** que compare umbrales:

- **Interno:** cron + script que falle si `totals.duration_ms_p95` > umbral o `totals.http_5xx` / `totals.count` > ratio acordado.
- **Cloudflare:** notificaciones de cuenta sobre errores del Worker (complementarias a métricas por `operation`).
- **SIEM / observabilidad corporativa:** reglas sobre el NDJSON crudo o sobre métricas ya materializadas en vuestra plataforma.

LangSmith sigue cubriendo **calidad del grafo**; las alertas B2b son de **HTTP edge** (`ia_agent_access`), alineado con la separación descrita en B2.

---

## 4. CI en este repositorio

El workflow **`.github/workflows/b2b-access-metrics.yml`** ejecuta `npm run test:access-aggregate` y una corrida de demostración del CLI sobre fixtures en cada PR/push a `main`/`master`, y de forma **semanal** (recordatorio de que el agregador sigue verde).

---

## 5. Checklist de cierre (PAN-9)

- [x] **Decisión documentada:** §1 (Logpush `workers_trace_events` → almacén propio; motivos y retención).
- [x] **Implementación mínima verificable:** agregador CLI + tests + CI (§2 y §4).
- [x] **Documentación:** este documento y enlace desde la guía B2 (§2.4).
- [ ] **Trazabilidad GitHub:** enlazar el PR de `ia-agent-worker` desde el issue Linear al fusionar; PR espejo en `aaas-landing` solo si se actualiza allí el tablero espejo.

---

## 6. Referencias

- [Workers Logpush](https://developers.cloudflare.com/workers/observability/logs/logpush/)
- Dataset: [Workers Trace Events](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/workers_trace_events/)
- [Logpush genérico](https://developers.cloudflare.com/logs/logpush/)
- Tablero: [ROADMAP-IMPLEMENTATION.md](./ROADMAP-IMPLEMENTATION.md) (fila B2b)
