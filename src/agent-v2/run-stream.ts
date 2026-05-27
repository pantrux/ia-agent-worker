import type { Env } from "../env.js";
import type { InboundMessageV2 } from "../canonical/index.js";
import { corsHeaders } from "../cors.js";
import {
  isGraphInterruptError,
  runChatMessageGraph
} from "../chat-invocation.js";
import {
  buildOutboundFromGraphError,
  buildOutboundFromGraphInterrupt,
  buildOutboundFromGraphSuccess
} from "./outbound.js";
import { wsStreamPauseMs } from "../ws-stream-pace.js";

const textEncoder = new TextEncoder();

function ndjsonLine(data: unknown): Uint8Array {
  return textEncoder.encode(`${JSON.stringify(data)}\n`);
}

/**
 * Ejecuta el grafo emitiendo deltas NDJSON (25 ms entre trozos) para omni-channel egress.
 */
export async function runAgentV2StreamResponse(
  request: Request,
  env: Env,
  inbound: InboundMessageV2
): Promise<Response> {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const result = await runChatMessageGraph(env, {
          text: inbound.text,
          threadId: inbound.conversation_id,
          channel: inbound.channel,
          userId: inbound.user.id,
          operation: "v2_run",
          onTokenDelta: async (delta) => {
            if (!delta) return;
            controller.enqueue(ndjsonLine({ event: "delta", delta }));
            await wsStreamPauseMs();
          }
        });
        const outbound = buildOutboundFromGraphSuccess(inbound, result);
        controller.enqueue(ndjsonLine({ event: "complete", outbound }));
      } catch (error) {
        if (isGraphInterruptError(error)) {
          try {
            const outbound = buildOutboundFromGraphInterrupt(
              inbound,
              (error as { value?: unknown }).value
            );
            controller.enqueue(ndjsonLine({ event: "complete", outbound }));
          } catch (mappingError) {
            controller.enqueue(
              ndjsonLine({
                event: "complete",
                outbound: buildOutboundFromGraphError(inbound, mappingError, "v2_run")
              })
            );
          }
        } else {
          console.error("[v2/agent/run] graph stream error:", error);
          controller.enqueue(
            ndjsonLine({
              event: "complete",
              outbound: buildOutboundFromGraphError(inbound, error, "v2_run")
            })
          );
        }
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      ...corsHeaders(request, env)
    }
  });
}
