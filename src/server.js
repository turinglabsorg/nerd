import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { posts, comments, users } from "./db.js";
import { getPostHumanityStats } from "./check-users.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STATS_TTL_MS = 60_000;
const cache = new Map();

async function cached(key, ttl, loader) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await loader();
  cache.set(key, { value, expires: Date.now() + ttl });
  return value;
}

export function startServer(port = 3666) {
  const app = express();

  app.use(express.static(path.join(__dirname, "../public")));

  // API: all evaluated posts (cached — primary list endpoint, polled from UI)
  app.get("/api/posts", async (req, res) => {
    const limit = parseInt(req.query.limit || "200", 10);
    const key = `posts:${req.query.verdict || ""}:${req.query.evaluated || ""}:${limit}`;
    const docs = await cached(key, 30_000, async () => {
      const filter = {};
      if (req.query.verdict) filter["evaluation.verdict"] = req.query.verdict;
      if (req.query.evaluated === "true") filter.evaluated = true;

      return posts()
        .find(filter)
        .sort({ createdUtc: -1 })
        .limit(limit)
        .toArray();
    });
    res.json(docs);
  });

  // API: stats (cached — these queries scan the whole collection)
  app.get("/api/stats", async (req, res) => {
    const data = await cached("stats", STATS_TTL_MS, async () => {
      const usersCol = users();
      const [totalPosts, totalEvaluated, totalComments, verdicts, subreddits, totalUsers, totalBots] = await Promise.all([
        posts().countDocuments(),
        posts().countDocuments({ evaluated: true }),
        comments().countDocuments(),
        posts().aggregate([
          { $match: { evaluated: true } },
          { $group: { _id: "$evaluation.verdict", count: { $sum: 1 } } },
        ]).toArray(),
        posts().aggregate([
          { $group: { _id: "$subreddit", count: { $sum: 1 } } },
        ]).toArray(),
        usersCol.countDocuments().catch(() => 0),
        usersCol.countDocuments({ humanityScore: { $lt: 40 } }).catch(() => 0),
      ]);

      return {
        totalPosts,
        totalEvaluated,
        pendingEval: totalPosts - totalEvaluated,
        totalComments,
        totalUsers,
        totalBots,
        verdicts: Object.fromEntries(verdicts.map((v) => [v._id, v.count])),
        subreddits: Object.fromEntries(subreddits.map((s) => [s._id, s.count])),
      };
    });
    res.json(data);
  });

  // API: geolocated posts (cached — every map render polls this)
  app.get("/api/geo", async (req, res) => {
    const docs = await cached("geo", 60_000, () =>
      posts()
        .find({ "geo.lat": { $exists: true } })
        .project({
          redditId: 1, title: 1, subreddit: 1, permalink: 1, score: 1,
          evaluation: 1, geo: 1, evaluatedAt: 1,
        })
        .toArray()
    );
    res.json(docs);
  });

  // API: removed/censored posts (cached)
  app.get("/api/removals", async (req, res) => {
    const docs = await cached("removals", 60_000, () =>
      posts()
        .find({
          removedStatus: { $exists: true, $nin: ["active", null] },
        })
        .sort({ removedAt: -1 })
        .limit(200)
        .toArray()
    );
    res.json(docs);
  });

  // API: censorship stats (cached)
  app.get("/api/stats/removals", async (req, res) => {
    const data = await cached("stats:removals", STATS_TTL_MS, async () => {
      const [total, byStatus, censorshipCandidates] = await Promise.all([
        posts().countDocuments({
          removedStatus: { $exists: true, $nin: ["active", null] },
        }),
        posts().aggregate([
          { $match: { removedStatus: { $exists: true, $nin: ["active", null] } } },
          { $group: { _id: "$removedStatus", count: { $sum: 1 } } },
        ]).toArray(),
        // Posts rated "real" that were removed by moderators
        posts().countDocuments({
          removedStatus: { $regex: /^removed/ },
          "evaluation.verdict": "real",
          "evaluation.confidence": { $gte: 0.6 },
        }),
      ]);

      return {
        totalRemoved: total,
        byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
        censorshipCandidates,
      };
    });
    res.json(data);
  });

  // API: search users
  app.get("/api/users", async (req, res) => {
    const q = req.query.q;
    if (!q) return res.json([]);

    try {
      const docs = await users()
        .find({ username: { $regex: q, $options: "i" } })
        .sort({ humanityScore: 1 })
        .limit(50)
        .toArray();
      res.json(docs);
    } catch (e) {
      res.json([]);
    }
  });

  // API: search posts
  app.get("/api/search", async (req, res) => {
    const q = req.query.q;
    if (!q) return res.json([]);

    const docs = await posts()
      .find({
        $or: [
          { title: { $regex: q, $options: "i" } },
          { selftext: { $regex: q, $options: "i" } },
          { author: { $regex: q, $options: "i" } },
          { "evaluation.reasoning": { $regex: q, $options: "i" } },
        ],
      })
      .sort({ createdUtc: -1 })
      .limit(100)
      .toArray();

    res.json(docs);
  });

  // API: single post with comments
  app.get("/api/posts/:redditId", async (req, res) => {
    const post = await posts().findOne({ redditId: req.params.redditId });
    if (!post) return res.status(404).json({ error: "not found" });

    const postComments = await comments()
      .find({ postRedditId: req.params.redditId })
      .sort({ score: -1 })
      .limit(50)
      .toArray();

    // Enrich comments with user humanity scores
    const authorNames = [...new Set(postComments.map(c => c.author).filter(Boolean))];
    let userMap = {};
    try {
      const userDocs = await users()
        .find({ username: { $in: authorNames } })
        .project({ username: 1, humanityScore: 1 })
        .toArray();
      userMap = Object.fromEntries(userDocs.map(u => [u.username, u.humanityScore]));
    } catch {}

    const enrichedComments = postComments.map(c => ({
      ...c,
      humanityScore: userMap[c.author] ?? null,
    }));

    const humanityStats = await getPostHumanityStats(req.params.redditId);

    res.json({ ...post, comments: enrichedComments, humanityStats });
  });

  // API: user profile
  app.get("/api/users/:username", async (req, res) => {
    try {
      const user = await users()
        .findOne({ username: req.params.username });
      if (!user) return res.status(404).json({ error: "not found" });
      res.json(user);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Serve single post page (SPA handles it client-side)
  app.get("/p/:redditId", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
  });

  app.listen(port, () => {
    console.log(`[server] UI running at http://localhost:${port}`);
  });
}
