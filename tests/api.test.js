import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVideoApp } from "../server/videoServer.js";

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

const episodes = [
  { id: "numberblocks:s01:e001", showSlug: "numberblocks", seasonNumber: 1, episodeNumber: 1, title: "One" },
  { id: "numberblocks:s01:e002", showSlug: "numberblocks", seasonNumber: 1, episodeNumber: 2, title: "Another One" },
  { id: "numberblocks:s02:e001", showSlug: "numberblocks", seasonNumber: 2, episodeNumber: 1, title: "Six" },
  { id: "numberblocks:s02:e002", showSlug: "numberblocks", seasonNumber: 2, episodeNumber: 2, title: "Seven" }
];

describe("video API", () => {
  let tempDir;
  let app;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "video-api-"));
    app = await createVideoApp({
      dbPath: path.join(tempDir, "video.sqlite"),
      shows,
      episodes,
      adminPassword: "secret",
      sessionSecret: "test-secret"
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns a catalog with computed locked state", async () => {
    const response = await request(app).get("/api/catalog").expect(200);

    const firstSeason = response.body.shows[0].seasons[0];
    expect(response.body.settings).toEqual({
      requiredPlayCount: 10,
      subtitlesEnabled: false,
      seasonModelEnabled: false,
      seasonSelections: { numberblocks: 1 },
      showOrder: ["numberblocks"]
    });
    expect(response.body.settings.requiredPlayCount).toBe(10);
    expect(firstSeason.episodes[0].progress.status).toBe("unlocked");
    expect(firstSeason.episodes[1].progress.status).toBe("locked");
  });

  it("counts playback starts even before progress advances", async () => {
    const response = await request(app)
      .post("/api/progress/numberblocks:s01:e001/play")
      .send({
        positionSeconds: 0,
        watchedSeconds: 0,
        durationSeconds: 305,
        playbackSessionId: "session-start"
      })
      .expect(200);

    expect(response.body.progress.playCount).toBe(1);
    expect(response.body.progress.status).toBe("in_progress");
  });

  it("counts playback starts and unlocks the next episode after 10 plays", async () => {
    for (let play = 1; play <= 9; play += 1) {
      const playResponse = await request(app)
        .post("/api/progress/numberblocks:s01:e001/play")
        .send({
          positionSeconds: 0,
          watchedSeconds: 0,
          durationSeconds: 305,
          playbackSessionId: `session-${play}`
        })
        .expect(200);

      expect(playResponse.body.progress.playCount).toBe(play);
      expect(playResponse.body.progress.status).toBe("in_progress");
    }

    await request(app)
      .post("/api/progress/numberblocks:s01:e001/play")
      .send({
        positionSeconds: 0,
        watchedSeconds: 0,
        durationSeconds: 305,
        playbackSessionId: "session-10"
      })
      .expect(200);

    const response = await request(app).get("/api/catalog").expect(200);
    const firstSeason = response.body.shows[0].seasons[0];
    expect(firstSeason.episodes[0].progress.playCount).toBe(10);
    expect(firstSeason.episodes[0].progress.status).toBe("completed");
    expect(firstSeason.episodes[1].progress.status).toBe("unlocked");
  });

  it("does not count repeated regular progress saves as plays", async () => {
    await request(app)
      .post("/api/progress/numberblocks:s01:e001")
      .send({
        positionSeconds: 275,
        watchedSeconds: 275,
        durationSeconds: 305,
        playbackSessionId: "session-1"
      })
      .expect(200);

    await request(app)
      .post("/api/progress/numberblocks:s01:e001")
      .send({
        positionSeconds: 300,
        watchedSeconds: 300,
        durationSeconds: 305,
        playbackSessionId: "session-1"
      })
      .expect(200);

    const response = await request(app).get("/api/catalog").expect(200);
    const firstSeason = response.body.shows[0].seasons[0];
    expect(firstSeason.episodes[0].progress.playCount).toBe(0);
    expect(firstSeason.episodes[0].progress.status).toBe("in_progress");
    expect(firstSeason.episodes[1].progress.status).toBe("locked");
  });

  it("dedupes repeated play-start calls in the same playback session", async () => {
    for (let call = 0; call < 2; call += 1) {
      await request(app)
        .post("/api/progress/numberblocks:s01:e001/play")
        .send({
          positionSeconds: call,
          watchedSeconds: call,
          durationSeconds: 305,
          playbackSessionId: "same-session"
        })
        .expect(200);
    }

    const response = await request(app).get("/api/catalog").expect(200);
    const firstSeason = response.body.shows[0].seasons[0];
    expect(firstSeason.episodes[0].progress.playCount).toBe(1);
    expect(firstSeason.episodes[1].progress.status).toBe("locked");
  });

  it("ignores removed watch percentage settings", async () => {
    const agent = request.agent(app);
    await agent.post("/api/admin/login").send({ password: "secret" }).expect(200);
    await agent.post("/api/admin/settings").send({ watchPercentRequired: 80 }).expect(200);

    const response = await agent.get("/api/catalog").expect(200);
    expect(response.body.settings).toEqual({
      requiredPlayCount: 10,
      subtitlesEnabled: false,
      seasonModelEnabled: false,
      seasonSelections: { numberblocks: 1 },
      showOrder: ["numberblocks"]
    });
  });

  it("lets an admin configure how many plays unlock the next episode and whether subtitles are forced on", async () => {
    const agent = request.agent(app);
    await agent.post("/api/admin/login").send({ password: "secret" }).expect(200);
    await agent.post("/api/admin/settings").send({ requiredPlayCount: 2, subtitlesEnabled: false }).expect(200);

    for (let play = 1; play <= 2; play += 1) {
      await agent
        .post("/api/progress/numberblocks:s01:e001/play")
        .send({
          positionSeconds: 0,
          watchedSeconds: 0,
          durationSeconds: 305,
          playbackSessionId: `play-${play}`
        })
        .expect(200);
    }

    const response = await agent.get("/api/catalog").expect(200);
    const firstSeason = response.body.shows[0].seasons[0];
    expect(response.body.settings.requiredPlayCount).toBe(2);
    expect(response.body.settings.subtitlesEnabled).toBe(false);
    expect(firstSeason.episodes[0].progress.playCount).toBe(2);
    expect(firstSeason.episodes[0].progress.status).toBe("completed");
    expect(firstSeason.episodes[1].progress.status).toBe("unlocked");
  });

  it("limits playback to the selected season and unlocks only within that season", async () => {
    const agent = request.agent(app);
    await agent.post("/api/admin/login").send({ password: "secret" }).expect(200);
    await agent
      .post("/api/admin/settings")
      .send({
        requiredPlayCount: 1,
        seasonModelEnabled: true,
        seasonSelections: { numberblocks: 2 }
      })
      .expect(200);

    let catalog = await agent.get("/api/catalog").expect(200);
    expect(catalog.body.settings.seasonModelEnabled).toBe(true);
    expect(catalog.body.settings.seasonSelections).toEqual({ numberblocks: 2 });
    expect(catalog.body.shows[0].seasons[0].episodes[0].progress.status).toBe("locked");
    expect(catalog.body.shows[0].seasons[1].episodes[0].progress.status).toBe("unlocked");
    expect(catalog.body.shows[0].seasons[1].episodes[1].progress.status).toBe("locked");

    await agent
      .post("/api/progress/numberblocks:s02:e001/play")
      .send({ playbackSessionId: "season-two-start" })
      .expect(200);

    catalog = await agent.get("/api/catalog").expect(200);
    expect(catalog.body.shows[0].seasons[1].episodes[0].progress.status).toBe("completed");
    expect(catalog.body.shows[0].seasons[1].episodes[1].progress.status).toBe("unlocked");
    expect(catalog.body.shows[0].seasons[0].episodes[0].progress.status).toBe("locked");

    await agent
      .post("/api/progress/numberblocks:s01:e001/play")
      .send({ playbackSessionId: "wrong-season" })
      .expect(400);

    await agent
      .post("/api/admin/reset-season")
      .send({ showSlug: "numberblocks", seasonNumber: 2 })
      .expect(200);

    catalog = await agent.get("/api/catalog").expect(200);
    expect(catalog.body.shows[0].seasons[1].episodes[0].progress.status).toBe("unlocked");
    expect(catalog.body.shows[0].seasons[1].episodes[0].progress.playCount).toBe(0);
    expect(catalog.body.shows[0].seasons[1].episodes[1].progress.status).toBe("locked");
  });

  it("requires admin login before progress edits", async () => {
    await request(app)
      .post("/api/admin/unlock-through")
      .send({ showSlug: "numberblocks", seasonNumber: 2, episodeNumber: 1 })
      .expect(401);
  });

  it("allows admin unlock-through and reset after login", async () => {
    const agent = request.agent(app);
    await agent.post("/api/admin/login").send({ password: "secret" }).expect(200);
    await agent
      .post("/api/admin/unlock-through")
      .send({ showSlug: "numberblocks", seasonNumber: 2, episodeNumber: 1 })
      .expect(200);

    let catalog = await agent.get("/api/catalog").expect(200);
    expect(catalog.body.shows[0].seasons[0].episodes[0].progress.status).toBe("completed");
    expect(catalog.body.shows[0].seasons[0].episodes[0].progress.playCount).toBe(10);
    expect(catalog.body.shows[0].seasons[1].episodes[0].progress.status).toBe("unlocked");

    await agent.post("/api/admin/reset-show").send({ showSlug: "numberblocks" }).expect(200);
    catalog = await agent.get("/api/catalog").expect(200);
    expect(catalog.body.shows[0].seasons[0].episodes[0].progress.status).toBe("unlocked");
    expect(catalog.body.shows[0].seasons[0].episodes[1].progress.status).toBe("locked");
  });
});
