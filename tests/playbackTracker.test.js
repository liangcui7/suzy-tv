import { describe, expect, it } from "vitest";
import { createPlaybackTracker } from "../src/lib/playbackTracker.js";

describe("playback tracker", () => {
  it("counts continuous playback across periodic samples", () => {
    const tracker = createPlaybackTracker({ initialWatchedSeconds: 0 });

    tracker.markPlaying({ now: 0, positionSeconds: 0 });
    expect(tracker.sample({ now: 10_000, positionSeconds: 10 }).watchedSeconds).toBe(10);
    expect(tracker.sample({ now: 20_000, positionSeconds: 20 }).watchedSeconds).toBe(20);
  });

  it("does not count large seek jumps as watched playback", () => {
    const tracker = createPlaybackTracker({ initialWatchedSeconds: 0 });

    tracker.markPlaying({ now: 0, positionSeconds: 0 });
    tracker.sample({ now: 10_000, positionSeconds: 10 });

    expect(tracker.sample({ now: 20_000, positionSeconds: 250 }).watchedSeconds).toBe(10);
  });
});
