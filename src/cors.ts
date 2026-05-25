// PAN-25: lógica CORS aislada para endurecimiento y testabilidad.
//
// Cambios respecto a la versión inline previa:
//   - El literal "*" en `ALLOWED_ORIGINS` se ignora explícitamente.
//     Antes, si la lista contenía "*", el Worker reflejaba cualquier `Origin`
//     entrante y emitía `Access-Control-Allow-Origin: *` por defecto. Eso
//     permitía CORS desde cualquier sitio de internet, lo que en producción
//     se considera un hallazgo de Fase A (ver `docs/A1-checklist-waf.md`).
//   - Si la lista solo tiene un origen explícito y la petición no envía
//     `Origin` (caller server-to-server), se devuelve ese único origen para
//     mantener compatibilidad con flujos previos.
//   - Cualquier `Origin` no presente en la allowlist se rechaza: la respuesta
//     no lleva la cabecera `Access-Control-Allow-Origin`, por lo que el
//     navegador bloquea la lectura cross-origin.

export interface CorsEnv {
  ALLOWED_ORIGINS?: string;
}

/**
 * Convierte la cadena `ALLOWED_ORIGINS` (lista separada por comas) en un
 * array depurado: sin espacios, sin entradas vacías y sin el comodín `*`.
 *
 * Mantener el comodín fuera de la allowlist es la garantía de PAN-25:
 * aunque alguien lo reintroduzca por error en `wrangler.toml`, el código
 * no volverá a habilitar CORS abierto.
 */
export function buildAllowList(raw: string | undefined): string[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "*");
}

/**
 * Devuelve el valor que debe ir en `Access-Control-Allow-Origin` o `""`
 * cuando el origen no está autorizado (en cuyo caso el caller no añade la
 * cabecera y el navegador bloquea la respuesta cross-origin).
 */
export function resolveAllowOrigin(
  requestOrigin: string,
  allowList: readonly string[]
): string {
  if (requestOrigin && allowList.includes(requestOrigin)) {
    return requestOrigin;
  }
  if (!requestOrigin && allowList.length === 1) {
    return allowList[0]!;
  }
  return "";
}

/**
 * Construye las cabeceras CORS para una request del Worker. Si el origen no
 * está autorizado, omite `Access-Control-Allow-Origin` y `Vary` para que el
 * navegador rechace la lectura cross-origin sin filtrar la lista permitida.
 */
export function corsHeaders(request: Request, env: CorsEnv): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowList = buildAllowList(env.ALLOWED_ORIGINS);
  const allowOrigin = resolveAllowOrigin(origin, allowList);

  // `Vary: Origin` siempre, autorizado o no: una caché o proxy intermedio podría
  // guardar la respuesta sin `Access-Control-Allow-Origin` y reutilizarla luego
  // ante una petición legítima desde un origen permitido. Recomendación MDN /
  // CORS spec.
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-AAAS-User-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowOrigin) {
    h["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return h;
}
