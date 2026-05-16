# Contrato de ingesta multicanal (PAN-17)

Mensajes hacia el agente pueden llegar por **HTTP síncrono** (`POST /api/chat`, canal `web` en metadata LangSmith) o por **Cloudflare Queue** tras validación en `POST /api/agent/messages`.

## Cuerpo normalizado

Todos los campos son obligatorios salvo `thread_hint`.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `channel` | string | Identificador del canal (p. ej. `web`, `slack`, `teams`). Máx. 64 caracteres. |
| `user_id` | string | Identificador del usuario en el canal (externo al Worker). Máx. 256 caracteres. |
| `text` | string | Texto del mensaje al agente. |
| `thread_hint` | string opcional | Si es un **UUID v4** válido, se usa como `thread_id` del grafo (checkpoint D1). En cualquier otro caso se ignora y se crea un **nuevo** `thread_id`. |

Ejemplo:

```json
{
  "channel": "slack",
  "user_id": "U0123456",
  "text": "Resume el pedido del cliente Acme",
  "thread_hint": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
}
```

## Endpoints

### `POST /api/agent/messages`

- Misma autenticación que `/api/chat`: si el Worker tiene `BFF_API_TOKEN`, cabecera `Authorization: Bearer …` obligatoria.
- Valida el cuerpo contra el esquema anterior y publica en la cola `CHAT_INGEST_QUEUE` (`contentType: json`).
- Respuesta **202**: `{ "accepted": true, "channel": "<channel>" }`.

### Consumer (mismo Worker)

Tras superar `max_retries`, los mensajes van a la **dead-letter queue** (`ia-agent-chat-queue-dlq` / `…-preview-dlq`) para inspección manual.

El handler `queue` del Worker consume la cola, invoca el grafo LangGraph con un único `HumanMessage` y:

- **Éxito:** `ack()` del mensaje.
- **Payload inválido:** `ack()` sin reintento (evita envenenamiento infinito).
- **`GraphInterrupt` (HITL):** `ack()` y log de advertencia: no hay canal de respuesta asíncrono en PAN-17; la reanudación sigue siendo **`POST /api/chat/resume`** por HTTP.
- **Otros errores:** `retry()` con backoff.

## LangSmith

En todas las invocaciones de chat (HTTP `web`, cola o resume HTTP) se envían al menos:

- `metadata.channel`
- `metadata.user_id`
- `metadata.thread_id`
- `metadata.operation` (`chat` | `queue_chat` | `resume`)
- Tag `channel:<valor>`

## Operaciones Cloudflare Queues

Creación de colas (una por entorno desplegado):

```bash
npm run ensure:chat-queues
# o manualmente (incluye DLQ para mensajes tras max_retries):
npx wrangler queues create ia-agent-chat-queue
npx wrangler queues create ia-agent-chat-queue-dlq
npx wrangler queues create ia-agent-chat-queue-preview
npx wrangler queues create ia-agent-chat-queue-preview-dlq
```

En **Workers Builds**, si el deploy de ramas usa solo `wrangler versions upload`, configura el comando a `npm run cf:versions-upload` para crear las colas automáticamente con el token del build (permiso Queues).

Coste y modelo de consumo: [Queues — Pricing](https://developers.cloudflare.com/queues/platform/pricing/) (operaciones por volumen de mensaje; reintentos suman lecturas).

## Alcance fuera de PAN-17

- Entrega de la respuesta del agente al usuario en canales asíncronos (Slack/Teams): PAN-18 y sucesivos.
- Reanudación HITL vía cola: no soportada; usar `/api/chat/resume`.
