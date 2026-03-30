import { config } from "./config.js";
import { posts } from "./db.js";

const UA = "nerd-agent/1.0";

async function fetchSubreddit(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=${config.postsLimit}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
  });

  if (!res.ok) {
    console.error(`[posts] r/${subreddit} HTTP ${res.status}`);
    return [];
  }

  const json = await res.json();
  return json.data.children.map((c) => c.data);
}

function matchesKeywords(title) {
  if (config.keywords.length === 0) return true;
  const lower = title.toLowerCase();
  return config.keywords.some((kw) => lower.includes(kw));
}

export async function scrapePosts() {
  let saved = 0;

  for (const sub of config.subreddits) {
    try {
      const items = await fetchSubreddit(sub);

      for (const item of items) {
        if (!matchesKeywords(item.title)) continue;

        try {
          await posts().updateOne(
            { redditId: item.id },
            {
              $setOnInsert: {
                redditId: item.id,
                subreddit: item.subreddit,
                title: item.title,
                selftext: item.selftext || "",
                author: item.author,
                url: item.url,
                permalink: `https://www.reddit.com${item.permalink}`,
                score: item.score,
                numComments: item.num_comments,
                createdUtc: item.created_utc,
                evaluated: false,
                evaluation: null,
                commentsFetched: false,
                insertedAt: new Date(),
              },
            },
            { upsert: true }
          );
          saved++;
        } catch (e) {
          if (e.code !== 11000) throw e; // ignore duplicate key
        }
      }

      console.log(`[posts] r/${sub}: ${items.length} fetched, ${saved} new`);
    } catch (err) {
      console.error(`[posts] r/${sub} error:`, err.message);
    }
  }

  return saved;
}
