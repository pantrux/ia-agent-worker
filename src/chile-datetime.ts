/** Zona horaria operativa del producto (Chile continental). */
export const CHILE_TIMEZONE = "America/Santiago";

/** Fecha y hora legibles en es-CL para inyectar en el system prompt del agente. */
export function formatChileDateTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: CHILE_TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now);
}
