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

const SYSTEM_MSG = "You are an intelligence analyst. Always respond with valid JSON only, no markdown fences or explanation.";

async function callOpenAI(baseUrl, apiKey, model, prompt) {
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_MSG },
      { role: "user", content: prompt },
    ],
    temperature: 0.6,
    chat_template_kwargs: { enable_thinking: false },
  };
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${baseUrl} ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  return msg?.content || msg?.reasoning || JSON.stringify(data);
}

async function runLLM(prompt) {
  try {
    const content = await callOpenAI(config.llmBaseUrl, config.llmApiKey, config.llmModel, prompt);
    return { content, model: config.llmModel };
  } catch (err) {
    if (!config.llmFallbackBaseUrl) throw err;
    console.warn(`[evaluate] primary LLM failed (${err.message}), falling back to ${config.llmFallbackModel}`);
    const content = await callOpenAI(config.llmFallbackBaseUrl, config.llmFallbackApiKey, config.llmFallbackModel, prompt);
    return { content, model: config.llmFallbackModel };
  }
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

IMPORTANT: You MUST always respond with ONLY a JSON object, no matter how limited the data. Never refuse. If data is limited, use lower confidence. Work with what you have.

Respond with a JSON object (no markdown fences, no explanation, ONLY JSON):
{
  "verdict": "real" | "suspicious" | "likely_fake",
  "confidence": 0.0-1.0,
  "admiraltyRating": "F6" (source letter A-F + info number 1-6),
  "cbcaScore": 0-19,
  "competingHypothesis": "most likely alternative explanation",
  "reasoning": "2-3 sentence analysis"
}`;

      console.log(`[evaluate] analyzing ${post.redditId}: "${post.title.slice(0, 60)}..."`);
      const { content: raw, model: usedModel } = await runLLM(prompt);

      let evaluation;
      try {
        const cleaned = typeof raw === "string" ? extractJson(raw) : raw;
        evaluation = typeof cleaned === "string" ? JSON.parse(cleaned) : cleaned;
      } catch {
        evaluation = { verdict: "error", confidence: 0, reasoning: raw };
      }

      // If error or 0 confidence, reschedule — don't mark as evaluated
      if (evaluation.verdict === "error" || evaluation.confidence === 0) {
        console.log(`[evaluate] ${post.redditId}: skipped (${evaluation.verdict}), will retry later`);
        continue;
      }

      await posts().updateOne(
        { _id: post._id },
        { $set: { evaluated: true, evaluation, evaluatedAt: new Date(), evaluatedBy: usedModel, needsReeval: false } }
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
