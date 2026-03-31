import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { posts, comments, users } from "./db.js";
import { getPostHumanityStats } from "./check-users.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startServer(port = 3666) {
  const app = express();

  app.use(express.static(path.join(__dirname, "../public")));

  // API: all evaluated posts
  app.get("/api/posts", async (req, res) => {
    const filter = {};
    if (req.query.verdict) filter["evaluation.verdict"] = req.query.verdict;
    if (req.query.evaluated === "true") filter.evaluated = true;

    const docs = await posts()
      .find(filter)
      .sort({ createdUtc: -1 })
      .limit(parseInt(req.query.limit || "200", 10))
      .toArray();

    res.json(docs);
  });

  // API: stats
  app.get("/api/stats", async (req, res) => {
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

    res.json({
      totalPosts,
      totalEvaluated,
      pendingEval: totalPosts - totalEvaluated,
      totalComments,
      totalUsers,
      totalBots,
      verdicts: Object.fromEntries(verdicts.map((v) => [v._id, v.count])),
      subreddits: Object.fromEntries(subreddits.map((s) => [s._id, s.count])),
    });
  });

  // API: geolocated posts (only those with coordinates)
  app.get("/api/geo", async (req, res) => {
    const docs = await posts()
      .find({ "geo.lat": { $exists: true } })
      .project({
        redditId: 1, title: 1, subreddit: 1, permalink: 1, score: 1,
        evaluation: 1, geo: 1, evaluatedAt: 1,
      })
      .toArray();

    res.json(docs);
  });

  // API: removed/censored posts
  app.get("/api/removals", async (req, res) => {
    const docs = await posts()
      .find({
        removedStatus: { $exists: true, $nin: ["active", null] },
      })
      .sort({ removedAt: -1 })
      .limit(200)
      .toArray();

    res.json(docs);
  });

  // API: censorship stats
  app.get("/api/stats/removals", async (req, res) => {
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

    res.json({
      totalRemoved: total,
      byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
      censorshipCandidates,
    });
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
