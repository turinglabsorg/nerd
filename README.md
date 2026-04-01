```
    .     *  .   .    *    .        ARE THEY REAL?     .    *
  .    *    UFO    .    *     .    NERD KNOWS.    .
      .  ___===___  .    .      .    *    .   .    *
   .    //  |||  \\    *    .        .       .
  *    //   |||   \\  .        .    *    .       .
 ____//_____|||____\\____    .        .   *
/________________________\      .        .    *
\________________________/   .    *    .       .
   .    *  .    .   *      .        .       .
```

# NERD

**Neural Evaluation of Reddit Data**

> *"The truth is out there... but is it on Reddit?"*

NERD is an autonomous agent that scrapes Reddit subreddits, collects every post and comment, and uses intelligence analysis frameworks to evaluate whether each post is **real**, **suspicious**, or **likely fake**. It profiles users for bot detection, tracks removed posts for censorship patterns, and analyzes images with vision LLMs.

## What it does

- Scrapes posts from configurable subreddits via Reddit JSON API (no auth needed)
- Fetches all comments and re-fetches them over time
- Evaluates each post using intelligence frameworks (Admiralty Code, CBCA, ACH)
- Re-evaluates when new comments arrive
- Profiles Reddit users for bot detection (humanity score 0-100%)
- Tracks post removals and flags potential censorship
- Geocodes locations mentioned in posts and plots them on a live map
- Analyzes images with vision LLMs (Qwen3-VL via Ollama Cloud)
- Sends Telegram notifications for each finding
- Serves a terminal-style dark web UI with Leaflet map, search, filters, and lightbox

## Evaluation Frameworks

Posts are evaluated using real intelligence community techniques:

- **Admiralty Code (NATO STANAG 2022)** — Source reliability (A-F) + Information credibility (1-6)
- **CBCA (Criteria-Based Content Analysis)** — 19 criteria for narrative authenticity
- **ACH (Analysis of Competing Hypotheses)** — Tests multiple explanations simultaneously
- **Deception Detection** — Linguistic indicators from forensic psychology research

## User Profiling

Every commenter is profiled for "humanity" based on:

- Account age and karma distribution
- Username patterns (auto-generated vs organic)
- Vocabulary diversity across comments
- Comment timing regularity (bots post at regular intervals)
- Duplicate content detection
- Email verification status

## Deployment

Two-part split deployment:

- **Scraper (Mac Pro / any machine)** — runs crons, scrapes Reddit, evaluates with LLM APIs
- **Web UI (Cloud Run)** — read-only frontend, serves the terminal UI

Both connect to **Firestore Enterprise** (MongoDB-compatible) as the shared database.

## Live demo

**https://nerd.directory** — the live instance scraping UFO subreddits in real-time.

## LLM Evaluation

Post evaluation uses OpenAI-compatible LLM APIs with automatic fallback. The system is provider-agnostic — any OpenAI-compatible endpoint works.

**Current setup:**
- **Text eval:** Ollama Cloud Qwen 3.5 397B (primary) → NVIDIA Nemotron Super 49B (fallback)
- **Media analysis:** Ollama Cloud Qwen3-VL 235B Instruct

### Text Evaluation Benchmark (2026-04-01)

Tested on r/AliensRHere post "Peru UFO sighting" (380 upvotes, 10 comments, link post). Evaluated: JSON validity, schema compliance, response time, and analysis quality.

| Model | Time | Tok Out | JSON | Schema | Verdict | Conf | Admiralty | CBCA |
|-------|------|---------|------|--------|---------|------|----------|------|
| Ollama DeepSeek V3.2 | 55.35s | 2572 | Y | 0 issues | likely_fake | 0.60 | F6 | 7 |
| **Ollama Qwen 3.5 397B** | 43.25s | 3446 | Y | 0 issues | likely_fake | 0.70 | E5 | 3 |
| Ollama Mistral Large 3 675B | 23.54s | 206 | Y | 0 issues | suspicious | 0.60 | D4 | 8 |
| Ollama Cogito 2.1 671B | 4.61s | 129 | Y | 0 issues | suspicious | 0.65 | F6 | 6 |
| Ollama Kimi K2 1T | 5.26s | 91 | Y | 0 issues | suspicious | 0.45 | F5 | 7 |
| Ollama Qwen 3.5 (default) | 32.74s | 2373 | Y | 0 issues | likely_fake | 0.85 | F3 | 5 |
| NVIDIA Nemotron Super 49B | 4.96s | 140 | N | 1 issue | likely_fake | 0.70 | D3 | 8 |
| NVIDIA Nemotron Ultra 253B | 7.49s | 114 | Y | 6 issues | - | - | - | - |

**Findings:**
- **Qwen 3.5 397B** — Best reasoning quality: caught TikTok repost and geographic inconsistencies between title and comments. Selected as primary.
- **Mistral Large 3 675B** — Good nuance distinguishing comment quality with CBCA, faster (24s).
- **Cogito 2.1 671B** — Fastest Ollama model (4.6s), solid analysis.
- **Kimi K2 1T** — Fast (5.3s) despite 1T parameters, concise but lower confidence.
- **DeepSeek V3.2** — Good analysis but slow (55s), overly pessimistic (F6 source rating).
- **NVIDIA Nemotron Super 49B** — Fast (5s) but JSON occasionally truncated. Reliable as fallback.
- **NVIDIA Nemotron Ultra 253B** — Broken JSON schema (reasoning in wrong field). Not usable.

