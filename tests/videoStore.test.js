import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVideoStore } from "../server/videoStore.js";

const shows = [
  {
    slug: "numberblocks",
    title: "Numberblocks",
    seasons: [
      { number: 1, title: "Season 1", playlistId: "season-one" },
      { number: 2, title: "Season 2", playlistId: "season-two" }
    ]
  }
];

const twoShows = [
  ...shows,
  { slug: "alphablocks", title: "Alphablocks", seasons: [{ number: 1, title: "Season 1", playlistId: "alpha-one" }] }
];

const episodes = [
  { id: "numberblocks:s01:e001", showSlug: "numberblocks", seasonNumber: 1, episodeNumber: 1, title: "One" },
  { id: "numberblocks:s01:e002", showSlug: "numberblocks", seasonNumber: 1, episodeNumber: 2, title: "Another One" },
  { id: "numberblocks:s02:e001", showSlug: "numberblocks", seasonNumber: 2, episodeNumber: 1, title: "Six" }
];

describe("video store", () => {
  let tempDir;
  let dbPath;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "video-store-"));
    dbPath = path.join(tempDir, "video.sqlite");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("initializes first episode unlocked and later episodes locked", async () => {
    const store = await createVideoStore({ dbPath, shows, episodes });
    const progress = await store.getProgress();

    expect(progress.find((record) => record.episodeId === "numberblocks:s01:e001").status).toBe("unlocked");
    expect(progress.find((record) => record.episodeId === "numberblocks:s01:e001").playCount).toBe(0);
    expect(progress.find((record) => record.episodeId === "numberblocks:s01:e002").status).toBe("locked");
  });

  it("persists play counts and next episode unlock across reloads after 10 plays", async () => {
    const store = await createVideoStore({ dbPath, shows, episodes });
    await store.adminSetProgress({ episodeId: "numberblocks:s01:e002", status: "unlocked" });
    for (let index = 0; index < 10; index += 1) {
      await store.completeEpisode({
        episodeId: "numberblocks:s01:e002",
        positionSeconds: 305,
        watchedSeconds: 305,
        durationSeconds: 305
      });
    }

    const reloaded = await createVideoStore({ dbPath, shows, episodes });
    const progress = await reloaded.getProgress();

    expect(progress.find((record) => record.episodeId === "numberblocks:s01:e002").playCount).toBe(10);
    expect(progress.find((record) => record.episodeId === "numberblocks:s01:e002").status).toBe("completed");
    expect(progress.find((record) => record.episodeId === "numberblocks:s02:e001").status).toBe("unlocked");
  });

  it("admin unlock-through records an event", async () => {
    const store = await createVideoStore({ dbPath, shows, episodes });
    await store.unlockThrough({ showSlug: "numberblocks", seasonNumber: 2, episodeNumber: 1 });

    const events = await store.getAdminEvents();

    expect(events[0].action).toBe("unlock-through");
    expect(events[0].payload.showSlug).toBe("numberblocks");
  });

  it("persists a custom show order and ignores unknown slugs", async () => {
    const store = await createVideoStore({ dbPath, shows: twoShows, episodes });
    expect((await store.getCatalog()).shows.map((show) => show.slug)).toEqual(["numberblocks", "alphablocks"]);

    await store.updateSettings({ showOrder: ["alphablocks", "nope", "numberblocks"] });
    await store.updateSettings({ subtitlesEnabled: true });

    const reloaded = await createVideoStore({ dbPath, shows: twoShows, episodes });
    const catalog = await reloaded.getCatalog();
    expect(catalog.settings.showOrder).toEqual(["alphablocks", "numberblocks"]);
    expect(catalog.shows.map((show) => show.slug)).toEqual(["alphablocks", "numberblocks"]);
  });
});
