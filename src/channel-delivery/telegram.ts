const TELEGRAM_TEXT_MAX = 4096;

export async function sendTelegramMessage(
  env: { TELEGRAM_BOT_TOKEN?: string },
  chatId: string,
  text: string
): Promise<void> {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN not configured");
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, TELEGRAM_TEXT_MAX),
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${errText.slice(0, 500)}`);
  }
}
