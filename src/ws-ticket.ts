/** Ticket HMAC para upgrade WebSocket (PAN-19). Compartido con Pages BFF. */

export interface WsTicketPayload {
  sid: string;
  uid?: string;
  exp: number;
}

const TICKET_TTL_SEC = 60;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? padded : padded + "=".repeat(4 - (padded.length % 4));
  const binary = atob(pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return base64UrlEncode(new Uint8Array(sig));
}

async function hmacVerify(secret: string, data: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(secret, data);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export function wsTicketTtlSeconds(): number {
  return TICKET_TTL_SEC;
}

/** Emite ticket `payload.signature` (base64url). */
export async function signWsTicket(
  secret: string,
  params: { sessionId: string; userId?: string; nowSec?: number }
): Promise<string> {
  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  const payload: WsTicketPayload = {
    sid: params.sessionId,
    exp: now + TICKET_TTL_SEC,
  };
  if (params.userId) payload.uid = params.userId;
  const enc = new TextEncoder();
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await hmacSign(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifyWsTicket(
  secret: string | undefined,
  ticket: string | null | undefined
): Promise<WsTicketPayload | null> {
  const sec = secret?.trim();
  if (!sec || !ticket?.trim()) return null;
  const parts = ticket.trim().split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts as [string, string];
  if (!(await hmacVerify(sec, payloadB64, sig))) return null;
  let payload: WsTicketPayload;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payloadB64));
    payload = JSON.parse(json) as WsTicketPayload;
  } catch {
    return null;
  }
  if (!payload.sid || typeof payload.exp !== "number") return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;
  return payload;
}
