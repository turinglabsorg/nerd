import { execFile } from "node:child_process";
import { posts, comments } from "./db.js";
import { config } from "./config.js";
import { sendTelegram, formatEvaluation } from "./telegram.js";

function extractJson(text) {
  // Strip markdown fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1];
  // Find first { ... } block
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    execFile(
      config.claudeBin,
      ["-p", prompt, "--output-format", "json", "--model", "claude-haiku-4-5-20251001"],
      { timeout: 120_000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(err);
        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed.result || stdout);
        } catch {
          resolve(stdout.trim());
        }
      }
    );
  });
}

export async function evaluatePosts() {
  // Grab all unevaluated posts + posts that got new comments since last evaluation
  const pending = await posts()
    .find({
      $or: [
        { evaluated: false },
        { evaluated: true, needsReeval: true },
      ],
    })
    .sort({ insertedAt: -1 })
    .limit(1)
    .toArray();

  if (pending.length === 0) {
    console.log("[evaluate] no pending posts");
    return 0;
  }

  const reeval = pending.filter((p) => p.needsReeval).length;
  if (reeval > 0) console.log(`[evaluate] ${reeval} posts queued for re-evaluation (new comments)`);

  let evaluated = 0;

  for (const post of pending) {
    try {
      // Grab top comments for context
      const topComments = await comments()
        .find({ postRedditId: post.redditId })
        .sort({ score: -1 })
        .limit(10)
        .toArray();

      const commentBlock = topComments.length > 0
        ? topComments.map((c) => `- u/${c.author} (${c.score}pts): ${c.body}`).join("\n")
        : "(no comments fetched yet)";

      const prompt = `You are an analyst evaluating Reddit posts for authenticity.

Analyze this Reddit post and determine if it appears to be a genuine/organic post or if it shows signs of being:
- AI-generated or bot-posted
- Astroturfing / corporate shilling
- Karma farming / repost bot
- Spam or low-effort manipulation

POST:
- Subreddit: r/${post.subreddit}
- Title: ${post.title}
- Author: u/${post.author}
- Score: ${post.score}
- Body: ${post.selftext || "(link post, no body)"}

TOP COMMENTS:
${commentBlock}

Respond with a JSON object (no markdown fences):
{
  "verdict": "real" | "suspicious" | "likely_fake",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

      console.log(`[evaluate] analyzing ${post.redditId}: "${post.title.slice(0, 60)}..."`);
      const raw = await runClaude(prompt);

      let evaluation;
      try {
        const cleaned = typeof raw === "string" ? extractJson(raw) : raw;
        evaluation = typeof cleaned === "string" ? JSON.parse(cleaned) : cleaned;
      } catch {
        evaluation = { verdict: "error", confidence: 0, reasoning: raw };
      }

      await posts().updateOne(
        { _id: post._id },
        { $set: { evaluated: true, evaluation, evaluatedAt: new Date(), needsReeval: false } }
      );

      console.log(`[evaluate] ${post.redditId}: ${evaluation.verdict} (${evaluation.confidence})`);
      await sendTelegram(formatEvaluation(post, evaluation));
      evaluated++;

      // Rate limit between evaluations
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      console.error(`[evaluate] ${post.redditId} error:`, err.message);
    }
  }

  return evaluated;
}
