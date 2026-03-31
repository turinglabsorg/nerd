import "dotenv/config";
import { MongoClient } from "mongodb";

const SYSTEM_MSG = "You are an intelligence analyst. Always respond with valid JSON only, no markdown fences or explanation.";

const providers = [
  {
    name: "Ollama Cloud (qwen3.5)",
    baseUrl: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
  },
  {
    name: "NVIDIA Nemotron 3",
    baseUrl: process.env.LLM_FALLBACK_BASE_URL,
    apiKey: process.env.LLM_FALLBACK_API_KEY,
    model: process.env.LLM_FALLBACK_MODEL,
  },
];

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1];
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

async function callProvider(provider, prompt) {
  const start = performance.now();
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: SYSTEM_MSG },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const elapsed = ((performance.now() - start) / 1000).toFixed(2);

  if (!res.ok) {
    const body = await res.text();
    return { error: `HTTP ${res.status}: ${body.slice(0, 200)}`, elapsed };
  }

  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  const raw = msg?.content || msg?.reasoning || JSON.stringify(data);
  const usage = data.usage || {};

  let parsed;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    parsed = { parseError: true, raw: raw.slice(0, 500) };
  }

  return { parsed, elapsed, usage, raw };
}

async function getLatestPost() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();

  const post = await db.collection("posts").findOne(
    { evaluated: true },
    { sort: { evaluatedAt: -1 } }
  );

  const comments = await db.collection("comments")
    .find({ postRedditId: post.redditId })
    .sort({ score: -1 })
    .limit(10)
    .toArray();

  await client.close();
  return { post, comments };
}

function buildPrompt(post, comments) {
  const commentBlock = comments.length > 0
    ? comments.map((c) => `- u/${c.author} (${c.score}pts): ${c.body}`).join("\n")
    : "(no comments fetched yet)";

  return `You are an intelligence analyst using Structured Analytic Techniques to evaluate a Reddit post. Apply the following frameworks:

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
}

async function main() {
  console.log("Fetching latest evaluated post from DB...\n");
  const { post, comments } = await getLatestPost();

  console.log(`POST: r/${post.subreddit} — "${post.title}"`);
  console.log(`Author: u/${post.author} | Score: ${post.score}`);
  console.log(`Previous eval: ${post.evaluation?.verdict} (${post.evaluation?.confidence})`);
  console.log(`Comments: ${comments.length}`);
  console.log("\n" + "=".repeat(70) + "\n");

  const prompt = buildPrompt(post, comments);

  for (const provider of providers) {
    if (!provider.baseUrl || !provider.apiKey) {
      console.log(`SKIP: ${provider.name} — not configured\n`);
      continue;
    }

    console.log(`Testing: ${provider.name} (${provider.model})`);
    console.log("-".repeat(50));

    const result = await callProvider(provider, prompt);

    if (result.error) {
      console.log(`ERROR: ${result.error}`);
    } else {
      console.log(`Time: ${result.elapsed}s`);
      if (result.usage.prompt_tokens) {
        console.log(`Tokens: ${result.usage.prompt_tokens} in / ${result.usage.completion_tokens} out`);
      }
      console.log(`Result:`);
      console.log(JSON.stringify(result.parsed, null, 2));
    }

    console.log("\n" + "=".repeat(70) + "\n");
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
