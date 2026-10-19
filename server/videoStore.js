import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";
import {
  activeEpisodesForSettings,
  buildCatalog,
  mergeScopedProgress,
  normalizeSeasonSelections,
  normalizeShowOrder,
  scopeProgressForSeasonModel
} from "../src/lib/catalog.js";
import {
  applyAdminUnlockThrough,
  completeEpisode as completeEpisodeProgress,
  DEFAULT_REQUIRED_PLAY_COUNT,
  initialProgress,
  normalizeRequiredPlayCount,
  progressMapFromRecords,
  progressRecordsFromMap,
  resetSeasonProgress,
  resetShowProgress,
  updateEpisodeProgress
} from "../src/lib/progressRules.js";

let sqlPromise = null;

function sqlJs() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs();
  }
  return sqlPromise;
}

function readRows(db, sql, params = []) {
  const statement = db.prepare(sql);
  const rows = [];

  try {
    statement.bind(params);
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }
  } finally {
    statement.free();
  }

  return rows;
}

function toProgress(row) {
  return {
    episodeId: row.episode_id,
    showSlug: row.show_slug,
    seasonNumber: Number(row.season_number),
    episodeNumber: Number(row.episode_number),
    status: row.status,
    positionSeconds: Number(row.position_seconds),
    watchedSeconds: Number(row.watched_seconds),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    playCount: Number(row.play_count ?? 0),
    lastCountedPlaybackId: row.last_counted_playback_id ?? null,
    completedAt: row.completed_at ?? null,
    updatedAt: row.updated_at
  };
}

function toEvent(row) {
  return {
    id: row.id,
    action: row.action,
    episodeId: row.episode_id ?? null,
    payload: JSON.parse(row.payload_json),
    createdAt: row.created_at
  };
}

function defaultSettings(shows) {
  return {
    requiredPlayCount: DEFAULT_REQUIRED_PLAY_COUNT,
    subtitlesEnabled: false,
    seasonModelEnabled: false,
    seasonSelections: normalizeSeasonSelections(shows),
    showOrder: normalizeShowOrder(shows)
  };
}

function normalizeSubtitlesEnabled(value) {
  return value === true;
}

