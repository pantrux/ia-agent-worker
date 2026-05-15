# Contrato de la API LangSmith (referencia para este repo)

Este documento condensa lo que publica LangSmith **sin depender de prueba y error**. Fuentes: [OpenAPI JSON](https://api.smith.langchain.com/openapi.json), [Create an account and API key](https://docs.langchain.com/langsmith/create-account-api-key) y el comportamiento del cliente JS `langsmith` instalado en el repo.

## Host por región (SaaS)

El `Host` por defecto en el OpenAPI es `https://api.smith.langchain.com`. Para otros despliegues regionales, la documentación oficial indica fijar **`LANGSMITH_ENDPOINT`** al hostname de la API de tu región (no mezclar UI `smith.langchain.com` con API `api.smith.langchain.com` sin el prefijo regional correcto).

| Región | API (variable `LANGSMITH_ENDPOINT`) |
|--------|-------------------------------------|
| GCP US (defecto SDK) | `https://api.smith.langchain.com` |
| GCP EU | `https://eu.api.smith.langchain.com` |
| GCP APAC | `https://apac.api.smith.langchain.com` |
| AWS US | `https://aws.api.smith.langchain.com` |

Si el workspace está en **EU** pero `LANGSMITH_ENDPOINT` apunta a **US**, las peticiones autenticadas suelen responder **403 Forbidden** aunque la clave sea válida en la otra región.

## Autenticación (cabeceras)

Según el OpenAPI (`components.securitySchemes`):

| Cabecera | Nombre en el spec | Uso |
|----------|-------------------|-----|
| Clave de API | **`X-Api-Key`** | Obligatoria para operaciones con datos (datasets, runs, etc.). |
| Workspace (tenant) | **`X-Tenant-Id`** | UUID del **workspace**. El SDK JS lo rellena desde `LANGSMITH_WORKSPACE_ID` / `LANGCHAIN_WORKSPACE_ID`. |
| Organización | **`X-Organization-Id`** | APIs con ámbito de organización (menos habitual en scripts de dataset). |
| Bearer | **`Authorization: Bearer …`** | Pensado para flujos tipo UI; el spec indica que a menudo va junto con `x-tenant-id` u `x-organization-id`. |

La documentación de LangSmith indica que **`LANGSMITH_WORKSPACE_ID` es necesario si la API key está asociada a más de un workspace**. Una **service key** “con acceso a todos los workspaces” sigue siendo una clave **multi-workspace**: en la práctica conviene **definir siempre** el `X-Tenant-Id` del workspace donde deben crearse datasets y experimentos.

**Importante:** el UUID debe ser el **Workspace ID** que muestra LangSmith en **Settings → General**, no el nombre ni el ID interno de un **proyecto** de trazas (`LANGSMITH_PROJECT`).

## Rutas relevantes para B3

En el OpenAPI, los datasets viven bajo el prefijo **`/api/v1`**:

- `GET /api/v1/datasets` — listar / localizar por nombre.
- `POST /api/v1/datasets` — crear dataset.
- Operaciones sobre ejemplos: bajo `/api/v1/examples` y rutas de upload asociadas a `dataset_id`.

El SDK JavaScript (`langsmith`) construye muchas URLs como **`${LANGSMITH_ENDPOINT}/datasets`** (sin el segmento `api/v1` en el path). El servicio en `api.smith.langchain.com` acepta ese alias; el contrato canónico en Redoc/OpenAPI es **`/api/v1/...`**. Para diagnósticos manuales (curl, preflight) usar **`/api/v1/...`** evita dudas.

## Comprobación sin adivinar

Tras configurar `LANGSMITH_API_KEY` y, si aplica, `LANGSMITH_ENDPOINT` + `LANGSMITH_WORKSPACE_ID`:

```bash
npm run langsmith:api-preflight
```

El script:

1. Llama a **`GET /api/v1/info`** (sin clave) para confirmar conectividad con el host elegido.
2. Llama a **`GET /api/v1/datasets?limit=1`** con **`X-Api-Key`** y, si existe, **`X-Tenant-Id`**.
3. Si falla, imprime **cabeceras de diagnóstico** (p. ej. `x-request-id`, `cf-ray`), **desglosa el cuerpo JSON** cuando sea un objeto, y hace **sondeo** de **`GET /api/v1/workspaces`** y **`GET /api/v1/orgs/current`** con las mismas cabeceras para distinguir “clave sin permisos global” frente a “solo datasets bloqueados”, y para **validar que `LANGSMITH_WORKSPACE_ID` aparece** en la lista de workspaces visibles para esa clave.

Si el paso 2 devuelve **403**, el problema no está en el Worker ni en el script de sync: revisa **región**, **UUID de workspace** y **permisos / rol de la service key** sobre datasets en ese workspace (consulta la administración de LangSmith, no solo “la clave existe”). Si el cuerpo es solo `{"detail":"Forbidden"}`, adjunta al soporte las cabeceras `x-request-id` / `cf-ray` que imprime el preflight.

## Referencias

- Redoc (navegable): `https://api.smith.langchain.com/redoc`
- OpenAPI (máquina): `https://api.smith.langchain.com/openapi.json`
- Claves y variables: [Create an account and API key](https://docs.langchain.com/langsmith/create-account-api-key)
