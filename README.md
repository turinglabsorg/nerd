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

NERD is an autonomous agent that scrapes UFO/alien subreddits, collects every post and comment, and asks Claude to evaluate whether each post is **real**, **suspicious**, or **likely fake**. Because someone has to do the hard work of separating the genuine UFO sightings from the karma-farming bots. And that someone is an AI. The irony is not lost on us.

## What it does

- Scrapes posts from r/UFOs, r/UFOB, r/AliensRHere (or any subreddit you configure)
- Fetches all comments and re-fetches them over time
- Evaluates each post with Claude (verdict + confidence + reasoning)
- Re-evaluates when new comments arrive (because the plot thickens)
- Geocodes locations mentioned in posts and plots them on a map
- Analyzes images with Claude Vision (is that a UFO or a frisbee?)
- Sends Telegram notifications for each finding
- Serves a terminal-style dark web UI with a live map of sightings

## The UI

Hacker-movie-approved terminal aesthetic. Green text on black. Scanlines. A Leaflet map with glowing dots. CRT flicker. Everything you need to feel like you're running a secret government surveillance program from your basement.

## Quick start

```bash
cp .env.example .env
# Edit .env with your MongoDB URI, Telegram bot token, etc.

docker compose up -d

# First time: log into Claude inside the container
docker exec -it nerd-nerd-1 claude
# Type /login, click the link, done

# Check the UI
open http://localhost:3666
```

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
  index.js            Cron scheduler + server
  scrape-posts.js     Reddit JSON API (no auth needed)
  scrape-comments.js  Comment fetcher with re-eval flagging
  evaluate.js         Claude Code CLI evaluator
  analyze-media.js    Anthropic Vision API for images
  geocode.js          Nominatim geocoder
  server.js           Express API (port 3666)
  telegram.js         Telegram notifications
  cli.js              Manual CLI tool
  config.js           Environment config
  db.js               MongoDB (posts + comments)
public/
  index.html          Terminal-style SPA
  favicon.svg         Animated UFO favicon
  og.svg              OpenGraph banner
```

## Cron jobs

| Job | Frequency | What |
|-----|-----------|------|
| Posts | 5 min | Scrape configured subreddits |
| Comments | 7 min | Fetch + re-fetch comments |
| Evaluate | 1 min | Evaluate 1 post with Claude |
| Geocode | 2 min | Geocode post locations |
| Media | 3 min | Analyze images with Vision API |

## Verdicts

- **REAL** - Genuine organic post, natural community engagement
- **SUSPICIOUS** - Low-effort, possible karma farming, self-promotion, or recruitment
- **LIKELY FAKE** - AI-generated, physically impossible claims, community-identified fakes

## Tech stack

Node.js, MongoDB, Express, Leaflet, Claude Code CLI, Anthropic Vision API, Docker, Telegram Bot API, Nominatim

## Disclaimer

This project is for entertainment and research purposes. We are not affiliated with any government agency, secret or otherwise. If aliens are reading this: we come in peace, and we think most of the posts about you are suspicious at best.

---

Built with curiosity and caffeine by [Turing Labs](https://turinglabs.org)

MIT License
