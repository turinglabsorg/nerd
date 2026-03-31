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

NERD is an autonomous agent that scrapes Reddit subreddits, collects every post and comment, and uses intelligence analysis frameworks to evaluate whether each post is **real**, **suspicious**, or **likely fake**. It profiles users for bot detection, tracks removed posts for censorship patterns, and analyzes images with Claude Vision.

## What it does

- Scrapes posts from configurable subreddits via Reddit JSON API (no auth needed)
- Fetches all comments and re-fetches them over time
- Evaluates each post using intelligence frameworks (Admiralty Code, CBCA, ACH)
- Re-evaluates when new comments arrive
- Profiles Reddit users for bot detection (humanity score 0-100%)
- Tracks post removals and flags potential censorship
- Geocodes locations mentioned in posts and plots them on a live map
- Analyzes images with Anthropic Vision API
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

**Current setup:** NVIDIA Nemotron 3 Super (primary) → Ollama Cloud Qwen 3.5 (fallback)

### Model Benchmark (2026-03-31)

Tested on the same Reddit post with identical prompts. Evaluated: JSON validity, schema compliance, response time, and analysis quality.

| Model | Time | Tok Out | JSON | Schema | Verdict | Conf | Admiralty | CBCA |
|-------|------|---------|------|--------|---------|------|----------|------|
| **NVIDIA Nemotron 3 Super 120B** | 5.90s | 186 | Y | 0 issues | suspicious | 0.65 | D4 | 7 |
| NVIDIA Llama 3.3 Nemotron Super 49B | 2.80s | 96 | Y | 0 issues | suspicious | 0.40 | D3 | 8 |
| NVIDIA Llama 3.1 Nemotron Ultra 253B | 2.40s | 96 | Y | 6 issues | - | - | - | - |
| DeepSeek R1 Distill Qwen 32B | 16.30s | 516 | Y | 0 issues | likely_fake | 0.65 | F3 | 5 |
| Llama 3.1 8B Instruct | 0.48s | - | ERROR | - | - | - | - | - |
| Ollama Cloud Qwen 3.5 | 48.42s | 2917 | Y | 0 issues | likely_fake | 0.85 | F5 | 3 |

**Findings:**
- **Nemotron 3 Super 120B** — Best balance of speed (6s), JSON compliance, and balanced analysis. Selected as primary.
- **Llama 3.3 Nemotron Super 49B** — Fastest (2.8s) with valid output, but lower confidence and shorter reasoning.
- **Nemotron Ultra 253B** — Fast but broken JSON schema output (6 validation errors). Not usable.
- **DeepSeek R1 Distill Qwen 32B** — Good analysis quality but slow (16s) due to reasoning overhead.
- **Llama 3.1 8B** — Doesn't support `chat_template_kwargs`, fails on the API call.
- **Qwen 3.5 (Ollama)** — Most aggressive classifier (0.85 confidence) but very slow (48s) and verbose (2917 tokens out). Good as fallback.

Run the benchmark yourself: `node scripts/benchmark.js`

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
  analyze-media.js    Anthropic Vision API for images
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

Node.js, Firestore Enterprise (MongoDB-compatible), Express, Leaflet, NVIDIA NIM / Ollama Cloud (OpenAI-compatible LLMs), Anthropic Vision API, Docker, Telegram Bot API, Nominatim, Cloud Run

---

Built with curiosity and caffeine by [Turing Labs](https://turinglabs.org)

MIT License
