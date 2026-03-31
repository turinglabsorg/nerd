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

- **Scraper (Mac Pro / any machine)** — runs crons, scrapes Reddit, evaluates with Claude
- **Web UI (Cloud Run)** — read-only frontend, serves the terminal UI

Both connect to **Firestore Enterprise** (MongoDB-compatible) as the shared database.

## Quick start

```bash
cp .env.example .env
# Edit .env: MONGODB_URI, SUBREDDITS, TELEGRAM_*, ANTHROPIC_API_KEY

docker compose up -d

# First time: log into Claude inside the container
docker exec -it nerd-nerd-1 claude
# Type /login, click the link, done

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
  evaluate.js         Claude CLI evaluator (intelligence frameworks)
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
| Evaluate | 1 min | Evaluate 1 post with Claude (intelligence frameworks) |
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

Node.js, Firestore Enterprise (MongoDB-compatible), Express, Leaflet, Claude Code CLI, Anthropic Vision API, Docker, Telegram Bot API, Nominatim, Cloud Run

---

Built with curiosity and caffeine by [Turing Labs](https://turinglabs.org)

MIT License
