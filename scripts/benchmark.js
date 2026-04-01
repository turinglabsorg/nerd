import "dotenv/config";
import { MongoClient } from "mongodb";

const SYSTEM_MSG = "You are an intelligence analyst. Always respond with valid JSON only, no markdown fences or explanation.";

const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
const NVIDIA_KEY = process.env.LLM_API_KEY;
const OLLAMA_BASE = process.env.LLM_FALLBACK_BASE_URL || "https://ollama.com/v1";
const OLLAMA_KEY = process.env.LLM_FALLBACK_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const providers = [
  // Anthropic (reference)
  { name: "Claude Haiku 3.5", baseUrl: "anthropic", apiKey: ANTHROPIC_KEY, model: "claude-haiku-4-5-20251001" },
  // Ollama Cloud — powerful models
  { name: "Ollama DeepSeek V3.2", baseUrl: OLLAMA_BASE, apiKey: OLLAMA_KEY, model: "deepseek-v3.2" },
  { name: "Ollama Qwen 3.5 397B", baseUrl: OLLAMA_BASE, apiKey: OLLAMA_KEY, model: "qwen3.5:397b" },
  { name: "Ollama Mistral Large 3 675B", baseUrl: OLLAMA_BASE, apiKey: OLLAMA_KEY, model: "mistral-large-3:675b" },
  { name: "Ollama Cogito 2.1 671B", baseUrl: OLLAMA_BASE, apiKey: OLLAMA_KEY, model: "cogito-2.1:671b" },
  { name: "Ollama Kimi K2 1T", baseUrl: OLLAMA_BASE, apiKey: OLLAMA_KEY, model: "kimi-k2:1t" },
  { name: "Ollama Qwen 3.5 (small)", baseUrl: OLLAMA_BASE, apiKey: OLLAMA_KEY, model: "qwen3.5" },
  // NVIDIA
  { name: "NVIDIA Nemotron Super 49B", baseUrl: NVIDIA_BASE, apiKey: NVIDIA_KEY, model: "nvidia/llama-3.3-nemotron-super-49b-v1" },
  { name: "NVIDIA Nemotron Ultra 253B", baseUrl: NVIDIA_BASE, apiKey: NVIDIA_KEY, model: "nvidia/llama-3.1-nemotron-ultra-253b-v1" },
];

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1];
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

function validateEval(parsed) {
  const validVerdicts = ["real", "suspicious", "likely_fake"];
  const issues = [];
  if (!validVerdicts.includes(parsed.verdict)) issues.push(`bad verdict: "${parsed.verdict}"`);
  if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) issues.push(`bad confidence: ${parsed.confidence}`);
  if (typeof parsed.admiraltyRating !== "string" || !/^[A-F][1-6]$/.test(parsed.admiraltyRating)) issues.push(`bad admiraltyRating: "${parsed.admiraltyRating}"`);
  if (typeof parsed.cbcaScore !== "number" || parsed.cbcaScore < 0 || parsed.cbcaScore > 19) issues.push(`bad cbcaScore: ${parsed.cbcaScore}`);
  if (typeof parsed.reasoning !== "string" || parsed.reasoning.length < 20) issues.push("reasoning too short or missing");
  if (typeof parsed.competingHypothesis !== "string") issues.push("missing competingHypothesis");
  return issues;
}

async function callAnthropic(provider, prompt) {
  const start = performance.now();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 4096,
        system: SYSTEM_MSG,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    if (!res.ok) {
      const body = await res.text();
      return { error: `HTTP ${res.status}: ${body.slice(0, 300)}`, elapsed };
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text || JSON.stringify(data);
    const usage = { prompt_tokens: data.usage?.input_tokens, completion_tokens: data.usage?.output_tokens };
    const finishReason = data.stop_reason || "unknown";

    let parsed, parseOk = true;
    try { parsed = JSON.parse(extractJson(raw)); } catch { parsed = null; parseOk = false; }
    const validation = parseOk && parsed ? validateEval(parsed) : ["JSON parse failed"];
    return { parsed, elapsed, usage, finishReason, validation, parseOk, raw };
  } catch (err) {
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    return { error: err.message, elapsed };
  }
}

