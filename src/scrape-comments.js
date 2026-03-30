import { posts, comments } from "./db.js";

const UA = "nerd-agent/1.0";

function flattenComments(node, postRedditId) {
  const out = [];
  if (!node || node.kind !== "Listing") return out;

  for (const child of node.data.children) {
    if (child.kind !== "t1") continue;
    const d = child.data;
    out.push({
      redditId: d.id,
      postRedditId,
      author: d.author,
      body: d.body,
      score: d.score,
      createdUtc: d.created_utc,
      parentId: d.parent_id,
      insertedAt: new Date(),
    });

    // Recurse into replies
    if (d.replies) {
      out.push(...flattenComments(d.replies, postRedditId));
    }
  }
  return out;
}

export async function scrapeComments() {
  // First pass: posts that never had comments fetched
  // Second pass: re-fetch for posts that already have comments (catch new ones)
  const unfetched = await posts()
    .find({ commentsFetched: false })
    .sort({ insertedAt: -1 })
    .limit(10)
    .toArray();

  const refetch = await posts()
    .find({ commentsFetched: true })
    .sort({ lastCommentFetch: 1 }) // oldest fetch first
    .limit(5)
    .toArray();

  const pending = [...unfetched, ...refetch];

  if (pending.length === 0) {
    console.log("[comments] no posts to process");
    return 0;
  }

  let total = 0;

  for (const post of pending) {
    try {
      const url = `https://www.reddit.com/r/${post.subreddit}/comments/${post.redditId}.json?limit=100`;
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
      });

      if (!res.ok) {
        console.error(`[comments] ${post.redditId} HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      const commentNodes = flattenComments(json[1], post.redditId);

      let newComments = 0;
      for (const c of commentNodes) {
        try {
          const result = await comments().updateOne(
            { redditId: c.redditId },
            { $setOnInsert: c },
            { upsert: true }
          );
          if (result.upsertedCount > 0) newComments++;
          total++;
        } catch (e) {
          if (e.code !== 11000) throw e;
        }
      }

      const update = {
        commentsFetched: true,
        numComments: commentNodes.length,
        lastCommentFetch: new Date(),
      };

      // If new comments found on an already-evaluated post, flag for re-evaluation
      if (newComments > 0 && post.evaluated) {
        update.needsReeval = true;
      }

      await posts().updateOne({ _id: post._id }, { $set: update });

      const label = newComments > 0 ? `${newComments} new` : "no new";
      console.log(`[comments] ${post.redditId}: ${commentNodes.length} total, ${label}`);

      // Be nice to Reddit
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[comments] ${post.redditId} error:`, err.message);
    }
  }

  return total;
}
