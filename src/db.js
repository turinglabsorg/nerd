import { MongoClient } from "mongodb";
import { config } from "./config.js";

/** @type {MongoClient} */
let client;
/** @type {import("mongodb").Db} */
let db;

export async function connect() {
  client = new MongoClient(config.mongoUri);
  await client.connect();
  db = client.db();

  // Indexes
  await db.collection("posts").createIndex({ redditId: 1 }, { unique: true });
  await db.collection("posts").createIndex({ subreddit: 1, createdUtc: -1 });
  await db.collection("posts").createIndex({ evaluated: 1 });

  await db.collection("comments").createIndex({ redditId: 1 }, { unique: true });
  await db.collection("comments").createIndex({ postRedditId: 1 });

  console.log("[db] connected to", config.mongoUri);
  return db;
}

export function posts() {
  return db.collection("posts");
}

export function comments() {
  return db.collection("comments");
}

export async function disconnect() {
  await client?.close();
}
