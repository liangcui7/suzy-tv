import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createVideoApp } from "./videoServer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(appRoot, relativePath), "utf8"));
}

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
const dataDir = process.env.VIDEO_DATA_DIR || path.join(appRoot, "data");
const staticDir = process.env.VIDEO_STATIC_DIR || path.join(appRoot, "dist");
const dbPath = process.env.VIDEO_DB_PATH || path.join(dataDir, "video-learning.sqlite");

const shows = await readJson("src/content/shows.json");
const episodes = await readJson("src/content/episodes.json");
const adminPassword = process.env.VIDEO_ADMIN_PASSWORD;
if (!adminPassword) {
  throw new Error("Set VIDEO_ADMIN_PASSWORD in .env before starting Suzy TV.");
}

const app = await createVideoApp({
  dbPath,
  shows,
  episodes,
  adminPassword,
  sessionSecret: process.env.VIDEO_SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  staticDir
});

app.listen(port, host, () => {
  console.log(`Suzy TV listening on http://${host}:${port}`);
});
