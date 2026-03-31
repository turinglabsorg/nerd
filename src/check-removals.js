import { posts } from "./db.js";
import { sendTelegram } from "./telegram.js";

const UA = "nerd-agent/1.0";

async function checkPost(post) {
  try {
    const url = `https://www.reddit.com/r/${post.subreddit}/comments/${post.redditId}.json?limit=1`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });

    if (!res.ok) {
      // 404 = completely deleted
      if (res.status === 404) return "deleted";
      return null; // rate limited or error, skip
    }

    const json = await res.json();
    const data = json[0]?.data?.children?.[0]?.data;
    if (!data) return "deleted";

    // Check removal signals
    if (data.removed_by_category) return `removed:${data.removed_by_category}`;
    if (data.selftext === "[removed]") return "removed:moderator";
    if (data.selftext === "[deleted]") return "deleted:author";
    if (data.author === "[deleted]") return "deleted:author";
    if (data.title === "[removed by reddit]") return "removed:reddit";

    // Still alive — update score and comment count
    await posts().updateOne(
      { _id: post._id },
      {
        $set: {
          score: data.score,
          numComments: data.num_comments,
          upvoteRatio: data.upvote_ratio,
          lastChecked: new Date(),
        },
      }
    );

    return "active";
  } catch (err) {
    console.error(`[removals] ${post.redditId} error:`, err.message);
    return null;
  }
}

export async function checkRemovals() {
  // Check posts that haven't been checked recently (or never)
  const cutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
  const pending = await posts()
    .find({
      removedStatus: { $ne: "removed:moderator" }, // don't re-check already removed
      $or: [
        { lastChecked: { $exists: false } },
        { lastChecked: { $lt: cutoff } },
      ],
    })
    .sort({ lastChecked: 1, insertedAt: -1 })
    .limit(10)
    .toArray();

  if (pending.length === 0) {
    return 0;
  }

  let found = 0;

  for (const post of pending) {
    const status = await checkPost(post);
    if (!status) continue; // error, skip

    if (status !== "active") {
      const wasActive = !post.removedStatus || post.removedStatus === "active";

      await posts().updateOne(
        { _id: post._id },
        {
          $set: {
            removedStatus: status,
            removedAt: wasActive ? new Date() : post.removedAt,
            lastChecked: new Date(),
          },
        }
      );

      if (wasActive) {
        const verdict = post.evaluation?.verdict || "not evaluated";
        const confidence = post.evaluation?.confidence || 0;

        console.log(
          `[removals] ${post.redditId} ${status} — was ${verdict} (${confidence})`
        );

        // Alert if a "real" post was removed — possible censorship
        const isSuspicious = verdict === "real" && confidence >= 0.6;

        const icon = isSuspicious ? "\u{1F6A8}" : "\u{1F5D1}";
        const alert = isSuspicious
          ? "\n\n\u26a0\ufe0f <b>POSSIBLE CENSORSHIP</b>: This post was rated REAL with high confidence but was removed!"
          : "";

        await sendTelegram(
          [
            `${icon} <b>POST ${status.toUpperCase()}</b>`,
            ``,
            `<b>${escapeHtml(post.title)}</b>`,
            `r/${post.subreddit} \u2022 u/${post.author} \u2022 ${post.score}pts`,
            ``,
            `<b>Our verdict:</b> ${verdict} (${(confidence * 100).toFixed(0)}%)`,
            `<i>${escapeHtml(post.evaluation?.reasoning?.slice(0, 200) || "")}</i>`,
            alert,
            ``,
            `<a href="${post.permalink}">Open on Reddit</a>`,
          ].join("\n")
        );

        found++;
      }
    } else {
      // Mark as active/checked
      await posts().updateOne(
        { _id: post._id },
        { $set: { removedStatus: "active", lastChecked: new Date() } }
      );
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 2000));
  }

  return found;
}

function escapeHtml(text) {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
