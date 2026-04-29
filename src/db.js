import { MongoClient } from "mongodb";
import { config } from "./config.js";

/** @type {MongoClient} */
let client;
/** @type {import("mongodb").Db} */
let db;

export async function connect() {
  console.log("[db] connecting...");
  client = new MongoClient(config.mongoUri, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
  });
  await client.connect();
  db = client.db();
  console.log("[db] connected, creating indexes...");

  // Indexes — wrapped in try/catch for Firestore compatibility
  const indexes = [
    ["posts", { redditId: 1 }, { unique: true }],
    ["posts", { evaluated: 1 }],
    ["posts", { needsReeval: 1 }],
    ["posts", { commentsFetched: 1, lastCommentFetch: 1 }],
    ["posts", { lastChecked: 1 }],
    ["posts", { removedStatus: 1 }],
    ["posts", { mediaAnalysis: 1 }],
    ["posts", { "geo.lat": 1 }],
    ["posts", { createdUtc: -1 }],
    ["posts", { insertedAt: -1 }],
    ["comments", { redditId: 1 }, { unique: true }],
    ["comments", { postRedditId: 1 }],
    ["comments", { author: 1 }],
    ["comments", { createdUtc: -1 }],
    ["users", { username: 1 }, { unique: true }],
    ["users", { lastChecked: 1 }],
  ];

  for (const [col, keys, opts] of indexes) {
    try {
      await Promise.race([
        db.collection(col).createIndex(keys, opts || {}),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
      ]);
    } catch (e) {
      console.warn(`[db] index ${col} ${JSON.stringify(keys)} skipped:`, e.message);
    }
  }

  console.log("[db] ready");
  return db;
}

export function posts() {
  return db.collection("posts");
}

export function comments() {
  return db.collection("comments");
}

export function users() {
  return db.collection("users");
}

export async function disconnect() {
  await client?.close();
}
