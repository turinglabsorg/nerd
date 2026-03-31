import { config } from "./config.js";
import { posts } from "./db.js";

const UA = "nerd-agent/1.0";

const MAX_PAGES = parseInt(process.env.SCRAPE_PAGES || "4", 10);

async function fetchSubreddit(subreddit, sort = "new") {
  let allItems = [];
  let after = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const extra = sort === "top" ? "&t=week" : "";
    const params = `limit=${config.postsLimit}${after ? `&after=${after}` : ""}${extra}`;
    const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?${params}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
    });

    if (!res.ok) {
      console.error(`[posts] r/${subreddit} HTTP ${res.status}`);
      break;
    }

    const json = await res.json();
    const items = json.data.children.map((c) => c.data);
    allItems.push(...items);

    after = json.data.after;
    if (!after) break; // no more pages

    // Be nice to Reddit
    await new Promise((r) => setTimeout(r, 2000));
  }

  return allItems;
}

function matchesKeywords(title) {
  if (config.keywords.length === 0) return true;
  const lower = title.toLowerCase();
  return config.keywords.some((kw) => lower.includes(kw));
}

export async function scrapePosts() {
  let saved = 0;

  const sorts = ["new", "hot", "top"];

  for (const sub of config.subreddits) {
    try {
      let items = [];
      for (const sort of sorts) {
        const sortItems = await fetchSubreddit(sub, sort);
        items.push(...sortItems);
        await new Promise((r) => setTimeout(r, 2000));
      }

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
