export function episodeKey(showSlug, seasonNumber, episodeNumber) {
  return `${showSlug}:s${String(seasonNumber).padStart(2, "0")}:e${String(episodeNumber).padStart(3, "0")}`;
}

export function compareEpisodes(left, right) {
  const showOrder = String(left.showSlug).localeCompare(String(right.showSlug));
  if (showOrder !== 0) {
    return showOrder;
  }

  const seasonOrder = Number(left.seasonNumber) - Number(right.seasonNumber);
  if (seasonOrder !== 0) {
    return seasonOrder;
  }

  return Number(left.episodeNumber) - Number(right.episodeNumber);
}

export function orderedEpisodes(episodes, showSlug = null) {
  return episodes
    .filter((episode) => !showSlug || episode.showSlug === showSlug)
    .slice()
    .sort(compareEpisodes);
}

export function nextEpisodeAfter(episodes, episodeId) {
  const current = episodes.find((episode) => episode.id === episodeId);
  if (!current) {
    return null;
  }

  const showEpisodes = orderedEpisodes(episodes, current.showSlug);
  const index = showEpisodes.findIndex((episode) => episode.id === episodeId);
  return index >= 0 ? showEpisodes[index + 1] ?? null : null;
}

export function previousEpisodeBefore(episodes, episodeId) {
  const current = episodes.find((episode) => episode.id === episodeId);
  if (!current) {
    return null;
  }

  const showEpisodes = orderedEpisodes(episodes, current.showSlug);
  const index = showEpisodes.findIndex((episode) => episode.id === episodeId);
  return index > 0 ? showEpisodes[index - 1] : null;
}

export function normalizeSeasonSelections(shows, selections = {}) {
  return Object.fromEntries(
    shows.map((show) => {
      const seasonNumbers = show.seasons
        .map((season) => Number(season.number))
        .filter((number) => Number.isFinite(number));
      const requested = Number(selections?.[show.slug]);
      const selected = seasonNumbers.includes(requested) ? requested : seasonNumbers[0] ?? null;
      return [show.slug, selected];
    })
  );
}

export function activeEpisodesForSettings({ shows, episodes, settings = {} }) {
  if (settings.seasonModelEnabled !== true) {
    return episodes.slice();
  }

  const selections = normalizeSeasonSelections(shows, settings.seasonSelections);
  return episodes.filter(
    (episode) => Number(episode.seasonNumber) === Number(selections[episode.showSlug])
  );
}

export function scopeProgressForSeasonModel({
  shows,
  episodes,
  progress,
  settings = {}
}) {
  if (settings.seasonModelEnabled !== true) {
    return { ...progress };
  }

  const activeIds = new Set(
    activeEpisodesForSettings({ shows, episodes, settings }).map((episode) => episode.id)
  );
  const firstActiveEpisodeByShow = new Map();
  const scoped = Object.fromEntries(
    Object.entries(progress).map(([episodeId, record]) => [
      episodeId,
      activeIds.has(episodeId)
        ? { ...record }
        : { ...record, status: "locked" }
    ])
  );

  for (const episode of orderedEpisodes(episodes)) {
    if (!activeIds.has(episode.id)) {
      continue;
    }
    if (!firstActiveEpisodeByShow.has(episode.showSlug)) {
      firstActiveEpisodeByShow.set(episode.showSlug, episode.id);
    }
  }

  for (const episodeId of firstActiveEpisodeByShow.values()) {
    if (scoped[episodeId]?.status === "locked") {
      scoped[episodeId] = {
        ...scoped[episodeId],
        status: "unlocked"
      };
    }
  }

  return scoped;
}

export function mergeScopedProgress({
  shows,
  episodes,
  rawProgress,
  scopedProgress,
  settings = {}
}) {
  if (settings.seasonModelEnabled !== true) {
    return { ...scopedProgress };
  }

  const activeIds = new Set(
    activeEpisodesForSettings({ shows, episodes, settings }).map((episode) => episode.id)
  );
  return Object.fromEntries(
    Object.entries(rawProgress).map(([episodeId, record]) => [
      episodeId,
      activeIds.has(episodeId) && scopedProgress[episodeId]
        ? scopedProgress[episodeId]
        : record
    ])
  );
}

export function normalizeShowOrder(shows, order = []) {
  const known = new Set(shows.map((show) => show.slug));
  const requested = Array.isArray(order) ? order.filter((slug) => known.has(slug)) : [];
  const seen = new Set();
  const ordered = [...requested, ...shows.map((show) => show.slug)].filter((slug) => {
    if (seen.has(slug)) {
      return false;
    }
    seen.add(slug);
    return true;
  });
  return ordered;
}

export function orderShows(shows, order = []) {
  const bySlug = new Map(shows.map((show) => [show.slug, show]));
  return normalizeShowOrder(shows, order).map((slug) => bySlug.get(slug));
}

export function buildCatalog(shows, episodes, progressRecords = [], settings = {}) {
  const progressById = scopeProgressForSeasonModel({
    shows,
    episodes,
    progress: Object.fromEntries(progressRecords.map((record) => [record.episodeId, record])),
    settings
  });

  return {
    shows: orderShows(shows, settings.showOrder).map((show) => ({
      ...show,
      seasons: show.seasons.map((season) => ({
        ...season,
        episodes: orderedEpisodes(episodes, show.slug)
          .filter((episode) => Number(episode.seasonNumber) === Number(season.number))
          .map((episode) => ({
            ...episode,
            progress: progressById[episode.id] ?? null
          }))
      }))
    }))
  };
}

export function allEpisodesFromCatalog(catalog) {
  return catalog.shows.flatMap((show) => show.seasons.flatMap((season) => season.episodes));
}
