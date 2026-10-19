const MAX_REASONABLE_SAMPLE_SECONDS = 12;
const SEEK_TOLERANCE_SECONDS = 8;

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function createPlaybackTracker({ initialWatchedSeconds = 0 } = {}) {
  let watchedSeconds = Math.max(0, safeNumber(initialWatchedSeconds));
  let playing = false;
  let lastTick = null;
  let lastPosition = null;

  function snapshot(positionSeconds = lastPosition ?? 0) {
    return {
      watchedSeconds,
      positionSeconds: safeNumber(positionSeconds)
    };
  }

  return {
    markPlaying({ now = Date.now(), positionSeconds = 0 } = {}) {
      playing = true;
      lastTick = safeNumber(now);
      lastPosition = safeNumber(positionSeconds);
      return snapshot(positionSeconds);
    },

    sample({ now = Date.now(), positionSeconds = 0 } = {}) {
      const currentTick = safeNumber(now);
      const currentPosition = safeNumber(positionSeconds);

      if (!playing || lastTick == null || lastPosition == null) {
        lastTick = currentTick;
        lastPosition = currentPosition;
        return snapshot(currentPosition);
      }

      const elapsed = Math.max(0, Math.min((currentTick - lastTick) / 1000, MAX_REASONABLE_SAMPLE_SECONDS));
      const positionDelta = Math.abs(currentPosition - lastPosition);
      if (positionDelta <= elapsed + SEEK_TOLERANCE_SECONDS) {
        watchedSeconds += elapsed;
      }

      lastTick = currentTick;
      lastPosition = currentPosition;
      return snapshot(currentPosition);
    },

    markStopped({ now = Date.now(), positionSeconds = 0 } = {}) {
      const nextSnapshot = this.sample({ now, positionSeconds });
      playing = false;
      return nextSnapshot;
    }
  };
}
