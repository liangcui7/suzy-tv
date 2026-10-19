import { nextEpisodeAfter, orderedEpisodes } from "./catalog.js";

export const DEFAULT_REQUIRED_PLAY_COUNT = 10;
export const REQUIRED_PLAY_COUNT = DEFAULT_REQUIRED_PLAY_COUNT;

export function normalizeRequiredPlayCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) {
    return DEFAULT_REQUIRED_PLAY_COUNT;
  }
  return Math.max(1, Math.min(100, Math.round(count)));
}

function normalizePlayCount(record) {
  const playCount = Number(record?.playCount ?? 0);
  return Number.isFinite(playCount) ? Math.max(0, Math.floor(playCount)) : 0;
}

function normalizeProgressRecord(record) {
  return {
    ...record,
    playCount: normalizePlayCount(record),
    lastCountedPlaybackId: record?.lastCountedPlaybackId ?? null
  };
}

function blankProgress(episode, status, now) {
  return {
    episodeId: episode.id,
    showSlug: episode.showSlug,
    seasonNumber: Number(episode.seasonNumber),
    episodeNumber: Number(episode.episodeNumber),
    status,
    positionSeconds: 0,
    watchedSeconds: 0,
    durationSeconds: null,
    playCount: 0,
    lastCountedPlaybackId: null,
    completedAt: null,
    updatedAt: now
  };
}

export function initialProgress(episodes, now = new Date().toISOString()) {
  const firstByShow = new Set();

  return Object.fromEntries(
    orderedEpisodes(episodes).map((episode) => {
      const isFirstForShow = !firstByShow.has(episode.showSlug);
      firstByShow.add(episode.showSlug);
      return [episode.id, blankProgress(episode, isFirstForShow ? "unlocked" : "locked", now)];
    })
  );
}

export function progressMapFromRecords(records) {
  return Object.fromEntries(records.map((record) => [record.episodeId, normalizeProgressRecord(record)]));
}

export function progressRecordsFromMap(progress) {
  return Object.values(progress).sort((left, right) => {
    const showOrder = left.showSlug.localeCompare(right.showSlug);
    if (showOrder !== 0) {
      return showOrder;
    }
    const seasonOrder = Number(left.seasonNumber) - Number(right.seasonNumber);
    if (seasonOrder !== 0) {
      return seasonOrder;
    }
    return Number(left.episodeNumber) - Number(right.episodeNumber);
  });
}

export function mergeProgressDefaults(episodes, progress, now = new Date().toISOString()) {
  const merged = initialProgress(episodes, now);
  for (const episode of episodes) {
    if (progress[episode.id]) {
      merged[episode.id] = normalizeProgressRecord({
        ...merged[episode.id],
        ...progress[episode.id]
      });
    }
  }
  return merged;
}

export function updateEpisodeProgress({
  episodes,
  progress,
  episodeId,
  now = new Date().toISOString(),
  positionSeconds = 0,
  watchedSeconds = 0,
  durationSeconds = null
}) {
  const merged = mergeProgressDefaults(episodes, progress, now);
  const current = merged[episodeId];
  if (!current || current.status === "locked" || current.status === "completed") {
    return merged;
  }

  return {
    ...merged,
    [episodeId]: {
      ...current,
      status: "in_progress",
      positionSeconds: Math.max(Number(current.positionSeconds) || 0, Number(positionSeconds) || 0),
      watchedSeconds: Math.max(Number(current.watchedSeconds) || 0, Number(watchedSeconds) || 0),
      durationSeconds: durationSeconds == null ? current.durationSeconds : Number(durationSeconds),
      updatedAt: now
    }
  };
}

