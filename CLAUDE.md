# NERD — Neural Evaluation of Reddit Data

Reddit scraper agent that collects posts/comments from UFO subreddits, evaluates authenticity with Claude, and displays findings in a terminal-style web UI.

## Architecture

```
src/
├── index.js            Main entry — cron scheduler + server startup
├── config.js           Env-based configuration
├── db.js               MongoDB connection (posts + comments collections)
├── scrape-posts.js     Reddit JSON API scraper (public, no auth)
├── scrape-comments.js  Comment fetcher with re-fetch + re-eval flagging
├── evaluate.js         Claude Code CLI non-interactive evaluator
├── analyze-media.js    Image analysis via Anthropic Vision API (base64)
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

## API Endpoints

- `GET /api/posts` — All posts (query: `?evaluated=true&verdict=suspicious&limit=200`)
- `GET /api/posts/:redditId` — Single post with comments
- `GET /api/stats` — Counts and verdict breakdown
- `GET /api/geo` — Posts with geolocation data

## MongoDB Collections

- **posts** — indexes: `redditId` (unique), `subreddit+createdUtc`, `evaluated`
- **comments** — indexes: `redditId` (unique), `postRedditId`

## Running

```bash
cp .env.example .env   # configure MONGODB_URI, SUBREDDITS, TELEGRAM_*, ANTHROPIC_API_KEY
docker compose up -d   # first time: docker exec -it nerd-nerd-1 claude then /login
```

## Key Details

- Text evaluation uses `claude -p` CLI (free with login, Haiku model)
- Media/image analysis uses Anthropic API directly (needs ANTHROPIC_API_KEY)
- v.redd.it videos blocked by Reddit (403), only images analyzed currently
- Posts get `needsReeval: true` when new comments arrive
- Telegram sends formatted HTML messages with verdict + reasoning + reddit link
