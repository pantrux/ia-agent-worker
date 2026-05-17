export type ChatClientErrorCode = "rate_limited" | "provider_error" | "internal_error";

export function classifyChatGraphError(
  e: unknown,
  context: "chat" | "resume" = "chat"
): { code: ChatClientErrorCode; message: string } {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();

  if (
    /\b429\b/.test(lower) ||
    lower.includes("rate limited") ||
    lower.includes("quota exceeded") ||
    lower.includes("too many requests")
  ) {
    return {
      code: "rate_limited",
      message:
        "El modelo de IA está temporalmente saturado (límite de cuota o peticiones). Espera unos minutos e inténtalo de nuevo.",
    };
  }

  if (
    lower.includes("failed to get response from provider") ||
    lower.includes("copilot responses api failed")
  ) {
    return {
      code: "provider_error",
      message: "El proveedor de IA no respondió. Inténtalo de nuevo en unos minutos.",
    };
  }

  return {
    code: "internal_error",
    message: context === "resume" ? "Error al reanudar el grafo" : "Error al ejecutar el grafo",
  };
}
