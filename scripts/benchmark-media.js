import "dotenv/config";
import { MongoClient } from "mongodb";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const SYSTEM_MSG = "You are a visual forensic analyst. Always respond with valid JSON only, no markdown fences or explanation.";

// Always use Ollama Cloud for vision benchmarks
const OLLAMA_BASE = "https://ollama.com/v1";
const OLLAMA_KEY = process.env.LLM_API_KEY?.startsWith("43f") ? process.env.LLM_API_KEY
  : process.env.LLM_FALLBACK_API_KEY?.startsWith("43f") ? process.env.LLM_FALLBACK_API_KEY
  : process.env.LLM_API_KEY || process.env.LLM_FALLBACK_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const providers = [
  // Anthropic reference (if key available)
  ...(ANTHROPIC_KEY ? [{ name: "Claude Haiku 3.5", type: "anthropic", apiKey: ANTHROPIC_KEY, model: "claude-haiku-4-5-20251001" }] : []),
  // Ollama Cloud vision models
  { name: "Ollama Qwen3-VL 235B", type: "ollama", baseUrl: OLLAMA_BASE, apiKey: OLLAMA_KEY, model: "qwen3-vl:235b" },
  { name: "Ollama Qwen3-VL 235B Instruct", type: "ollama", baseUrl: OLLAMA_BASE, apiKey: OLLAMA_KEY, model: "qwen3-vl:235b-instruct" },
  { name: "Ollama Gemma3 27B", type: "ollama", baseUrl: OLLAMA_BASE, apiKey: OLLAMA_KEY, model: "gemma3:27b" },
  { name: "Ollama Gemma3 12B", type: "ollama", baseUrl: OLLAMA_BASE, apiKey: OLLAMA_KEY, model: "gemma3:12b" },
];

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1];
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

function validateMediaEval(parsed) {
  const validAuth = ["genuine", "edited", "cgi", "inconclusive"];
  const issues = [];
  if (!validAuth.includes(parsed.authenticity)) issues.push(`bad authenticity: "${parsed.authenticity}"`);
  if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) issues.push(`bad confidence: ${parsed.confidence}`);
  if (typeof parsed.description !== "string" || parsed.description.length < 10) issues.push("description too short");
  if (typeof parsed.reasoning !== "string" || parsed.reasoning.length < 10) issues.push("reasoning too short");
  return issues;
}

function buildPrompt(post) {
  return `Analyze this image from a Reddit post about UFOs/UAPs. Be objective and forensic.

POST CONTEXT:
- Subreddit: r/${post.subreddit}
- Title: ${post.title}

Analyze the image and provide:
1. What is in the image? Describe exactly what you see — objects, environment, sky, lighting, etc.
2. Does it look like a genuine unedited photo or does it show signs of manipulation (CGI, compositing, digital art, AI-generated)?
3. If there are identifiable objects, what are they most likely? (drone, balloon, plane, star, artifact, etc.)
4. Look for: compression artifacts, lighting inconsistencies, edge anomalies, perspective errors, metadata clues from the image itself.

Respond with a JSON object (no markdown fences):
{
  "description": "factual description of what you see",
  "authenticity": "genuine" | "edited" | "cgi" | "inconclusive",
  "identification": "what the object/content actually is",
  "confidence": 0.0-1.0,
  "forensicNotes": "any signs of editing, CGI, AI generation, or authenticity indicators",
  "reasoning": "brief explanation of your assessment"
}`;
}

async function callAnthropic(provider, prompt, imageBase64, mimeType) {
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
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
            { type: "text", text: prompt },
          ],
        }],
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

    let parsed, parseOk = true;
    try { parsed = JSON.parse(extractJson(raw)); } catch { parsed = null; parseOk = false; }
    const validation = parseOk && parsed ? validateMediaEval(parsed) : ["JSON parse failed"];
    return { parsed, elapsed, usage, validation, parseOk, raw };
  } catch (err) {
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    return { error: err.message, elapsed };
  }
}

async function callOllama(provider, prompt, imageBase64, mimeType) {
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
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
              { type: "text", text: prompt },
            ],
          },
        ],
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(180_000),
    });

    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    if (!res.ok) {
      const body = await res.text();
      return { error: `HTTP ${res.status}: ${body.slice(0, 300)}`, elapsed };
    }

    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    const raw = msg?.content || JSON.stringify(data);
    const usage = data.usage || {};

    let parsed, parseOk = true;
    try { parsed = JSON.parse(extractJson(raw)); } catch { parsed = null; parseOk = false; }
    const validation = parseOk && parsed ? validateMediaEval(parsed) : ["JSON parse failed"];
    return { parsed, elapsed, usage, validation, parseOk, raw };
  } catch (err) {
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    return { error: err.message, elapsed };
  }
}

