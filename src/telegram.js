import { config } from "./config.js";

export async function sendTelegram(text) {
  if (!config.telegramToken || !config.telegramChatId) return;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegramToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.telegramChatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }
    );

    if (!res.ok) {
      console.error("[telegram] send failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[telegram] error:", err.message);
  }
}

export function formatEvaluation(post, evaluation) {
  const icon =
    evaluation.verdict === "real" ? "\u2705" :
    evaluation.verdict === "suspicious" ? "\u26a0\ufe0f" :
    evaluation.verdict === "likely_fake" ? "\ud83d\udea9" : "\u2753";

  return [
    `${icon} <b>${evaluation.verdict.toUpperCase()}</b> (${evaluation.confidence})`,
    ``,
    `<b>${escapeHtml(post.title)}</b>`,
    `r/${post.subreddit} \u2022 u/${post.author} \u2022 ${post.score}pts`,
    ``,
    `<i>${escapeHtml(evaluation.reasoning)}</i>`,
    ``,
    `<a href="${config.baseUrl}/p/${post.redditId}">View on NERD</a> | <a href="${post.permalink}">Reddit</a>`,
  ].join("\n");
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
