import cron from "node-cron";
import { connect, disconnect } from "./db.js";
import { config } from "./config.js";
import { scrapePosts } from "./scrape-posts.js";
import { scrapeComments } from "./scrape-comments.js";
import { evaluatePosts } from "./evaluate.js";
import { geocodePosts } from "./geocode.js";
import { analyzeMedia } from "./analyze-media.js";
import { startServer } from "./server.js";

async function main() {
  await connect();

  console.log("[nerd] watching subreddits:", config.subreddits.join(", "));
  if (config.keywords.length > 0) {
    console.log("[nerd] keyword filter:", config.keywords.join(", "));
  }

  // Start web UI
  startServer();

  // Run once on startup
  await scrapePosts();
  await geocodePosts();

  // Cron: scrape posts
  cron.schedule(config.cronPosts, async () => {
    console.log("\n[cron] scraping posts...");
    await scrapePosts();
  });

  // Cron: scrape comments
  cron.schedule(config.cronComments, async () => {
    console.log("\n[cron] scraping comments...");
    await scrapeComments();
  });

  // Cron: evaluate posts with Claude
  cron.schedule(config.cronEvaluate, async () => {
    console.log("\n[cron] evaluating posts...");
    await evaluatePosts();
  });

  // Cron: geocode posts (every 2 minutes)
  cron.schedule("*/2 * * * *", async () => {
    await geocodePosts();
  });

  // Cron: analyze media (every 3 minutes)
  cron.schedule("*/3 * * * *", async () => {
    console.log("\n[cron] analyzing media...");
    await analyzeMedia();
  });

  console.log("[nerd] crons scheduled — posts: %s, comments: %s, evaluate: %s",
    config.cronPosts, config.cronComments, config.cronEvaluate);

  // Graceful shutdown
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      console.log(`\n[nerd] ${sig} received, shutting down...`);
      await disconnect();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error("[nerd] fatal:", err);
  process.exit(1);
});
