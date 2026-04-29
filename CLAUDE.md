# NERD — Neural Evaluation of Reddit Data

Reddit scraper agent that collects posts/comments from UFO subreddits, evaluates authenticity with open-source LLMs, and displays findings in a terminal-style web UI.

## Run Modes

Set `NERD_MODE` env var:
- `all` (default) — runs scraper + crons + web UI
- `scraper` — scraper + crons only, no web server (for Mac Pro)
- `web` — web UI only, read-only from DB (for Cloud Run)

## Database

Uses Firestore Enterprise with MongoDB compatibility (GCP project: `iconic-elevator-394020`, database: `nerd`).
Connection string format: `mongodb://USER:PASS@UID.europe-west1.firestore.goog:443/nerd?loadBalanced=true&authMechanism=SCRAM-SHA-256&tls=true&retryWrites=false`

## Architecture

```
src/
├── index.js            Main entry — cron scheduler + server startup
├── config.js           Env-based configuration
├── db.js               MongoDB connection (posts + comments collections)
├── scrape-posts.js     Reddit JSON API scraper (paginated, new/hot/top, no auth)
├── scrape-comments.js  Comment fetcher with re-fetch + re-eval flagging
├── evaluate.js         LLM evaluator (OpenAI-compatible, with fallback)
├── analyze-media.js    Vision LLM image analysis (Ollama Cloud Qwen3-VL)
├── check-removals.js   Tracks deleted/removed posts, flags censorship
├── check-users.js      User humanity profiling (karma, age, comment patterns, bot detection)
├── geocode.js          Location extraction + Nominatim geocoding
├── server.js           Express API + static file server (port 3666)
├── telegram.js         Telegram Bot API notifications
└── cli.js              CLI tool (posts/comments/evaluate/all/stats)
public/
├── index.html          Terminal-style SPA (Leaflet map, filters, lightbox)
├── favicon.svg         Animated UFO favicon
└── og.svg              OpenGraph banner
```

## Cron Schedule

| Job | Schedule | Description |
|-----|----------|-------------|
| Posts | `*/5 * * * *` | Scrape subreddits via Reddit JSON API |
| Comments | `*/7 * * * *` | Fetch comments, re-fetch old posts, flag for re-eval |
| Evaluate | `CRON_EVALUATE` env | Up to 5 posts/run via OpenAI-compatible LLM API (default `*/10 * * * *`) |
| Geocode | `*/10 * * * *` | Extract locations from titles, geocode via Nominatim |
| Media | `*/5 * * * *` | Download images, analyze via Vision LLM (Qwen3-VL) |
| Removals | `*/15 * * * *` | Check if posts were deleted/removed, flag censorship |
| Users | `*/15 * * * *` | Profile Reddit users, calculate humanity score (up to 30 users/batch) |

## API Endpoints

- `GET /api/posts` — All posts (query: `?evaluated=true&verdict=suspicious&limit=200`)
- `GET /api/posts/:redditId` — Single post with comments
- `GET /api/stats` — Counts and verdict breakdown
- `GET /api/geo` — Posts with geolocation data
- `GET /api/removals` — Posts that were deleted/removed from Reddit
- `GET /api/stats/removals` — Removal counts + censorship candidates
- `GET /api/search?q=term` — Search posts by title, body, author, analysis
- `GET /api/users/:username` — User humanity profile with signals

## MongoDB Collections

- **posts** — indexes: `redditId` (unique), `evaluated`, `needsReeval`, `(commentsFetched, lastCommentFetch)`, `lastChecked`, `removedStatus`, `mediaAnalysis`, `geo.lat`, `createdUtc`, `insertedAt`
- **comments** — indexes: `redditId` (unique), `postRedditId`, `author`, `createdUtc`
- **users** — indexes: `username` (unique), `lastChecked`; humanity score 0-100, signals array

## Server-side caching

`src/server.js` keeps an in-memory TTL cache for hot endpoints (frontend polling hits these):
- `/api/stats` and `/api/stats/removals` — 60s TTL (each runs 6+ countDocuments/aggregate)
- `/api/posts`, `/api/geo`, `/api/removals` — 30-60s TTL

Cache is process-local; with multiple Cloud Run instances each holds its own copy. That's fine — the goal is to absorb the polling burst from the frontend, not be globally consistent.

## Frontend polling

`public/index.html` has an auto-refresh toggle. Default is **OFF**; intervals are 1m / 5m / 15m. Don't re-enable by default without first reviewing Firestore read costs — the previous default (30s with 5 endpoints) was the main driver of the 50€/mo bill that prompted the perf pass.

## Running

```bash
cp .env.example .env   # configure MONGODB_URI, SUBREDDITS, LLM_*, TELEGRAM_*
docker compose up -d
```

## Key Details

- Text evaluation uses OpenAI-compatible LLM APIs (primary: Ollama Cloud Qwen 3.5 397B, fallback: NVIDIA Nemotron Super 49B)
- Config: `LLM_BASE_URL/KEY/MODEL` (primary) + `LLM_FALLBACK_BASE_URL/KEY/MODEL` (fallback)
- `evaluatedBy` field on posts tracks which model was used for each evaluation
- Media/image analysis uses OpenAI-compatible Vision API (config: `VISION_BASE_URL/API_KEY/MODEL`)
- Current vision model: Ollama Cloud Qwen3-VL 235B Instruct
- v.redd.it videos blocked by Reddit (403), only images analyzed currently
- Posts get `needsReeval: true` when new comments arrive
- Telegram sends formatted HTML messages with verdict + reasoning + reddit link
- Removal tracking: `removedStatus` field on posts (active, removed:moderator, removed:reddit, deleted:author)
- Censorship detection: alerts when posts rated "real" (confidence >= 0.6) are removed
- User humanity scoring: account age, karma ratio, vocab diversity, comment timing, duplicate detection
- Evaluation uses intelligence frameworks: Admiralty Code, CBCA, ACH, deception indicators
- Eval fields: `admiraltyRating`, `cbcaScore`, `competingHypothesis`, `evaluatedBy`
- Benchmark scripts: `node scripts/benchmark.js` (text eval) and `node scripts/benchmark-media.js` (vision)
