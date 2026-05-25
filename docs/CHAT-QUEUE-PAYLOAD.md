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
| `delivery` | objeto opcional | Si está presente, el consumer envía la respuesta del grafo al canal externo (PAN-18). |

### `delivery` (PAN-18)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `delivery.kind` | `"telegram"` \| `"slack"` | Adaptador de entrega. |
| `delivery.chat_id` | string | Solo Telegram: `message.chat.id`. |
| `delivery.update_id` | string | Solo Telegram: `update_id` del Update (slot KV pending). |
| `delivery.channel_id` | string | Solo Slack: `event.channel`. |
| `delivery.event_id` | string | Solo Slack: `event_id` del envelope `event_callback` (slot KV pending). |

Continuidad de hilo (KV `CHAT_THREAD_KV`, TTL 90 días, renovable):

- Telegram: `telegram:chat:{chat_id}` → `thread_id`
- Slack: `slack:channel:{channel_id}` → `thread_id`

Pending de entrega (TTL 24 h; si la API del canal falla tras grafo OK, el **reintento de cola solo reenvía** el pending sin re-invoke):

- Telegram: `telegram:pending:{chat_id}:{update_id}`
- Slack: `slack:pending:{channel_id}:{event_id}`

`clear` del pending es best-effort tras ack para no duplicar mensajes si KV.delete falla.

Preview: namespace KV `CHAT_THREAD_KV_preview` (aislado de prod).

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

En `wrangler.toml`, **`max_batch_size = 1`**: cada mensaje ejecuta el grafo completo (LLM + D1); lotes mayores arriesgan timeout de CPU en la invocación del consumer.

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

## Telegram (PAN-18)

- Webhook BFF: `POST /api/webhooks/telegram` en **aaas-landing** (Pages).
- Secreto Pages `TELEGRAM_WEBHOOK_SECRET` ↔ cabecera `X-Telegram-Bot-Api-Secret-Token`.
- Secreto Worker `TELEGRAM_BOT_TOKEN` para `sendMessage` tras el consumer.
- Runbook: [`PAN-18-c2-channel-webhooks-design.md`](https://github.com/pantrux/aaas-landing/blob/main/docs/PAN-18-c2-channel-webhooks-design.md).

## Slack (PAN-37)

- Webhook BFF: `POST /api/webhooks/slack` en **aaas-landing** (Pages).
- Secreto Pages `SLACK_SIGNING_SECRET` ↔ firma `X-Slack-Signature` + timestamp `X-Slack-Request-Timestamp`.
- Secreto Worker `SLACK_BOT_TOKEN` (`xoxb-…`) para `chat.postMessage` tras el consumer.
- Runbook: [`PAN-37-c2-slack-webhooks-design.md`](https://github.com/pantrux/aaas-landing/blob/main/docs/PAN-37-c2-slack-webhooks-design.md).

## Alcance fuera de PAN-17 / PAN-18 / PAN-37 v1

- Microsoft Teams (mismo patrón `delivery`, issue posterior).
- Reanudación HITL vía cola: no soportada; usar `/api/chat/resume`.
