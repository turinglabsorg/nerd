import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { posts, comments } from "./db.js";

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
      .sort({ evaluatedAt: -1, insertedAt: -1 })
      .limit(parseInt(req.query.limit || "200", 10))
      .toArray();

    res.json(docs);
  });

  // API: stats
  app.get("/api/stats", async (req, res) => {
    const [totalPosts, totalEvaluated, totalComments, verdicts, subreddits] = await Promise.all([
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
    ]);

    res.json({
      totalPosts,
      totalEvaluated,
      pendingEval: totalPosts - totalEvaluated,
      totalComments,
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
      .sort({ evaluatedAt: -1, insertedAt: -1 })
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

    res.json({ ...post, comments: postComments });
  });

  app.listen(port, () => {
    console.log(`[server] UI running at http://localhost:${port}`);
  });
}