async function getPostWithImage() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();

  // Find a post with an image URL that has been evaluated
  const post = await db.collection("posts").findOne(
    {
      evaluated: true,
      url: { $regex: /i\.redd\.it|imgur\.com|\.(jpg|jpeg|png|gif|webp)/i },
    },
    { sort: { score: -1 } }
  );

  await client.close();
  return post;
}

async function downloadImage(url) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "nerd-bench-"));
  const ext = url.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || "jpg";
  const outPath = path.join(tmpDir, `image.${ext}`);

  try {
    execSync(`curl -sL -o "${outPath}" -A "nerd-agent/1.0" "${url}"`, { timeout: 15000 });
    const data = await readFile(outPath);
    const mimeMap = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
    return { base64: data.toString("base64"), mimeType: mimeMap[ext] || "image/jpeg", tmpDir, size: data.length };
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
}

async function main() {
  console.log("Fetching post with image from DB...\n");
  const post = await getPostWithImage();

  if (!post) {
    console.log("No posts with images found!");
    process.exit(1);
  }

  console.log(`POST: r/${post.subreddit} — "${post.title}"`);
  console.log(`Author: u/${post.author} | Score: ${post.score}`);
  console.log(`URL: ${post.url}`);
  console.log(`Previous text eval: ${post.evaluation?.verdict} (${post.evaluation?.confidence})`);
  if (post.mediaAnalysis) {
    console.log(`Previous media eval: ${post.mediaAnalysis.authenticity} (${post.mediaAnalysis.confidence})`);
  }

  console.log("\nDownloading image...");
  const { base64, mimeType, tmpDir, size } = await downloadImage(post.url);
  console.log(`Image: ${(size / 1024).toFixed(0)} KB, ${mimeType}`);

  const prompt = buildPrompt(post);
  console.log("\n" + "=".repeat(80));
  console.log("\n## PROMPT (same for all models, + image):\n");
  console.log(prompt);
  console.log("\n" + "=".repeat(80) + "\n");

  const results = [];

  for (const provider of providers) {
    if (!provider.apiKey) {
      console.log(`SKIP: ${provider.name} — not configured\n`);
      continue;
    }

    console.log(`Testing: ${provider.name} (${provider.model})`);
    console.log("-".repeat(60));

    const result = provider.type === "anthropic"
      ? await callAnthropic(provider, prompt, base64, mimeType)
      : await callOllama(provider, prompt, base64, mimeType);

    if (result.error) {
      console.log(`  ERROR: ${result.error}`);
      console.log(`  Time: ${result.elapsed}s`);
      results.push({ name: provider.name, model: provider.model, error: result.error, elapsed: result.elapsed });
    } else {
      const tokIn = result.usage.prompt_tokens || "?";
      const tokOut = result.usage.completion_tokens || "?";
      console.log(`  Time: ${result.elapsed}s | Tokens: ${tokIn} in / ${tokOut} out`);
      console.log(`  JSON valid: ${result.parseOk} | Schema issues: ${result.validation.length === 0 ? "none" : result.validation.join(", ")}`);
      if (result.parsed) {
        console.log(`  Authenticity: ${result.parsed.authenticity} (${result.parsed.confidence})`);
        console.log(`  ID: ${result.parsed.identification}`);
        console.log(`  Forensic: ${result.parsed.forensicNotes}`);
        console.log(`  Reasoning: ${result.parsed.reasoning}`);
        console.log(`  Description: ${result.parsed.description?.slice(0, 300)}`);
      }
      if (!result.parseOk) {
        console.log(`  RAW: ${result.raw?.slice(0, 500)}`);
      }
      results.push({
        name: provider.name,
        model: provider.model,
        elapsed: result.elapsed,
        tokensIn: tokIn,
        tokensOut: tokOut,
        jsonValid: result.parseOk,
        schemaIssues: result.validation.length,
        authenticity: result.parsed?.authenticity,
        confidence: result.parsed?.confidence,
        identification: result.parsed?.identification,
      });
    }

    console.log("\n" + "=".repeat(80) + "\n");
  }

  // Summary table
  console.log("\n## MEDIA BENCHMARK SUMMARY\n");
  console.log("| Model | Time | JSON | Schema | Authenticity | Conf | Identification |");
  console.log("|-------|------|------|--------|-------------|------|----------------|");
  for (const r of results) {
    if (r.error) {
      console.log(`| ${r.name} | ${r.elapsed}s | ERROR | - | - | - | - |`);
    } else {
      console.log(`| ${r.name} | ${r.elapsed}s | ${r.jsonValid ? "Y" : "N"} | ${r.schemaIssues} | ${r.authenticity || "-"} | ${r.confidence ?? "-"} | ${r.identification?.slice(0, 40) || "-"} |`);
    }
  }

  rmSync(tmpDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