async function callProvider(provider, prompt) {
  if (provider.baseUrl === "anthropic") return callAnthropic(provider, prompt);

  const start = performance.now();
  try {
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
      return { error: `HTTP ${res.status}: ${body.slice(0, 300)}`, elapsed };
    }

    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    const raw = msg?.content || msg?.reasoning || JSON.stringify(data);
    const usage = data.usage || {};
    const finishReason = data.choices?.[0]?.finish_reason || "unknown";

    let parsed;
    let parseOk = true;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch {
      parsed = null;
      parseOk = false;
    }

    const validation = parseOk && parsed ? validateEval(parsed) : ["JSON parse failed"];

    return { parsed, elapsed, usage, finishReason, validation, parseOk, raw };
  } catch (err) {
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    return { error: err.message, elapsed };
  }
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

  const prompt = buildPrompt(post, comments);

  console.log("\n" + "=".repeat(80));
  console.log("\n## FULL PROMPT SENT TO ALL MODELS:\n");
  console.log(prompt);
  console.log("\n" + "=".repeat(80) + "\n");
  const results = [];

  for (const provider of providers) {
    if (!provider.baseUrl || !provider.apiKey) {
      console.log(`SKIP: ${provider.name} — not configured\n`);
      continue;
    }

    console.log(`Testing: ${provider.name} (${provider.model})`);
    console.log("-".repeat(60));

    const result = await callProvider(provider, prompt);

    if (result.error) {
      console.log(`  ERROR: ${result.error}`);
      console.log(`  Time: ${result.elapsed}s`);
      results.push({ name: provider.name, model: provider.model, error: result.error, elapsed: result.elapsed });
    } else {
      const tokIn = result.usage.prompt_tokens || "?";
      const tokOut = result.usage.completion_tokens || "?";
      console.log(`  Time: ${result.elapsed}s | Tokens: ${tokIn} in / ${tokOut} out | Finish: ${result.finishReason}`);
      console.log(`  JSON valid: ${result.parseOk} | Schema issues: ${result.validation.length === 0 ? "none" : result.validation.join(", ")}`);
      if (result.parsed) {
        console.log(`  Verdict: ${result.parsed.verdict} (${result.parsed.confidence})`);
        console.log(`  Admiralty: ${result.parsed.admiraltyRating} | CBCA: ${result.parsed.cbcaScore}`);
        console.log(`  Hypothesis: ${result.parsed.competingHypothesis}`);
        console.log(`  Reasoning: ${result.parsed.reasoning}`);
      console.log(`  Competing: ${result.parsed.competingHypothesis}`);
      }
      if (!result.parseOk || result.validation.length > 0) {
        console.log(`  RAW OUTPUT:\n${result.raw?.slice(0, 500)}`);
      }
      results.push({
        name: provider.name,
        model: provider.model,
        elapsed: result.elapsed,
        tokensIn: tokIn,
        tokensOut: tokOut,
        finishReason: result.finishReason,
        jsonValid: result.parseOk,
        schemaIssues: result.validation.length,
        verdict: result.parsed?.verdict,
        confidence: result.parsed?.confidence,
        admiralty: result.parsed?.admiraltyRating,
        cbca: result.parsed?.cbcaScore,
        hypothesis: result.parsed?.competingHypothesis,
      });
    }

    console.log("\n" + "=".repeat(80) + "\n");
  }

  // Summary table
  console.log("\n## SUMMARY\n");
  console.log("| Model | Time | Tok Out | JSON | Schema | Verdict | Conf | Admiralty | CBCA |");
  console.log("|-------|------|---------|------|--------|---------|------|----------|------|");
  for (const r of results) {
    if (r.error) {
      console.log(`| ${r.name} | ${r.elapsed}s | - | ERROR | - | - | - | - | - |`);
    } else {
      console.log(`| ${r.name} | ${r.elapsed}s | ${r.tokensOut} | ${r.jsonValid ? "Y" : "N"} | ${r.schemaIssues} | ${r.verdict || "-"} | ${r.confidence ?? "-"} | ${r.admiralty || "-"} | ${r.cbca ?? "-"} |`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
