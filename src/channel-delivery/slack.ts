const SLACK_TEXT_MAX = 4000;

type SlackApiResponse = { ok: boolean; error?: string };

export async function sendSlackMessage(
  env: { SLACK_BOT_TOKEN?: string },
  channelId: string,
  text: string
): Promise<void> {
  const token = (env.SLACK_BOT_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN not configured");
  }

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: channelId,
      text: text.slice(0, SLACK_TEXT_MAX),
    }),
  });

  const raw = await res.text();
  let body: SlackApiResponse = { ok: false };
  try {
    body = JSON.parse(raw) as SlackApiResponse;
  } catch {
    throw new Error(`Slack chat.postMessage failed: ${res.status} ${raw.slice(0, 500)}`);
  }

  if (!res.ok || !body.ok) {
    throw new Error(
      `Slack chat.postMessage failed: ${res.status} ${(body.error ?? raw).slice(0, 500)}`
    );
  }
}
