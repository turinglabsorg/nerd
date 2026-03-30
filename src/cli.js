#!/usr/bin/env node
import { connect, disconnect, posts, comments } from "./db.js";
import { scrapePosts } from "./scrape-posts.js";
import { scrapeComments } from "./scrape-comments.js";
import { evaluatePosts } from "./evaluate.js";

const cmd = process.argv[2];

const commands = {
  posts: async () => {
    const n = await scrapePosts();
    console.log(`Done — ${n} new posts saved`);
  },
  comments: async () => {
    const n = await scrapeComments();
    console.log(`Done — ${n} comments saved`);
  },
  evaluate: async () => {
    const n = await evaluatePosts();
    console.log(`Done — ${n} posts evaluated`);
  },
  all: async () => {
    console.log("--- Scraping posts ---");
    await scrapePosts();
    console.log("\n--- Scraping comments ---");
    await scrapeComments();
    console.log("\n--- Evaluating posts ---");
    await evaluatePosts();
  },
  stats: async () => {
    const totalPosts = await posts().countDocuments();
    const evaluated = await posts().countDocuments({ evaluated: true });
    const totalComments = await comments().countDocuments();
    const verdicts = await posts().aggregate([
      { $match: { evaluated: true } },
      { $group: { _id: "$evaluation.verdict", count: { $sum: 1 } } },
    ]).toArray();

    console.log(`Posts: ${totalPosts} (${evaluated} evaluated)`);
    console.log(`Comments: ${totalComments}`);
    console.log("Verdicts:", verdicts.map((v) => `${v._id}: ${v.count}`).join(", ") || "none yet");
  },
};

if (!cmd || !commands[cmd]) {
  console.log("Usage: node src/cli.js <command>\n");
  console.log("Commands:");
  console.log("  posts      Force scrape posts now");
  console.log("  comments   Force scrape comments now");
  console.log("  evaluate   Force evaluate pending posts now");
  console.log("  all        Run posts → comments → evaluate");
  console.log("  stats      Show database stats");
  process.exit(1);
}

await connect();
try {
  await commands[cmd]();
} finally {
  await disconnect();
}
