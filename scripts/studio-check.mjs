/**
 * Comprueba que el Agent Server de LangGraph responde (ejecutar con `npm run studio` ya en marcha).
 * Uso: node scripts/studio-check.mjs [url]
 * Por defecto: http://127.0.0.1:2024/ok
 */
const url = process.argv[2] ?? "http://127.0.0.1:2024/ok";

const variants = [
  url,
  "http://127.0.0.1:2024/ok",
  "http://localhost:2024/ok",
  "http://[::1]:2024/ok",
];

async function tryOne(u) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 2500);
  try {
    const r = await fetch(u, { signal: ac.signal });
    const text = await r.text();
    return { u, ok: r.ok, status: r.status, text: text.slice(0, 200) };
  } catch (e) {
    return { u, ok: false, error: String(e?.cause?.message ?? e?.message ?? e) };
  } finally {
    clearTimeout(t);
  }
}

async function tryWithRetries(u, attempts = 5, delayMs = 600) {
  for (let i = 0; i < attempts; i++) {
    const r = await tryOne(u);
    if (r.ok) return r;
    if (i < attempts - 1) await new Promise((res) => setTimeout(res, delayMs));
  }
  return tryOne(u);
}

async function main() {
  console.log("Comprobando Agent Server LangGraph…\n");
  const primary = await tryWithRetries(url);
  if (primary.ok) {
    console.log(`OK  ${primary.u} → ${primary.status} ${primary.text}`);
    process.exit(0);
  }
  console.log(`FAIL ${primary.u}`);
  if (primary.error) console.log(`     ${primary.error}\n`);

  console.log("Probando otras URLs típicas en Windows…");
  for (const u of variants) {
    if (u === url) continue;
    const r = await tryOne(u);
    const line = r.ok ? `OK  ${r.u} → ${r.status}` : `FAIL ${r.u}${r.error ? ` (${r.error})` : ""}`;
    console.log(line);
    if (r.ok) {
      console.log("\nUsa esa URL como base en LangSmith Studio (sin el sufijo /ok).");
      process.exit(0);
    }
  }
  console.log(`
Ninguna URL respondió. Comprueba:
1. En otra terminal: npm run studio (deja el proceso corriendo).
2. Firewall de Windows: permitir Node.js en redes privadas.
3. Que el puerto 2024 no esté ocupado por otro programa.
4. Que exista .env en la raíz del repo con COPILOT_GITHUB_TOKEN (copia desde .env.example).
`);
  process.exit(1);
}

main();
