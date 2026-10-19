import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Lock,
  Menu,
  Moon,
  Play,
  RotateCcw,
  Shield,
  Sun
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultApi } from "./api.js";
import { createPlaybackTracker } from "./lib/playbackTracker.js";
import {
  normalizeRequiredPlayCount,
  REQUIRED_PLAY_COUNT
} from "./lib/progressRules.js";
import { clearRemoteFocus, isTextEntryTarget, moveFocusByDirection } from "./lib/remoteNavigation.js";

const REMOTE_DIRECTIONS = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right"
};

const REMOTE_SELECT_KEYS = new Set(["Enter", "NumpadEnter", " "]);
const REMOTE_SELECT_KEY_CODES = new Set([13, 23, 66, 96, 109, 160]);
const REMOTE_BACK_KEYS = new Set(["Back", "BrowserBack", "Escape", "GoBack"]);
const PLAYBACK_START_TIMEOUT_MS = 8000;
const PLAYBACK_START_PROBE_MS = 1000;
const PLAYBACK_STARTED_DELTA_SECONDS = 0.5;
const THEME_STORAGE_KEY = "suzy-tv-theme";

function initialTheme() {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

function isRemoteBackEvent(event) {
  return REMOTE_BACK_KEYS.has(event.key) || event.keyCode === 10009;
}

function isRemoteSelectEvent(event) {
  return REMOTE_SELECT_KEYS.has(event.key) || REMOTE_SELECT_KEY_CODES.has(event.keyCode);
}

function focusWatchPlayer(root = document) {
  const player = root.querySelector("[data-remote-player-control='true']:not(:disabled)");
  if (!player || typeof player.focus !== "function") {
    return null;
  }

  clearRemoteFocus(root);
  player.setAttribute("data-remote-focused", "true");
  player.focus({ preventScroll: true });
  return player;
}

function episodeCode(episode) {
  return `S${episode.seasonNumber} E${episode.episodeNumber}`;
}

function episodePlayCount(episode) {
  const playCount = Number(episode.progress?.playCount ?? 0);
  return Number.isFinite(playCount) ? Math.max(0, Math.floor(playCount)) : 0;
}

function visiblePlayCount(episode, requiredPlayCount = REQUIRED_PLAY_COUNT) {
  return Math.min(normalizeRequiredPlayCount(requiredPlayCount), episodePlayCount(episode));
}

function playCountLabel(episode, requiredPlayCount = REQUIRED_PLAY_COUNT) {
  const requiredCount = normalizeRequiredPlayCount(requiredPlayCount);
  return `${visiblePlayCount(episode, requiredCount)}/${requiredCount} plays`;
}

function progressPercent(episode, requiredPlayCount = REQUIRED_PLAY_COUNT) {
  if (episode.progress?.status === "completed") {
    return 100;
  }
  const requiredCount = normalizeRequiredPlayCount(requiredPlayCount);
  return Math.round((visiblePlayCount(episode, requiredCount) / requiredCount) * 100);
}

function findEpisode(catalog, episodeId) {
  for (const show of catalog?.shows ?? []) {
    for (const season of show.seasons) {
      const episode = season.episodes.find((candidate) => candidate.id === episodeId);
      if (episode) {
        return { show, season, episode };
      }
    }
  }
  return null;
}

function nextPlayableEpisode(show, settings) {
  return visibleSeasonsForShow(show, settings)
    .flatMap((season) => season.episodes)
    .find((episode) => episode.progress?.status !== "completed" && episode.progress?.status !== "locked");
}

function nextUnlockedEpisodeAfter(catalog, episodeId) {
  const item = findEpisode(catalog, episodeId);
  if (!item) {
    return null;
  }

  const episodes = item.show.seasons.flatMap((season) => season.episodes);
  const currentIndex = episodes.findIndex((episode) => episode.id === episodeId);
  if (currentIndex < 0) {
    return null;
  }

  return episodes
    .slice(currentIndex + 1)
    .find((episode) => episode.progress?.status !== "locked") ?? null;
}

function subtitlesEnabledSetting(settings) {
  return settings?.subtitlesEnabled === true;
}

function seasonModelEnabledSetting(settings) {
  return settings?.seasonModelEnabled === true;
}

function seasonSelectionForShow(show, selections = {}) {
  const requested = Number(selections?.[show.slug]);
  return show.seasons.some((season) => Number(season.number) === requested)
    ? requested
    : show.seasons[0]?.number ?? null;
}

function seasonSelectionsForShows(shows, selections = {}) {
  return Object.fromEntries(
    shows.map((show) => [show.slug, seasonSelectionForShow(show, selections)])
  );
}

function visibleSeasonsForShow(show, settings) {
  if (!seasonModelEnabledSetting(settings)) {
    return show.seasons;
  }
  const selectedSeason = seasonSelectionForShow(show, settings?.seasonSelections);
  return show.seasons.filter((season) => Number(season.number) === Number(selectedSeason));
}

function watchUrl(episode, { subtitlesEnabled = false } = {}) {
  const origin = typeof window === "undefined" ? "http://localhost:8080" : window.location.origin;
  const params = new URLSearchParams({
    enablejsapi: "1",
    origin,
    controls: "1",
    iv_load_policy: "3",
    playsinline: "1",
    rel: "0",
    modestbranding: "1"
  });
  if (subtitlesEnabled) {
    params.set("cc_load_policy", "1");
    params.set("cc_lang_pref", "en");
  }
  return `https://www.youtube.com/embed/${episode.youtubeId}?${params.toString()}`;
}

function createPlaybackSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `playback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function routeFromLocation() {
  if (typeof window === "undefined") {
    return { mode: "browse", watchingId: null };
  }

  const pathname = window.location.pathname;
  if (pathname === "/admin") {
    return { mode: "admin", watchingId: null };
  }

  const watchMatch = pathname.match(/^\/watch\/([^/]+)$/);
  if (watchMatch) {
    return { mode: "watch", watchingId: decodeURIComponent(watchMatch[1]) };
  }

  return { mode: "browse", watchingId: null };
}

function pushPath(path) {
  if (typeof window !== "undefined" && window.location.pathname !== path) {
    window.history.pushState({}, "", path);
  }
}

function StatusPill({ status }) {
  if (status === "completed") {
    return (
      <span className="status-pill complete">
        <CheckCircle2 size={14} /> Watched
      </span>
    );
  }
  if (status === "locked") {
    return (
      <span className="status-pill locked">
        <Lock size={14} /> Locked
      </span>
    );
  }
  return <span className="status-pill next">Next up</span>;
}

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === "dark";

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={isDark ? "Use light mode" : "Use dark mode"}
      aria-pressed={isDark}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
      <span>{isDark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}

function EpisodeCard({ episode, requiredPlayCount, onWatch }) {
  const locked = episode.progress?.status === "locked";
  const status = episode.progress?.status ?? "locked";

  return (
    <button
      className={`episode-card ${locked ? "is-locked" : ""}`}
      type="button"
      disabled={locked}
      onClick={() => onWatch(episode.id)}
      aria-label={`${locked ? "Locked" : "Watch"} ${episodeCode(episode)} ${episode.title}`}
    >
      <span className="thumb-wrap">
        <img src={episode.thumbnailUrl} alt="" loading="lazy" />
        <span className="duration">{episode.duration ?? ""}</span>
        {locked ? (
          <span className="lock-screen">
            <Lock size={30} />
          </span>
        ) : (
          <span className="play-screen">
            <Play size={28} fill="currentColor" />
          </span>
        )}
      </span>
      <span className="episode-meta">
        <span className="episode-code">{episodeCode(episode)}</span>
        <span className="episode-title">{episode.title}</span>
        <StatusPill status={status} />
        <span className="play-count">{playCountLabel(episode, requiredPlayCount)}</span>
        <span className="progress-track" aria-hidden="true">
          <span style={{ width: `${progressPercent(episode, requiredPlayCount)}%` }} />
        </span>
      </span>
    </button>
  );
}

function BrowseView({ catalog, selectedShowSlug, selectedSeasonNumber, onShow, onSeason, onWatch, onAdmin, theme, onToggleTheme }) {
  const selectedShow = catalog.shows.find((show) => show.slug === selectedShowSlug) ?? catalog.shows[0];
  const visibleSeasons = visibleSeasonsForShow(selectedShow, catalog.settings);
  const selectedSeason =
    visibleSeasons.find((season) => Number(season.number) === Number(selectedSeasonNumber)) ??
    visibleSeasons[0] ??
    selectedShow.seasons[0];
  const nextUp = nextPlayableEpisode(selectedShow, catalog.settings);
  const requiredPlayCount = normalizeRequiredPlayCount(catalog.settings?.requiredPlayCount);

  return (
    <main className="browse-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <Menu size={24} />
          <img className="brand-photo-logo" src="/logo-family.jpg" alt="Suzy TV logo" />
          <h1>Suzy TV</h1>
        </div>
        <div className="topbar-actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="admin-button" type="button" onClick={onAdmin}>
            <Shield size={18} />
            <span>Parent Admin</span>
          </button>
        </div>
      </header>

      <section className="show-rail" aria-label="Shows">
        {catalog.shows.map((show) => (
          <button
            key={show.slug}
            className={show.slug === selectedShow.slug ? "show-chip active" : "show-chip"}
            type="button"
            style={{ "--accent": show.accent }}
            onClick={() => onShow(show.slug)}
          >
            <span>{show.title}</span>
            <small>
              {seasonModelEnabledSetting(catalog.settings)
                ? `Season ${seasonSelectionForShow(show, catalog.settings?.seasonSelections)} only`
                : `${show.seasons.length} seasons`}
            </small>
          </button>
        ))}
      </section>

      {nextUp ? (
        <section className="next-panel">
          <img className="next-thumb" src={nextUp.thumbnailUrl} alt="" />
          <div className="next-copy">
            <span className="section-label">Next up</span>
            <h2>{episodeCode(nextUp)} {nextUp.title}</h2>
            <p>
              {nextUp.duration} from the official {selectedShow.title} playlist · {playCountLabel(nextUp, requiredPlayCount)}
            </p>
          </div>
          <button type="button" data-remote-default="true" onClick={() => onWatch(nextUp.id)}>
            <Play size={18} fill="currentColor" /> Watch
          </button>
        </section>
      ) : null}

      <nav className="season-tabs" aria-label={`${selectedShow.title} seasons`}>
        {visibleSeasons.map((season) => (
          <button
            key={season.number}
            className={Number(season.number) === Number(selectedSeason.number) ? "active" : ""}
            type="button"
            onClick={() => onSeason(season.number)}
          >
            {season.title}
          </button>
        ))}
      </nav>

      <section className="season-heading">
        <div>
          <h2>{selectedSeason.title}</h2>
          <p>
            {selectedSeason.episodes.length} episodes from the official {selectedShow.title} playlist
          </p>
        </div>
      </section>

      <section className="episode-grid" aria-label={`${selectedShow.title} ${selectedSeason.title} episodes`}>
        {selectedSeason.episodes.map((episode) => (
          <EpisodeCard
            key={episode.id}
            episode={episode}
            requiredPlayCount={requiredPlayCount}
            onWatch={onWatch}
          />
        ))}
      </section>
    </main>
  );
}

function loadYouTubeApi() {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (window.__blocksTvYouTubeApi) {
    return window.__blocksTvYouTubeApi;
  }
  window.__blocksTvYouTubeApi = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return window.__blocksTvYouTubeApi;
}

function WatchView({ item, api, settings, autoStart = false, onBack, onPlaybackDone, onRefresh }) {
  const { episode } = item;
  const requiredPlayCount = normalizeRequiredPlayCount(settings?.requiredPlayCount);
  const iframeRef = useRef(null);
  const playerRef = useRef(null);
  const trackerRef = useRef(null);
  const trackerEpisodeRef = useRef(null);
  const completionRequestedRef = useRef(false);
  const pendingPlayRef = useRef(false);
  const sampleTimerRef = useRef(null);
  const startProbeTimerRef = useRef(null);
  const startTimeoutTimerRef = useRef(null);
  const startPositionRef = useRef(0);
  const startSamplingRef = useRef(null);
  const countPlaybackStartRef = useRef(null);
  const finalProgressSavedRef = useRef(false);
  const playbackSessionIdRef = useRef(null);
  const autoStartRequestedRef = useRef(false);
  const lastSyncRef = useRef(0);
  const playCountRef = useRef(episodePlayCount(episode));
  const [completed, setCompleted] = useState(episode.progress?.status === "completed");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackFinished, setPlaybackFinished] = useState(false);
  const [showPlayOverlay, setShowPlayOverlay] = useState(true);
  const [playCount, setPlayCount] = useState(episodePlayCount(episode));
  const [message, setMessage] = useState("");

  if (!trackerRef.current || trackerEpisodeRef.current !== episode.id) {
    trackerEpisodeRef.current = episode.id;
    completionRequestedRef.current = episode.progress?.status === "completed";
    trackerRef.current = createPlaybackTracker({
      initialWatchedSeconds: episode.progress?.watchedSeconds ?? 0
    });
  }

  useEffect(() => {
    if (!showPlayOverlay) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      focusWatchPlayer(document);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [episode.id, playbackFinished, showPlayOverlay]);

  useEffect(() => {
    finalProgressSavedRef.current = false;
    playbackSessionIdRef.current = null;
    autoStartRequestedRef.current = false;
    setShowPlayOverlay(true);
    setIsPlaying(false);
    setPlaybackFinished(false);
    setMessage("");
  }, [episode.id]);

  useEffect(() => {
    const nextPlayCount = episodePlayCount(episode);
    playCountRef.current = nextPlayCount;
    setPlayCount(nextPlayCount);
    setCompleted(episode.progress?.status === "completed");
  }, [episode]);

  function resetCurrentPlay() {
    trackerRef.current = createPlaybackTracker({ initialWatchedSeconds: 0 });
    completionRequestedRef.current = completed;
    lastSyncRef.current = 0;
  }

  function postYouTubeCommand(func, args = []) {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({
        event: "command",
        func,
        args
      }),
      "https://www.youtube.com"
    );
  }

  function clearStartWatchdog() {
    if (startProbeTimerRef.current) {
      window.clearInterval(startProbeTimerRef.current);
      startProbeTimerRef.current = null;
    }
    if (startTimeoutTimerRef.current) {
      window.clearTimeout(startTimeoutTimerRef.current);
      startTimeoutTimerRef.current = null;
    }
  }

  function markPlaybackStarted(player, positionSeconds = Number(player?.getCurrentTime?.() ?? 0)) {
    pendingPlayRef.current = false;
    clearStartWatchdog();
    setMessage("");
    setIsPlaying(true);
    setPlaybackFinished(false);
    setShowPlayOverlay(false);
    trackerRef.current.markPlaying({ now: Date.now(), positionSeconds });
    startSamplingRef.current?.(player);
    countPlaybackStartRef.current?.(player);
  }

  function restorePlayOverlayAfterStartFailure() {
    pendingPlayRef.current = false;
    clearStartWatchdog();
    setIsPlaying(false);
    setShowPlayOverlay(true);
    setMessage("Video did not start. Press OK to try again.");
    window.requestAnimationFrame(() => focusWatchPlayer(document));
  }

  function startPlaybackWatchdog() {
    clearStartWatchdog();
    startProbeTimerRef.current = window.setInterval(() => {
      if (!pendingPlayRef.current) {
        clearStartWatchdog();
        return;
      }

      const player = playerRef.current;
      player?.playVideo?.();
      postYouTubeCommand("playVideo");

      const position = Number(player?.getCurrentTime?.() ?? 0);
      if (
        Number.isFinite(position) &&
        position >= startPositionRef.current + PLAYBACK_STARTED_DELTA_SECONDS
      ) {
        markPlaybackStarted(player, position);
      }
    }, PLAYBACK_START_PROBE_MS);

    startTimeoutTimerRef.current = window.setTimeout(() => {
      if (pendingPlayRef.current) {
        restorePlayOverlayAfterStartFailure();
      }
    }, PLAYBACK_START_TIMEOUT_MS);
  }

  function playCurrentEpisode() {
    const player = playerRef.current;
    const duration = Number(player?.getDuration?.() ?? episode.durationSeconds ?? 0);
    const position = Number(player?.getCurrentTime?.() ?? 0);
    const shouldRestart = playbackFinished || (Number.isFinite(duration) && duration > 0 && position >= duration - 2);

    pendingPlayRef.current = true;
    finalProgressSavedRef.current = false;
    playbackSessionIdRef.current = createPlaybackSessionId();
    startPositionRef.current = Number.isFinite(position) ? position : 0;
    setShowPlayOverlay(false);
    setMessage("Starting video...");

    if (shouldRestart || position <= 1) {
      resetCurrentPlay();
    }

    if (shouldRestart) {
      player?.seekTo?.(0, true);
      postYouTubeCommand("seekTo", [0, true]);
    }

    player?.playVideo?.();
    postYouTubeCommand("playVideo");
    startPlaybackWatchdog();
  }

  useEffect(() => {
    if (!autoStart || autoStartRequestedRef.current) {
      return undefined;
    }

    autoStartRequestedRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      playCurrentEpisode();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoStart, episode.id]);

  useEffect(() => {
    let cancelled = false;

    function clearSampling() {
      if (sampleTimerRef.current) {
        window.clearInterval(sampleTimerRef.current);
        sampleTimerRef.current = null;
      }
    }

    function playerPayload(player, { now = Date.now(), stopped = false } = {}) {
      playbackSessionIdRef.current = playbackSessionIdRef.current ?? createPlaybackSessionId();
      const positionSeconds = Number(player.getCurrentTime?.() ?? 0);
      const durationSeconds = Number(player.getDuration?.() ?? episode.durationSeconds ?? 0);
      const sample = stopped
        ? trackerRef.current.markStopped({ now, positionSeconds })
        : trackerRef.current.sample({ now, positionSeconds });
      return {
        positionSeconds: sample.positionSeconds,
        watchedSeconds: sample.watchedSeconds,
        durationSeconds,
        playbackSessionId: playbackSessionIdRef.current
      };
    }

    async function applyCountedProgress(result) {
      const updatedProgress = result?.progress;
      if (!updatedProgress) {
        return false;
      }

      const previousPlayCount = playCountRef.current;
      const rawPlayCount = Number(updatedProgress.playCount ?? previousPlayCount);
      const nextPlayCount = Number.isFinite(rawPlayCount)
        ? Math.min(requiredPlayCount, Math.max(0, Math.floor(rawPlayCount)))
        : previousPlayCount;
      const nextCompleted = updatedProgress.status === "completed";
      const countedPlayback = nextPlayCount > previousPlayCount || nextCompleted;

      if (!countedPlayback) {
        return false;
      }

      playCountRef.current = nextPlayCount;
      setPlayCount(nextPlayCount);
      setCompleted(nextCompleted);
      setMessage(
        nextCompleted
          ? "Next episode unlocked"
          : `Play ${nextPlayCount} of ${requiredPlayCount} saved`
      );
      await onRefresh();
      return true;
    }

    async function countPlaybackStarted(player) {
      if (completionRequestedRef.current || !api.countPlayback) {
        return false;
      }

      completionRequestedRef.current = true;
      const payload = playerPayload(player);
      try {
        await applyCountedProgress(
          await api.countPlayback(episode.id, {
            ...payload,
            playerState: "playing"
          })
        );
        return true;
      } catch (error) {
        completionRequestedRef.current = false;
        setMessage(error.message);
        return false;
      }
    }

    async function syncProgress(player, { force = false, stopped = false, ignoreSaveErrors = true } = {}) {
      const now = Date.now();
      const payload = playerPayload(player, { now, stopped });
      if (force || now - lastSyncRef.current >= 10_000) {
        lastSyncRef.current = now;
        if (api.saveProgress) {
          const saveProgress = api.saveProgress(episode.id, payload);
          if (ignoreSaveErrors) {
            await saveProgress.catch(() => null);
          } else {
            await saveProgress;
          }
        }
      }
      return payload;
    }

    function startSampling(player) {
      clearSampling();
      sampleTimerRef.current = window.setInterval(() => {
        syncProgress(player).catch(() => {});
      }, 1000);
    }

    startSamplingRef.current = startSampling;
    countPlaybackStartRef.current = countPlaybackStarted;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !YT?.Player || !iframeRef.current) {
        return;
      }
      playerRef.current = new YT.Player(iframeRef.current, {
        events: {
          onReady: (event) => {
            if (pendingPlayRef.current) {
              event.target?.playVideo?.();
              postYouTubeCommand("playVideo");
            }
          },
          onStateChange: async (event) => {
            const player = event.target;
            const position = Number(player.getCurrentTime?.() ?? 0);

            if (event.data === YT.PlayerState.PLAYING) {
              markPlaybackStarted(player, position);
              return;
            }

            if (event.data === YT.PlayerState.ENDED) {
              clearStartWatchdog();
              clearSampling();
              pendingPlayRef.current = false;
              setIsPlaying(false);
              setPlaybackFinished(true);
              setShowPlayOverlay(true);
              try {
                await syncProgress(player, {
                  force: true,
                  stopped: true,
                  ignoreSaveErrors: false
                });
                finalProgressSavedRef.current = true;
                await onPlaybackDone(episode.id);
              } catch (error) {
                setMessage(error.message);
                window.requestAnimationFrame(() => focusWatchPlayer(document));
              }
              return;
            }

            if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.BUFFERING) {
              clearSampling();
              if (event.data === YT.PlayerState.PAUSED) {
                setIsPlaying(false);
                if (!pendingPlayRef.current) {
                  setShowPlayOverlay(true);
                }
              }
              await syncProgress(player, { force: true, stopped: true });
            }
          }
        }
      });
    });

    return () => {
      cancelled = true;
      clearStartWatchdog();
      clearSampling();
      startSamplingRef.current = null;
      countPlaybackStartRef.current = null;
      if (playerRef.current && !finalProgressSavedRef.current) {
        syncProgress(playerRef.current, { force: true, stopped: true }).catch(() => {});
      }
      playerRef.current?.destroy?.();
    };
  }, [api, episode.durationSeconds, episode.id, onPlaybackDone, onRefresh, requiredPlayCount]);

  return (
    <main className="watch-shell">
      <div className="watch-player-stage">
        <iframe
          ref={iframeRef}
          className="youtube-frame"
          title={episode.title}
          src={watchUrl(episode, { subtitlesEnabled: subtitlesEnabledSetting(settings) })}
          tabIndex={-1}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />

        {!isPlaying ? (
          <div className="watch-top">
            <div>
              <span>{episodeCode(episode)}</span>
              <h1>{episode.title}</h1>
            </div>
            <span className={completed ? "watch-state done" : "watch-state"}>
              {completed ? "Watched" : `${Math.min(playCount, requiredPlayCount)}/${requiredPlayCount} plays`}
            </span>
          </div>
        ) : null}

        {showPlayOverlay ? (
          <button
            className="player-play-button"
            type="button"
            aria-label="Play episode"
            data-remote-default="true"
            data-remote-player-control="true"
            onClick={playCurrentEpisode}
          >
            <Play size={34} fill="currentColor" />
            <span>{playbackFinished || playCount > 0 ? "Play again" : "Play"}</span>
          </button>
        ) : null}

        {message && !isPlaying ? <strong className="watch-message">{message}</strong> : null}
      </div>
    </main>
  );
}

function AdminPanel({ catalog, api, onBack, onRefresh, theme, onToggleTheme }) {
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedShow, setSelectedShow] = useState(catalog.shows[0]?.slug ?? "");
  const [requiredPlayCount, setRequiredPlayCount] = useState(
    normalizeRequiredPlayCount(catalog.settings?.requiredPlayCount)
  );
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(subtitlesEnabledSetting(catalog.settings));
  const [seasonModelEnabled, setSeasonModelEnabled] = useState(
    seasonModelEnabledSetting(catalog.settings)
  );
  const [seasonSelections, setSeasonSelections] = useState(() =>
    seasonSelectionsForShows(catalog.shows, catalog.settings?.seasonSelections)
  );
  const [dragSlug, setDragSlug] = useState(null);
  const [dropSlug, setDropSlug] = useState(null);
  const normalizedRequiredPlayCount = normalizeRequiredPlayCount(catalog.settings?.requiredPlayCount);
  const show = catalog.shows.find((candidate) => candidate.slug === selectedShow) ?? catalog.shows[0];
  const rows =
    show?.seasons
      .flatMap((season) => season.episodes)
      .filter(
        (episode) =>
          !seasonModelEnabled ||
          Number(episode.seasonNumber) === Number(seasonSelectionForShow(show, seasonSelections))
      ) ?? [];

  useEffect(() => {
    setRequiredPlayCount(normalizeRequiredPlayCount(catalog.settings?.requiredPlayCount));
    setSubtitlesEnabled(subtitlesEnabledSetting(catalog.settings));
    setSeasonModelEnabled(seasonModelEnabledSetting(catalog.settings));
    setSeasonSelections(seasonSelectionsForShows(catalog.shows, catalog.settings?.seasonSelections));
  }, [catalog.shows, catalog.settings]);

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.adminLogin?.(password);
      setLoggedIn(true);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  }

  async function setProgress(episode, status) {
    setBusy(true);
    setError("");
    try {
      await api.adminSetProgress?.({
        episodeId: episode.id,
        status,
        positionSeconds: status === "completed" ? episode.durationSeconds ?? 0 : 0,
        watchedSeconds: status === "completed" ? episode.durationSeconds ?? 0 : 0,
        durationSeconds: episode.durationSeconds
      });
      await onRefresh();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  }

  async function unlockThrough(episode) {
    setBusy(true);
    setError("");
    try {
      await api.adminUnlockThrough?.({
        showSlug: episode.showSlug,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber
      });
      await onRefresh();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  }

  async function resetShow() {
    setBusy(true);
    setError("");
    try {
      await api.adminResetShow?.(show.slug);
      await onRefresh();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  }

  async function resetSeason(seasonShow) {
    setBusy(true);
    setError("");
    try {
      await api.adminResetSeason?.(
        seasonShow.slug,
        seasonSelectionForShow(seasonShow, seasonSelections)
      );
      await onRefresh();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveShowOrder(slugs) {
    setBusy(true);
    setError("");
    try {
      await api.adminUpdateSettings?.({ showOrder: slugs });
      await onRefresh();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  }

  function moveShow(slug, targetSlug) {
    const slugs = catalog.shows.map((candidate) => candidate.slug);
    const from = slugs.indexOf(slug);
    const to = slugs.indexOf(targetSlug);
    if (from < 0 || to < 0 || from === to) {
      return;
    }
    slugs.splice(to, 0, slugs.splice(from, 1)[0]);
    saveShowOrder(slugs);
  }

  function endShowDrag() {
    setDragSlug(null);
    setDropSlug(null);
  }

  async function saveSettings(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.adminUpdateSettings?.({
        requiredPlayCount: normalizeRequiredPlayCount(requiredPlayCount),
        subtitlesEnabled,
        seasonModelEnabled,
        seasonSelections: seasonSelectionsForShows(catalog.shows, seasonSelections)
      });
      await onRefresh();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <button type="button" onClick={onBack} aria-label="Back to browse">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1>Parent Admin</h1>
          <p>Edit watch progress without touching the database.</p>
        </div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </header>

      {!loggedIn ? (
        <form className="login-panel" onSubmit={login}>
          <label>
            Admin password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
          </label>
          <button type="submit" disabled={busy}>
            Sign in
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      ) : (
        <>
          <form className="settings-panel" onSubmit={saveSettings}>
            <label>
              Plays to unlock
              <input
                type="number"
                min="1"
                max="100"
                value={requiredPlayCount}
                onChange={(event) => setRequiredPlayCount(event.target.value)}
              />
            </label>
            <label className="checkbox-setting">
              <input
                type="checkbox"
                checked={subtitlesEnabled}
                onChange={(event) => setSubtitlesEnabled(event.target.checked)}
              />
              <span>Subtitles</span>
            </label>
            <label className="checkbox-setting">
              <input
                type="checkbox"
                checked={seasonModelEnabled}
                onChange={(event) => setSeasonModelEnabled(event.target.checked)}
              />
              <span>Season model</span>
            </label>
            <button type="submit" disabled={busy}>
              Save settings
            </button>
            {seasonModelEnabled ? (
              <div className="season-model-settings">
                <div className="season-model-heading">
                  <strong>Playable season</strong>
                  <span>Each show starts at episode 1 of its selected season.</span>
                </div>
                {catalog.shows.map((candidate) => (
                  <div className="season-model-row" key={candidate.slug}>
                    <label>
                      <span>{candidate.title} season</span>
                      <select
                        aria-label={`${candidate.title} season`}
                        value={seasonSelectionForShow(candidate, seasonSelections)}
                        onChange={(event) =>
                          setSeasonSelections((current) => ({
                            ...current,
                            [candidate.slug]: Number(event.target.value)
                          }))
                        }
                      >
                        {candidate.seasons.map((season) => (
                          <option key={season.number} value={season.number}>
                            {season.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondary-action"
                      aria-label={`Clear ${candidate.title} season watch data`}
                      onClick={() => resetSeason(candidate)}
                      disabled={busy}
                    >
                      <RotateCcw size={16} />
                      <span>Clear season data</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </form>
          <section className="show-order-panel" aria-label="Show tab order">
            <div className="season-model-heading">
              <strong>Show tab order</strong>
              <span>Drag a show to rearrange the tabs on the browse page.</span>
            </div>
            <ol className="show-order-list">
              {catalog.shows.map((candidate, index) => (
                <li
                  key={candidate.slug}
                  className={[
                    "show-order-item",
                    dragSlug === candidate.slug ? "dragging" : "",
                    dropSlug === candidate.slug && dragSlug !== candidate.slug ? "drop-target" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-slug={candidate.slug}
                  style={{ "--accent": candidate.accent }}
                  draggable={!busy}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", candidate.slug);
                    setDragSlug(candidate.slug);
                  }}
                  onDragOver={(event) => {
                    if (dragSlug) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropSlug(candidate.slug);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const slug = dragSlug ?? event.dataTransfer.getData("text/plain");
                    endShowDrag();
                    moveShow(slug, candidate.slug);
                  }}
                  onDragEnd={endShowDrag}
                >
                  <GripVertical size={18} aria-hidden="true" />
                  <span className="show-order-title">{candidate.title}</span>
                  <button
                    type="button"
                    className="secondary-action"
                    aria-label={`Move ${candidate.title} up`}
                    disabled={busy || index === 0}
                    onClick={() => moveShow(candidate.slug, catalog.shows[index - 1].slug)}
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    aria-label={`Move ${candidate.title} down`}
                    disabled={busy || index === catalog.shows.length - 1}
                    onClick={() => moveShow(candidate.slug, catalog.shows[index + 1].slug)}
                  >
                    <ChevronDown size={16} />
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <div className="admin-tools">
            <select value={selectedShow} onChange={(event) => setSelectedShow(event.target.value)}>
              {catalog.shows.map((candidate) => (
                <option key={candidate.slug} value={candidate.slug}>
                  {candidate.title}
                </option>
              ))}
            </select>
            <button type="button" onClick={resetShow} disabled={busy}>
              Reset show
            </button>
            {error ? <span className="error">{error}</span> : null}
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Episode</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((episode) => (
                  <tr key={episode.id}>
                    <td>{episodeCode(episode)}</td>
                    <td>{episode.title}</td>
                    <td>{episode.progress?.status}</td>
                    <td>{playCountLabel(episode, normalizedRequiredPlayCount)}</td>
                    <td>
                      <button type="button" onClick={() => setProgress(episode, "completed")} disabled={busy}>
                        Complete
                      </button>
                      <button type="button" onClick={() => setProgress(episode, "unlocked")} disabled={busy}>
                        Unlock
                      </button>
                      <button type="button" onClick={() => unlockThrough(episode)} disabled={busy}>
                        Unlock through
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

export default function App({ api = defaultApi }) {
  const initialRoute = routeFromLocation();
  const [catalog, setCatalog] = useState(null);
  const [mode, setMode] = useState(initialRoute.mode);
  const [watchingId, setWatchingId] = useState(initialRoute.watchingId);
  const [autoStartWatchingId, setAutoStartWatchingId] = useState(null);
  const [autoStartRequestId, setAutoStartRequestId] = useState(0);
  const [selectedShowSlug, setSelectedShowSlug] = useState(null);
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState(null);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const refresh = useCallback(async () => {
    const nextCatalog = await api.getCatalog();
    setCatalog(nextCatalog);
    setSelectedShowSlug((current) => current ?? nextCatalog.shows[0]?.slug ?? null);
    setSelectedSeasonNumber((current) => current ?? nextCatalog.shows[0]?.seasons[0]?.number ?? null);
    return nextCatalog;
  }, [api]);

  useEffect(() => {
    refresh().catch((loadError) => setError(loadError.message));
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    function handlePopState() {
      const route = routeFromLocation();
      setMode(route.mode);
      setWatchingId(route.watchingId);
      setAutoStartWatchingId(null);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigateBrowse = useCallback(() => {
    pushPath("/");
    setWatchingId(null);
    setAutoStartWatchingId(null);
    setMode("browse");
  }, []);

  const navigateAdmin = useCallback(() => {
    pushPath("/admin");
    setWatchingId(null);
    setAutoStartWatchingId(null);
    setMode("admin");
  }, []);

  const navigateWatch = useCallback((episodeId, { autoStart = false } = {}) => {
    pushPath(`/watch/${encodeURIComponent(episodeId)}`);
    setWatchingId(episodeId);
    setAutoStartWatchingId(autoStart ? episodeId : null);
    if (autoStart) {
      setAutoStartRequestId((current) => current + 1);
    }
    setMode("watch");
  }, []);

  const navigateAfterPlaybackDone = useCallback(async (episodeId) => {
    const nextCatalog = await refresh();
    const currentItem = findEpisode(nextCatalog, episodeId);
    const seasonEpisodes = currentItem?.season?.episodes ?? [];
    const lastSeasonEpisode = seasonEpisodes[seasonEpisodes.length - 1];
    if (lastSeasonEpisode?.id === episodeId && seasonEpisodes[0]) {
      navigateWatch(seasonEpisodes[0].id, { autoStart: true });
      return;
    }

    const nextEpisode = nextUnlockedEpisodeAfter(nextCatalog, episodeId);
    if (nextEpisode) {
      navigateWatch(nextEpisode.id, { autoStart: true });
      return;
    }
    navigateBrowse();
  }, [navigateBrowse, navigateWatch, refresh]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    function handleRemoteKey(event) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTextEntryTarget(event.target)) {
        return;
      }

      const direction = REMOTE_DIRECTIONS[event.key];
      if (mode === "watch" && direction) {
        event.preventDefault();
        focusWatchPlayer(document);
        return;
      }

      if (direction) {
        event.preventDefault();
        moveFocusByDirection(direction, document);
        return;
      }

      if (isRemoteSelectEvent(event)) {
        const active = document.activeElement;
        if (mode === "watch") {
          event.preventDefault();
          const control = active?.matches?.("[data-remote-player-control='true']")
            ? active
            : focusWatchPlayer(document);
          control?.click?.();
          return;
        }

        if (active && active !== document.body && active.tagName.toLowerCase() !== "iframe" && typeof active.click === "function") {
          event.preventDefault();
          active.click();
        }
        return;
      }

      if (isRemoteBackEvent(event) && mode !== "browse") {
        event.preventDefault();
        navigateBrowse();
      }
    }

    function handlePointerDown() {
      clearRemoteFocus(document);
    }

    window.addEventListener("keydown", handleRemoteKey);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleRemoteKey);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [mode, navigateBrowse]);

  const watchItem = useMemo(() => findEpisode(catalog, watchingId), [catalog, watchingId]);

  if (error) {
    return (
      <main className="empty-state">
        <h1>Suzy TV</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!catalog) {
    return (
      <main className="empty-state">
        <h1>Suzy TV</h1>
        <p>Loading official episodes...</p>
      </main>
    );
  }

  if (mode === "watch" && watchItem && watchItem.episode.progress?.status !== "locked") {
    return (
      <WatchView
        key={`${watchItem.episode.id}:${autoStartRequestId}`}
        item={watchItem}
        api={api}
        settings={catalog.settings}
        autoStart={autoStartWatchingId === watchItem.episode.id}
        onBack={navigateBrowse}
        onPlaybackDone={navigateAfterPlaybackDone}
        onRefresh={refresh}
      />
    );
  }

  if (mode === "admin") {
    return <AdminPanel catalog={catalog} api={api} onBack={navigateBrowse} onRefresh={refresh} theme={theme} onToggleTheme={toggleTheme} />;
  }

  return (
    <BrowseView
      catalog={catalog}
      selectedShowSlug={selectedShowSlug ?? catalog.shows[0]?.slug}
      selectedSeasonNumber={selectedSeasonNumber ?? catalog.shows[0]?.seasons[0]?.number}
      onShow={(slug) => {
        const show = catalog.shows.find((candidate) => candidate.slug === slug);
        setSelectedShowSlug(slug);
        setSelectedSeasonNumber(show?.seasons[0]?.number ?? 1);
      }}
      onSeason={setSelectedSeasonNumber}
      onWatch={navigateWatch}
      onAdmin={navigateAdmin}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}