### Media Analysis Benchmark (2026-04-01)

Tested on a 4chan screenshot image (140KB JPEG). Vision models evaluated for image description, authenticity detection, and JSON compliance.

| Model | Time | JSON | Schema | Authenticity | Conf | Identification |
|-------|------|------|--------|-------------|------|----------------|
| Ollama Qwen3-VL 235B | 19.77s | Y | 0 issues | genuine | 0.95 | Screenshot of 4chan thread |
| **Ollama Qwen3-VL 235B Instruct** | 13.81s | Y | 0 issues | genuine | 1.00 | Screenshot of 4chan post |
| Ollama Gemma3 27B | 10.54s | Y | 0 issues | genuine | 0.95 | Screenshot of text-based post |
| Ollama Gemma3 12B | 9.01s | Y | 0 issues | edited | 1.00 | Screenshot of Reddit post (wrong) |

**Findings:**
- **Qwen3-VL 235B Instruct** — Most accurate: correctly identified 4chan archive, read URL/metadata, perfect forensic analysis. Selected for media.
- **Qwen3-VL 235B** — Same quality, slightly slower, more verbose.
- **Gemma3 27B** — Correct but less detailed forensic notes.
- **Gemma3 12B** — Misidentified as "Reddit" and classified as "edited" (wrong). Not recommended.

Run benchmarks: `node scripts/benchmark.js` and `node scripts/benchmark-media.js`

## Quick start

```bash
cp .env.example .env
# Edit .env: MONGODB_URI, SUBREDDITS, LLM_*, TELEGRAM_*

docker compose up -d

# Check the UI
open http://localhost:3666
```

## Run Modes

Set `NERD_MODE` env var:
- `all` (default) — scraper + crons + web UI
- `scraper` — scraper + crons only, no web server
- `web` — web UI only, read-only from DB (for Cloud Run)

## CLI

```bash
node src/cli.js posts      # Force scrape posts
node src/cli.js comments   # Force scrape comments
node src/cli.js evaluate   # Force evaluate pending posts
node src/cli.js all        # Run the full pipeline
node src/cli.js stats      # Show database stats
```

## Architecture

```
src/
  index.js            Cron scheduler + server + run modes
  scrape-posts.js     Reddit JSON API scraper
  scrape-comments.js  Comment fetcher with re-eval flagging
  evaluate.js         LLM evaluator (OpenAI-compatible, with fallback)
  analyze-media.js    Vision LLM for image analysis (Ollama Cloud)
  check-removals.js   Post removal tracking + censorship detection
  check-users.js      User humanity profiling + bot detection
  geocode.js          Nominatim geocoder
  server.js           Express API (port 3666)
  telegram.js         Telegram notifications
  cli.js              Manual CLI tool
  config.js           Environment config
  db.js               MongoDB/Firestore (posts + comments + users)
public/
  index.html          Terminal-style SPA (map, search, filters, lightbox)
  favicon.svg         Animated UFO favicon
  og.svg              OpenGraph banner
```

## Cron Schedule

| Job | Frequency | What |
|-----|-----------|------|
| Posts | 5 min | Scrape configured subreddits |
| Comments | 7 min | Fetch + re-fetch comments |
| Evaluate | 1 min | Evaluate 1 post with LLM (intelligence frameworks) |
| Geocode | 2 min | Geocode post locations |
| Media | 3 min | Analyze images with Vision API |
| Removals | 10 min | Check for deleted/removed posts |
| Users | 2 min | Profile 30 users for bot detection |

## API

- `GET /api/posts` — Posts (query: `?evaluated=true&limit=200`)
- `GET /api/posts/:redditId` — Single post with comments + humanity stats
- `GET /api/stats` — Counts, verdicts, users, bots
- `GET /api/geo` — Posts with geolocation
- `GET /api/removals` — Removed/deleted posts
- `GET /api/stats/removals` — Removal stats + censorship candidates
- `GET /api/search?q=term` — Search posts
- `GET /api/users/:username` — User humanity profile
- `GET /api/users?q=term` — Search users

## Verdicts

- **REAL** — Genuine organic post, passes CBCA criteria, natural engagement
- **SUSPICIOUS** — Low-effort, possible karma farming, self-promotion, or bot activity
- **LIKELY FAKE** — AI-generated, physically impossible claims, confirmed manipulation

## Tech stack

Node.js, Firestore Enterprise (MongoDB-compatible), Express, Leaflet, Ollama Cloud / NVIDIA NIM (OpenAI-compatible LLMs), Qwen3-VL (vision), Docker, Telegram Bot API, Nominatim, Cloud Run

---

Built with curiosity and caffeine by [Turing Labs](https://turinglabs.org)

MIT License