export function completeEpisode({
  episodes,
  progress,
  episodeId,
  now = new Date().toISOString(),
  positionSeconds = 0,
  watchedSeconds = 0,
  durationSeconds = null,
  playbackSessionId = null,
  requiredPlayCount = DEFAULT_REQUIRED_PLAY_COUNT
}) {
  const merged = mergeProgressDefaults(episodes, progress, now);
  const current = merged[episodeId];
  if (!current || current.status === "locked") {
    return merged;
  }

  const nextEpisode = nextEpisodeAfter(episodes, episodeId);
  const normalizedSessionId =
    typeof playbackSessionId === "string" && playbackSessionId.trim() ? playbackSessionId.trim() : null;
  const requiredCount = normalizeRequiredPlayCount(requiredPlayCount);
  const alreadyCounted = Boolean(normalizedSessionId && current.lastCountedPlaybackId === normalizedSessionId);
  const playCount = alreadyCounted
    ? normalizePlayCount(current)
    : Math.min(requiredCount, normalizePlayCount(current) + 1);
  const completed = playCount >= requiredCount;
  const updated = {
    ...merged,
    [episodeId]: {
      ...current,
      status: completed ? "completed" : "in_progress",
      positionSeconds: Math.max(Number(current.positionSeconds) || 0, Number(positionSeconds) || 0),
      watchedSeconds: Math.max(Number(current.watchedSeconds) || 0, Number(watchedSeconds) || 0),
      durationSeconds: durationSeconds == null ? current.durationSeconds : Number(durationSeconds),
      playCount,
      lastCountedPlaybackId: normalizedSessionId ?? current.lastCountedPlaybackId ?? null,
      completedAt: completed ? current.completedAt ?? now : null,
      updatedAt: now
    }
  };

  if (completed && nextEpisode && updated[nextEpisode.id]?.status === "locked") {
    updated[nextEpisode.id] = {
      ...updated[nextEpisode.id],
      status: "unlocked",
      updatedAt: now
    };
  }

  return updated;
}

export function applyAdminUnlockThrough({
  episodes,
  progress,
  showSlug,
  seasonNumber,
  episodeNumber,
  now = new Date().toISOString(),
  requiredPlayCount = DEFAULT_REQUIRED_PLAY_COUNT
}) {
  const merged = mergeProgressDefaults(episodes, progress, now);
  const showEpisodes = orderedEpisodes(episodes, showSlug);
  const requiredCount = normalizeRequiredPlayCount(requiredPlayCount);

  return showEpisodes.reduce((nextProgress, episode) => {
    const comesBeforeTarget =
      Number(episode.seasonNumber) < Number(seasonNumber) ||
      (Number(episode.seasonNumber) === Number(seasonNumber) &&
        Number(episode.episodeNumber) < Number(episodeNumber));
    const isTarget =
      Number(episode.seasonNumber) === Number(seasonNumber) &&
      Number(episode.episodeNumber) === Number(episodeNumber);

    if (!comesBeforeTarget && !isTarget) {
      return nextProgress;
    }

    const current = nextProgress[episode.id];
    nextProgress[episode.id] = {
      ...current,
      status: comesBeforeTarget ? "completed" : "unlocked",
      playCount: comesBeforeTarget ? requiredCount : normalizePlayCount(current),
      completedAt: comesBeforeTarget ? current.completedAt ?? now : null,
      updatedAt: now
    };
    return nextProgress;
  }, { ...merged });
}

export function resetShowProgress({ episodes, progress, showSlug, now = new Date().toISOString() }) {
  const initial = initialProgress(episodes, now);
  return Object.fromEntries(
    Object.entries(mergeProgressDefaults(episodes, progress, now)).map(([episodeId, record]) => [
      episodeId,
      record.showSlug === showSlug ? initial[episodeId] : record
    ])
  );
}

export function resetSeasonProgress({
  episodes,
  progress,
  showSlug,
  seasonNumber,
  now = new Date().toISOString()
}) {
  const merged = mergeProgressDefaults(episodes, progress, now);
  const seasonEpisodes = orderedEpisodes(episodes, showSlug).filter(
    (episode) => Number(episode.seasonNumber) === Number(seasonNumber)
  );
  const resetIds = new Set(seasonEpisodes.map((episode) => episode.id));

  return Object.fromEntries(
    Object.entries(merged).map(([episodeId, record]) => {
      if (!resetIds.has(episodeId)) {
        return [episodeId, record];
      }

      const episode = seasonEpisodes.find((candidate) => candidate.id === episodeId);
      return [episodeId, blankProgress(episode, episode === seasonEpisodes[0] ? "unlocked" : "locked", now)];
    })
  );
}
