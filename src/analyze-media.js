import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { posts } from "./db.js";
import { config } from "./config.js";
import { sendTelegram } from "./telegram.js";

const execFileP = promisify(execFile);
const execP = promisify(exec);

const UA = "nerd-agent/1.0";
const FRAME_COUNT = 6;

function isVideoUrl(url) {
  return /v\.redd\.it|youtube\.com|youtu\.be|\.mp4|\.webm/i.test(url);
}

function isImageUrl(url) {
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url) || /i\.redd\.it|imgur\.com/i.test(url);
}

async function downloadVideo(url, tmpDir) {
  const outPath = path.join(tmpDir, "video.mp4");

  if (/v\.redd\.it/.test(url)) {
    // Reddit video: try DASH url with fallback
    const dashUrl = url.endsWith("/") ? `${url}DASH_480.mp4` : `${url}/DASH_480.mp4`;
    try {
      await execP(`curl -sL -o "${outPath}" -A "${UA}" "${dashUrl}"`, { timeout: 30000 });
      return outPath;
    } catch {
      // Try HLS fallback
      const hlsUrl = url.endsWith("/") ? `${url}HLSPlaylist.m3u8` : `${url}/HLSPlaylist.m3u8`;
      try {
        await execP(`ffmpeg -y -i "${hlsUrl}" -c copy -t 30 "${outPath}" 2>/dev/null`, { timeout: 60000 });
        return outPath;
      } catch {
        return null;
      }
    }
  }

  if (/youtube\.com|youtu\.be/.test(url)) {
    // Skip YouTube for now — needs yt-dlp which is heavy
    return null;
  }

  // Direct mp4/webm
  try {
    await execP(`curl -sL -o "${outPath}" -A "${UA}" "${url}"`, { timeout: 30000 });
    return outPath;
  } catch {
    return null;
  }
}

async function downloadImage(url, tmpDir) {
  const ext = url.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || "jpg";
  const outPath = path.join(tmpDir, `image.${ext}`);

  try {
    await execP(`curl -sL -o "${outPath}" -A "${UA}" "${url}"`, { timeout: 15000 });
    return outPath;
  } catch {
    return null;
  }
}

async function extractFrames(videoPath, tmpDir) {
  const pattern = path.join(tmpDir, "frame_%03d.jpg");

  try {
    // Get video duration
    const { stdout } = await execP(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}" 2>/dev/null`
    );
    const duration = parseFloat(stdout.trim()) || 10;
    const interval = Math.max(1, Math.floor(duration / FRAME_COUNT));

    await execP(
      `ffmpeg -y -i "${videoPath}" -vf "fps=1/${interval}" -frames:v ${FRAME_COUNT} -q:v 3 "${pattern}" 2>/dev/null`,
      { timeout: 30000 }
    );

    const files = await readdir(tmpDir);
    return files
      .filter(f => f.startsWith("frame_") && f.endsWith(".jpg"))
      .sort()
      .map(f => path.join(tmpDir, f));
  } catch (err) {
    console.error("[media] frame extraction failed:", err.message);
    return [];
  }
}