function migrate(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS progress (
      episode_id TEXT PRIMARY KEY,
      show_slug TEXT NOT NULL,
      season_number INTEGER NOT NULL,
      episode_number INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('locked', 'unlocked', 'in_progress', 'completed')),
      position_seconds REAL NOT NULL DEFAULT 0,
      watched_seconds REAL NOT NULL DEFAULT 0,
      duration_seconds REAL,
      play_count INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  const progressColumns = readRows(db, "PRAGMA table_info(progress);").map((column) => column.name);
  if (!progressColumns.includes("play_count")) {
    db.run("ALTER TABLE progress ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0;");
  }
  if (!progressColumns.includes("last_counted_playback_id")) {
    db.run("ALTER TABLE progress ADD COLUMN last_counted_playback_id TEXT;");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin_events (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      episode_id TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function writeProgressRow(db, record) {
  db.run(
    `
      INSERT INTO progress (
        episode_id, show_slug, season_number, episode_number, status,
        position_seconds, watched_seconds, duration_seconds, play_count,
        last_counted_playback_id, completed_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(episode_id) DO UPDATE SET
        show_slug = excluded.show_slug,
        season_number = excluded.season_number,
        episode_number = excluded.episode_number,
        status = excluded.status,
        position_seconds = excluded.position_seconds,
        watched_seconds = excluded.watched_seconds,
        duration_seconds = excluded.duration_seconds,
        play_count = excluded.play_count,
        last_counted_playback_id = excluded.last_counted_playback_id,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at;
    `,
    [
      record.episodeId,
      record.showSlug,
      record.seasonNumber,
      record.episodeNumber,
      record.status,
      record.positionSeconds,
      record.watchedSeconds,
      record.durationSeconds,
      record.playCount,
      record.lastCountedPlaybackId ?? null,
      record.completedAt,
      record.updatedAt
    ]
  );
}

function adminPlayCount({ current, status, playCount, requiredPlayCount }) {
  const requested = playCount == null ? current.playCount : Number(playCount);
  const normalized = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
  return status === "completed" ? Math.max(normalized, normalizeRequiredPlayCount(requiredPlayCount)) : normalized;
}

function readSettings(db, shows) {
  const fallback = defaultSettings(shows);
  const row = readRows(db, "SELECT value FROM app_state WHERE key = ?;", ["settings"])[0];
  if (!row) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(row.value);
    return {
      requiredPlayCount: normalizeRequiredPlayCount(parsed.requiredPlayCount),
      subtitlesEnabled: normalizeSubtitlesEnabled(parsed.subtitlesEnabled),
      seasonModelEnabled: parsed.seasonModelEnabled === true,
      seasonSelections: normalizeSeasonSelections(shows, parsed.seasonSelections),
      showOrder: normalizeShowOrder(shows, parsed.showOrder)
    };
  } catch {
    return fallback;
  }
}

function writeSettings(db, settings, timestamp) {
  db.run(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at;
    `,
    ["settings", JSON.stringify(settings), timestamp]
  );
}

function writeProgressMap(db, progress) {
  for (const record of progressRecordsFromMap(progress)) {
    writeProgressRow(db, record);
  }
}

function insertAdminEvent(db, action, episodeId, payload, now) {
  db.run(
    `
      INSERT INTO admin_events (id, action, episode_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?);
    `,
    [crypto.randomUUID(), action, episodeId ?? null, JSON.stringify(payload), now]
  );
}

export async function createVideoStore({ dbPath, shows, episodes, now = () => new Date().toISOString() }) {
  const SQL = await sqlJs();
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  let db;
  try {
    const data = await fs.readFile(dbPath);
    db = new SQL.Database(data);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    db = new SQL.Database();
  }

  migrate(db);

  async function persist() {
    await fs.writeFile(dbPath, Buffer.from(db.export()));
  }

  function readProgressMap() {
    return progressMapFromRecords(readRows(db, "SELECT * FROM progress;").map(toProgress));
  }

  const existing = readProgressMap();
  const seeded = {
    ...initialProgress(episodes, now()),
    ...existing
  };
  writeProgressMap(db, seeded);
  await persist();

  return {
    async getProgress() {
      return progressRecordsFromMap(readProgressMap());
    },

    async getCatalog() {
      const settings = await this.getSettings();
      return {
        ...(buildCatalog(shows, episodes, await this.getProgress(), settings)),
        settings
      };
    },

    async getSettings() {
      return readSettings(db, shows);
    },

    async updateSettings({
      requiredPlayCount,
      subtitlesEnabled,
      seasonModelEnabled,
      seasonSelections,
      showOrder
    }) {
      const timestamp = now();
      const current = readSettings(db, shows);
      const settings = {
        ...current,
        requiredPlayCount:
          requiredPlayCount == null
            ? current.requiredPlayCount
            : normalizeRequiredPlayCount(requiredPlayCount),
        subtitlesEnabled:
          subtitlesEnabled == null
            ? current.subtitlesEnabled
            : normalizeSubtitlesEnabled(subtitlesEnabled),
        seasonModelEnabled:
          seasonModelEnabled == null ? current.seasonModelEnabled : seasonModelEnabled === true,
        seasonSelections:
          seasonSelections == null
            ? current.seasonSelections
            : normalizeSeasonSelections(shows, seasonSelections),
        showOrder: showOrder == null ? current.showOrder : normalizeShowOrder(shows, showOrder)
      };
      writeSettings(db, settings, timestamp);
      insertAdminEvent(db, "update-settings", null, settings, timestamp);
      await persist();
      return settings;
    },

    async getNext() {
      const catalog = await this.getCatalog();
      const byShow = catalog.shows.map((show) => {
        const episode = show.seasons
          .flatMap((season) => season.episodes)
          .find((candidate) => {
            const record = candidate.progress;
            return record && record.status !== "completed" && record.status !== "locked";
          });
        return { showSlug: show.slug, episode: episode ?? null };
      });

      return {
        byShow,
        next: byShow.find((entry) => entry.episode)?.episode ?? null
      };
    },

    async updateProgress({ episodeId, positionSeconds, watchedSeconds, durationSeconds }) {
      const settings = readSettings(db, shows);
      const rawProgress = readProgressMap();
      const scopedProgress = scopeProgressForSeasonModel({
        shows,
        episodes,
        progress: rawProgress,
        settings
      });
      const activeEpisodes = activeEpisodesForSettings({ shows, episodes, settings });
      if (!scopedProgress[episodeId] || scopedProgress[episodeId].status === "locked") {
        throw new Error("Episode is locked.");
      }
      const progress = updateEpisodeProgress({
        episodes: activeEpisodes,
        progress: scopedProgress,
        episodeId,
        positionSeconds,
        watchedSeconds,
        durationSeconds,
        now: now()
      });
      const persistedProgress = mergeScopedProgress({
        shows,
        episodes,
        rawProgress,
        scopedProgress: progress,
        settings
      });
      writeProgressMap(db, persistedProgress);
      await persist();
      return persistedProgress[episodeId];
    },

    async completeEpisode({ episodeId, positionSeconds, watchedSeconds, durationSeconds, playbackSessionId = null }) {
      const settings = readSettings(db, shows);
      const rawProgress = readProgressMap();
      const scopedProgress = scopeProgressForSeasonModel({
        shows,
        episodes,
        progress: rawProgress,
        settings
      });
      const activeEpisodes = activeEpisodesForSettings({ shows, episodes, settings });
      if (!scopedProgress[episodeId] || scopedProgress[episodeId].status === "locked") {
        throw new Error("Episode is locked.");
      }
      const progress = completeEpisodeProgress({
        episodes: activeEpisodes,
        progress: scopedProgress,
        episodeId,
        positionSeconds,
        watchedSeconds,
        durationSeconds,
        playbackSessionId,
        requiredPlayCount: settings.requiredPlayCount,
        now: now()
      });
      const persistedProgress = mergeScopedProgress({
        shows,
        episodes,
        rawProgress,
        scopedProgress: progress,
        settings
      });
      writeProgressMap(db, persistedProgress);
      await persist();
      return persistedProgress[episodeId];
    },

    async adminSetProgress({
      episodeId,
      status,
      positionSeconds = 0,
      watchedSeconds = 0,
      durationSeconds = null,
      playCount = null
    }) {
      const progress = readProgressMap();
      const current = progress[episodeId];
      if (!current) {
        throw new Error("Episode not found.");
      }
      const timestamp = now();
      const settings = readSettings(db, shows);
      progress[episodeId] = {
        ...current,
        status,
        positionSeconds: Number(positionSeconds),
        watchedSeconds: Number(watchedSeconds),
        durationSeconds: durationSeconds == null ? current.durationSeconds : Number(durationSeconds),
        playCount: adminPlayCount({ current, status, playCount, requiredPlayCount: settings.requiredPlayCount }),
        completedAt: status === "completed" ? current.completedAt ?? timestamp : null,
        updatedAt: timestamp
      };
      writeProgressMap(db, progress);
      insertAdminEvent(db, "set-progress", episodeId, progress[episodeId], timestamp);
      await persist();
      return progress[episodeId];
    },

    async unlockThrough({ showSlug, seasonNumber, episodeNumber }) {
      const timestamp = now();
      const settings = readSettings(db, shows);
      const rawProgress = readProgressMap();
      const scopedProgress = scopeProgressForSeasonModel({
        shows,
        episodes,
        progress: rawProgress,
        settings
      });
      const activeEpisodes = activeEpisodesForSettings({ shows, episodes, settings });
      if (
        settings.seasonModelEnabled === true &&
        !activeEpisodes.some(
          (episode) =>
            episode.showSlug === showSlug &&
            Number(episode.seasonNumber) === Number(seasonNumber) &&
            Number(episode.episodeNumber) === Number(episodeNumber)
        )
      ) {
        throw new Error("Choose an episode from the selected season.");
      }
      const progress = applyAdminUnlockThrough({
        episodes: activeEpisodes,
        progress: scopedProgress,
        showSlug,
        seasonNumber,
        episodeNumber,
        requiredPlayCount: settings.requiredPlayCount,
        now: timestamp
      });
      const persistedProgress = mergeScopedProgress({
        shows,
        episodes,
        rawProgress,
        scopedProgress: progress,
        settings
      });
      writeProgressMap(db, persistedProgress);
      insertAdminEvent(db, "unlock-through", null, { showSlug, seasonNumber, episodeNumber }, timestamp);
      await persist();
      return progressRecordsFromMap(persistedProgress);
    },

    async resetSeason({ showSlug, seasonNumber }) {
      const timestamp = now();
      const progress = resetSeasonProgress({
        episodes,
        progress: readProgressMap(),
        showSlug,
        seasonNumber,
        now: timestamp
      });
      writeProgressMap(db, progress);
      insertAdminEvent(db, "reset-season", null, { showSlug, seasonNumber }, timestamp);
      await persist();
      return progressRecordsFromMap(progress);
    },

    async resetShow({ showSlug }) {
      const timestamp = now();
      const progress = resetShowProgress({ episodes, progress: readProgressMap(), showSlug, now: timestamp });
      writeProgressMap(db, progress);
      insertAdminEvent(db, "reset-show", null, { showSlug }, timestamp);
      await persist();
      return progressRecordsFromMap(progress);
    },

    async getAdminEvents() {
      return readRows(db, "SELECT * FROM admin_events ORDER BY created_at DESC, id DESC LIMIT 50;").map(toEvent);
    }
  };
}
