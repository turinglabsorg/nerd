# NERD — Neural Evaluation of Reddit Data

Reddit scraper agent that collects posts/comments from UFO subreddits, evaluates authenticity with Claude, and displays findings in a terminal-style web UI.

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
├── evaluate.js         Claude Code CLI non-interactive evaluator
├── analyze-media.js    Image analysis via Anthropic Vision API (base64)
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
| Evaluate | `* * * * *` | 1 post/min via `claude -p` (Haiku model) |
| Geocode | `*/2 * * * *` | Extract locations from titles, geocode via Nominatim |
| Media | `*/3 * * * *` | Download images, analyze via Anthropic Vision API |
| Removals | `*/10 * * * *` | Check if posts were deleted/removed, flag censorship |
| Users | `*/2 * * * *` | Profile Reddit users, calculate humanity score (30 users/batch) |

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

- **posts** — indexes: `redditId` (unique), `evaluated`
- **comments** — indexes: `redditId` (unique), `postRedditId`
- **users** — indexes: `username` (unique); humanity score 0-100, signals array

## Running

```bash
cp .env.example .env   # configure MONGODB_URI, SUBREDDITS, LLM_*, TELEGRAM_*
docker compose up -d
```

## Key Details

- Text evaluation uses OpenAI-compatible LLM APIs (primary: NVIDIA Nemotron 3 Super, fallback: Ollama Cloud Qwen 3.5)
- Config: `LLM_BASE_URL/KEY/MODEL` (primary) + `LLM_FALLBACK_BASE_URL/KEY/MODEL` (fallback)
- `evaluatedBy` field on posts tracks which model was used for each evaluation
- Media/image analysis uses Anthropic API directly (needs ANTHROPIC_API_KEY)
- v.redd.it videos blocked by Reddit (403), only images analyzed currently
- Posts get `needsReeval: true` when new comments arrive
- Telegram sends formatted HTML messages with verdict + reasoning + reddit link
- Removal tracking: `removedStatus` field on posts (active, removed:moderator, removed:reddit, deleted:author)
- Censorship detection: alerts when posts rated "real" (confidence >= 0.6) are removed
- User humanity scoring: account age, karma ratio, vocab diversity, comment timing, duplicate detection
- Evaluation uses intelligence frameworks: Admiralty Code, CBCA, ACH, deception indicators
- Eval fields: `admiraltyRating`, `cbcaScore`, `competingHypothesis`, `evaluatedBy`
- Benchmark script: `node scripts/benchmark.js` tests multiple LLM providers