async function analyzeWithClaude(imagePaths, post) {
  const mediaType = imagePaths.length > 1 ? "video frames" : "image";

  // Build image content blocks as base64
  const imageBlocks = [];
  for (const imgPath of imagePaths) {
    const data = await readFile(imgPath);
    const ext = path.extname(imgPath).slice(1).toLowerCase();
    const mediaTypeMap = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
    imageBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaTypeMap[ext] || "image/jpeg",
        data: data.toString("base64"),
      },
    });
  }

  const textPrompt = `Describe what you see in this ${mediaType}. Be objective and factual.

POST CONTEXT (from Reddit):
- Subreddit: r/${post.subreddit}
- Title: ${post.title}

Analyze the ${mediaType} and provide:
1. What is in the ${mediaType}? Describe exactly what you see — objects, text, people, environment, sky, etc.
2. Does it look like a genuine unedited ${mediaType} or does it show signs of manipulation (CGI, compositing, digital art)?
3. If there are identifiable objects, what are they?

Respond with a JSON object (no markdown fences):
{
  "description": "factual description of what you see",
  "authenticity": "genuine" | "edited" | "cgi" | "inconclusive",
  "identification": "what the content actually is (screenshot, photo, artwork, meme, etc.)",
  "confidence": 0.0-1.0,
  "frame_notes": ["note for each frame if multiple"],
  "reasoning": "brief explanation"
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [...imageBlocks, { type: "text", text: textPrompt }],
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  const json = await res.json();
  return json.content?.[0]?.text || "";
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1];
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

export async function analyzeMedia() {
  if (!config.anthropicKey) {
    return 0;
  }
  // Prioritize images (reliable download), then videos
  const pending = await posts()
    .find({
      mediaAnalysis: { $exists: false },
      evaluated: true,
      url: { $regex: /i\.redd\.it|imgur\.com|\.(jpg|jpeg|png|gif|webp)/i },
    })
    .sort({ evaluatedAt: -1 })
    .limit(3)
    .toArray();

  if (pending.length === 0) {
    console.log("[media] no pending media to analyze");
    return 0;
  }

  let analyzed = 0;

  for (const post of pending) {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "nerd-media-"));

    try {
      let imagePaths = [];

      if (isVideoUrl(post.url)) {
        console.log(`[media] downloading video ${post.redditId}: ${post.url}`);
        const videoPath = await downloadVideo(post.url, tmpDir);
        if (videoPath) {
          imagePaths = await extractFrames(videoPath, tmpDir);
          console.log(`[media] extracted ${imagePaths.length} frames`);
        }
      } else if (isImageUrl(post.url)) {
        console.log(`[media] downloading image ${post.redditId}: ${post.url}`);
        const imgPath = await downloadImage(post.url, tmpDir);
        if (imgPath) imagePaths = [imgPath];
      }

      if (imagePaths.length === 0) {
        await posts().updateOne({ _id: post._id }, { $set: { mediaAnalysis: null } });
        console.log(`[media] ${post.redditId}: could not download media`);
        continue;
      }

      console.log(`[media] analyzing ${post.redditId} with Claude vision...`);
      const raw = await analyzeWithClaude(imagePaths, post);

      let analysis;
      try {
        const cleaned = typeof raw === "string" ? extractJson(raw) : raw;
        analysis = typeof cleaned === "string" ? JSON.parse(cleaned) : cleaned;
      } catch {
        analysis = { description: raw, authenticity: "error", confidence: 0 };
      }

      analysis.frameCount = imagePaths.length;
      analysis.analyzedAt = new Date();

      await posts().updateOne(
        { _id: post._id },
        { $set: { mediaAnalysis: analysis } }
      );

      console.log(`[media] ${post.redditId}: ${analysis.authenticity} — ${analysis.identification || 'unknown'}`);

      // Send Telegram notification
      const icon = analysis.authenticity === "genuine" ? "\u2705"
        : analysis.authenticity === "edited" || analysis.authenticity === "cgi" ? "\ud83d\udea9" : "\ud83d\udd0d";

      await sendTelegram([
        `${icon} <b>MEDIA ANALYSIS</b>`,
        ``,
        `<b>${escapeHtml(post.title)}</b>`,
        `r/${post.subreddit} \u2022 ${analysis.authenticity?.toUpperCase()} (${((analysis.confidence || 0) * 100).toFixed(0)}%)`,
        ``,
        `<b>ID:</b> ${escapeHtml(analysis.identification || 'unknown')}`,
        `<i>${escapeHtml(analysis.reasoning || '')}</i>`,
        ``,
        `<a href="${config.baseUrl}/p/${post.redditId}">View on NERD</a> | <a href="${post.permalink}">Reddit</a>`,
      ].join("\n"));

      analyzed++;
      await new Promise(r => setTimeout(r, 5000));
    } catch (err) {
      console.error(`[media] ${post.redditId} error:`, err.message);
      await posts().updateOne({ _id: post._id }, { $set: { mediaAnalysis: null } });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  return analyzed;
}

function escapeHtml(text) {
  return (text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
