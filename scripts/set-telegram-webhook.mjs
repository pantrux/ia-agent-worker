import fs from "node:fs";

function parse(path) {
  const o = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) o[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return o;
}

const w = parse(new URL("../.env", import.meta.url));
const l = parse(new URL("../../aaas-landing/.env", import.meta.url));
const token = w.TELEGRAM_BOT_TOKEN;
const url = l.TELEGRAM_WEBHOOK_URL;
const secret = l.TELEGRAM_WEBHOOK_SECRET;

if (!token || !url || !secret) {
  console.error("missing config");
  process.exit(1);
}

const base = `https://api.telegram.org/bot${token}`;
const setRes = await fetch(`${base}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true }),
});
const setBody = await setRes.json();
console.log("setWebhook:", setBody.ok, setBody.description ?? JSON.stringify(setBody));

const info = await (await fetch(`${base}/getWebhookInfo`)).json();
console.log("info:", JSON.stringify(info.result, null, 2));
if (!setBody.ok) process.exit(1);
