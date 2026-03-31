import { spawn } from "node:child_process";
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
    const child = spawn(
      config.claudeBin,
      ["-p", "-", "--output-format", "json", "--model", "claude-haiku-4-5-20251001"],
      { timeout: 120_000, stdio: ["pipe", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || `exit code ${code}`));
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed.result || stdout);
      } catch {
        resolve(stdout.trim());
      }
    });

    child.on("error", reject);
    child.stdin.write(prompt);
    child.stdin.end();
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

      const prompt = `You are an intelligence analyst using Structured Analytic Techniques to evaluate a Reddit post. Apply the following frameworks:

## ADMIRALTY CODE (NATO STANAG 2022)
Rate the SOURCE (A-F) and INFORMATION (1-6):
- Source: account age, karma, posting history, claimed credentials, motivation
- Information: internal consistency, corroboration from comments, physical plausibility

## CRITERIA-BASED CONTENT ANALYSIS (CBCA)
Authentic accounts show: unstructured messy narratives, admitted uncertainty ("I think", "I'm not sure"), spontaneous self-corrections, superfluous tangential details, unexpected complications ("my camera died", "my hands were shaking"), proportionate emotional response, acknowledgment of mundane explanations.
Fabricated accounts show: polished narrative arcs, absolute certainty, all details serving the central narrative, dramatic emotional language, conveniently perfect conditions, no alternative explanations considered, stock dramatic phrases, vague on verifiable specifics.

## DECEPTION INDICATORS
Linguistic red flags: excessive adverbs/superlatives, emotional over-signaling, too many first-person pronouns, absence of hedging language, no self-doubt.
Positive signals: precise numbers/times/locations, quoted conversations, physical measurements, hedging language, specific nouns over adjectives.

## SOURCE RELIABILITY
Negative: throwaway/new account, serial claimant with escalating stories, promotes external content (YouTube/podcast/book), defensive when questioned, cross-posts to many subreddits.
Positive: established account, first-time poster on topic, engages constructively with skeptics, shares verifiable details.

## ANALYSIS OF COMPETING HYPOTHESES
Consider ALL of these: (1) genuine experience (2) misidentification of mundane object (3) deliberate hoax/LARP (4) AI-generated content (5) karma farming/repost (6) astroturfing/promotion.

---

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
  "admiraltyRating": "B2" (source letter + info number),
  "cbcaScore": 0-19 (how many CBCA authenticity criteria are met),
  "competingHypothesis": "most likely alternative explanation",
  "reasoning": "2-3 sentence analysis citing specific framework evidence"
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
