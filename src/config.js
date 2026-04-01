import "dotenv/config";

export const config = {
  mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017/nerd",
  subreddits: (process.env.SUBREDDITS || "technology").split(",").map((s) => s.trim()),
  keywords: process.env.KEYWORDS
    ? process.env.KEYWORDS.split(",").map((k) => k.trim().toLowerCase())
    : [],
  cronPosts: process.env.CRON_POSTS || "*/5 * * * *",
  cronComments: process.env.CRON_COMMENTS || "*/7 * * * *",
  cronEvaluate: process.env.CRON_EVALUATE || "*/10 * * * *",
  postsLimit: parseInt(process.env.POSTS_LIMIT || "25", 10),
  llmBaseUrl: process.env.LLM_BASE_URL || "https://ollama.com/v1",
  llmApiKey: process.env.LLM_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "qwen3.5",
  llmFallbackBaseUrl: process.env.LLM_FALLBACK_BASE_URL || "",
  llmFallbackApiKey: process.env.LLM_FALLBACK_API_KEY || "",
  llmFallbackModel: process.env.LLM_FALLBACK_MODEL || "",
  visionBaseUrl: process.env.VISION_BASE_URL || "",
  visionApiKey: process.env.VISION_API_KEY || "",
  visionModel: process.env.VISION_MODEL || "",
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  baseUrl: process.env.BASE_URL || "https://nerd.directory",
};
