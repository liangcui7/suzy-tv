import { describe, expect, it } from "vitest";
import {
  applyAdminUnlockThrough,
  completeEpisode,
  initialProgress
} from "../src/lib/progressRules.js";

const episodes = [
  { id: "numberblocks:s01:e001", showSlug: "numberblocks", seasonNumber: 1, episodeNumber: 1 },
  { id: "numberblocks:s01:e002", showSlug: "numberblocks", seasonNumber: 1, episodeNumber: 2 },
  { id: "numberblocks:s02:e001", showSlug: "numberblocks", seasonNumber: 2, episodeNumber: 1 },
  { id: "alphablocks:s01:e001", showSlug: "alphablocks", seasonNumber: 1, episodeNumber: 1 }
];

describe("progress rules", () => {
  it("unlocks only the first episode of each show initially", () => {
    const progress = initialProgress(episodes, "2026-07-03T00:00:00.000Z");

    expect(progress["numberblocks:s01:e001"].status).toBe("unlocked");
    expect(progress["numberblocks:s01:e001"].playCount).toBe(0);
    expect(progress["numberblocks:s01:e002"].status).toBe("locked");
    expect(progress["numberblocks:s02:e001"].status).toBe("locked");
    expect(progress["alphablocks:s01:e001"].status).toBe("unlocked");
  });

  it("counts playback starts and unlocks the next episode only after 10 plays", () => {
    let progress = initialProgress(episodes, "2026-07-03T00:00:00.000Z");
    progress["numberblocks:s01:e002"].status = "unlocked";

    for (let play = 1; play <= 9; play += 1) {
      progress = completeEpisode({
        episodes,
        progress,
        episodeId: "numberblocks:s01:e002",
        now: `2026-07-03T00:0${play}:00.000Z`,
        positionSeconds: 0,
        watchedSeconds: 0,
        durationSeconds: 305
      });

      expect(progress["numberblocks:s01:e002"].playCount).toBe(play);
      expect(progress["numberblocks:s01:e002"].status).toBe("in_progress");
      expect(progress["numberblocks:s02:e001"].status).toBe("locked");
    }

    const updated = completeEpisode({
      episodes,
      progress,
      episodeId: "numberblocks:s01:e002",
      now: "2026-07-03T00:10:00.000Z",
      positionSeconds: 0,
      watchedSeconds: 0,
      durationSeconds: 305
    });

    expect(updated["numberblocks:s01:e002"].playCount).toBe(10);
    expect(updated["numberblocks:s01:e002"].status).toBe("completed");
    expect(updated["numberblocks:s02:e001"].status).toBe("unlocked");
  });

  it("uses a configurable play count requirement", () => {
    let progress = initialProgress(episodes, "2026-07-03T00:00:00.000Z");
    progress["numberblocks:s01:e002"].status = "unlocked";

    progress = completeEpisode({
      episodes,
      progress,
      episodeId: "numberblocks:s01:e002",
      now: "2026-07-03T00:01:00.000Z",
      positionSeconds: 0,
      watchedSeconds: 0,
      durationSeconds: 305,
      requiredPlayCount: 2
    });

    expect(progress["numberblocks:s01:e002"].playCount).toBe(1);
    expect(progress["numberblocks:s01:e002"].status).toBe("in_progress");
    expect(progress["numberblocks:s02:e001"].status).toBe("locked");

    const updated = completeEpisode({
      episodes,
      progress,
      episodeId: "numberblocks:s01:e002",
      now: "2026-07-03T00:02:00.000Z",
      positionSeconds: 0,
      watchedSeconds: 0,
      durationSeconds: 305,
      requiredPlayCount: 2
    });

    expect(updated["numberblocks:s01:e002"].playCount).toBe(2);
    expect(updated["numberblocks:s01:e002"].status).toBe("completed");
    expect(updated["numberblocks:s02:e001"].status).toBe("unlocked");
  });

  it("does not double count the same playback session", () => {
    let progress = initialProgress(episodes, "2026-07-03T00:00:00.000Z");

    progress = completeEpisode({
      episodes,
      progress,
      episodeId: "numberblocks:s01:e001",
      now: "2026-07-03T00:01:00.000Z",
      playbackSessionId: "session-1"
    });

    const updated = completeEpisode({
      episodes,
      progress,
      episodeId: "numberblocks:s01:e001",
      now: "2026-07-03T00:02:00.000Z",
      playbackSessionId: "session-1"
    });

    expect(updated["numberblocks:s01:e001"].playCount).toBe(1);
    expect(updated["numberblocks:s01:e001"].status).toBe("in_progress");
  });

  it("admin unlock-through completes earlier episodes and unlocks the target", () => {
    const progress = initialProgress(episodes, "2026-07-03T00:00:00.000Z");
    const updated = applyAdminUnlockThrough({
      episodes,
      progress,
      showSlug: "numberblocks",
      seasonNumber: 2,
      episodeNumber: 1,
      now: "2026-07-03T00:10:00.000Z"
    });

    expect(updated["numberblocks:s01:e001"].status).toBe("completed");
    expect(updated["numberblocks:s01:e001"].playCount).toBe(10);
    expect(updated["numberblocks:s01:e002"].status).toBe("completed");
    expect(updated["numberblocks:s01:e002"].playCount).toBe(10);
    expect(updated["numberblocks:s02:e001"].status).toBe("unlocked");
    expect(updated["alphablocks:s01:e001"].status).toBe("unlocked");
  });
});
