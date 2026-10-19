// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.jsx";

const catalog = {
  shows: [
    {
      slug: "numberblocks",
      title: "Numberblocks",
      description: "Maths adventures",
      accent: "#d71920",
      seasons: [
        {
          number: 1,
          title: "Season 1",
          episodes: [
            {
              id: "numberblocks:s01:e001",
              showSlug: "numberblocks",
              seasonNumber: 1,
              episodeNumber: 1,
              title: "One",
              duration: "5:05",
              youtubeId: "jVeYnCehEFE",
              thumbnailUrl: "https://i.ytimg.com/vi/jVeYnCehEFE/hqdefault.jpg",
              progress: { status: "unlocked", positionSeconds: 0, watchedSeconds: 0, playCount: 0 }
            },
            {
              id: "numberblocks:s01:e002",
              showSlug: "numberblocks",
              seasonNumber: 1,
              episodeNumber: 2,
              title: "Another One",
              duration: "5:05",
              youtubeId: "bz2oWyDjgbc",
              thumbnailUrl: "https://i.ytimg.com/vi/bz2oWyDjgbc/hqdefault.jpg",
              progress: { status: "locked", positionSeconds: 0, watchedSeconds: 0, playCount: 0 }
            }
          ]
        }
      ]
    }
  ]
};

function catalogWithSecondSeason() {
  const nextCatalog = structuredClone(catalog);
  nextCatalog.shows[0].seasons.push({
    number: 2,
    title: "Season 2",
    episodes: [
      {
        id: "numberblocks:s02:e001",
        showSlug: "numberblocks",
        seasonNumber: 2,
        episodeNumber: 1,
        title: "Six",
        duration: "5:05",
        youtubeId: "six-video",
        thumbnailUrl: "https://i.ytimg.com/vi/six-video/hqdefault.jpg",
        progress: { status: "unlocked", positionSeconds: 0, watchedSeconds: 0, playCount: 0 }
      },
      {
        id: "numberblocks:s02:e002",
        showSlug: "numberblocks",
        seasonNumber: 2,
        episodeNumber: 2,
        title: "Seven",
        duration: "5:05",
        youtubeId: "seven-video",
        thumbnailUrl: "https://i.ytimg.com/vi/seven-video/hqdefault.jpg",
        progress: { status: "locked", positionSeconds: 0, watchedSeconds: 0, playCount: 0 }
      }
    ]
  });
  return nextCatalog;
}

describe("App", () => {
  function renderAt(path, api = { getCatalog: async () => catalog, getEvents: async () => ({ events: [] }) }) {
    window.history.pushState({}, "", path);
    return render(<App api={api} />);
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
    delete window.YT;
    delete window.__blocksTvYouTubeApi;
  });

  it("renders browse cards with locked and unlocked states", async () => {
    renderAt("/");

    expect(await screen.findByRole("button", { name: /watch S1 E1 One/i })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Suzy TV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /locked S1 E2 Another One/i })).toBeDisabled();
    expect(screen.getAllByText("Next up").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0/10 plays").length).toBeGreaterThan(0);
  });

  it("uses the family photo crop as the site logo", async () => {
    renderAt("/");

    const logo = await screen.findByRole("img", { name: "Suzy TV logo" });

    expect(logo).toHaveAttribute("src", "/logo-family.jpg");
  });

  it("switches to dark mode and remembers the choice", async () => {
    const firstRender = renderAt("/");
    const toggle = await screen.findByRole("button", { name: "Use dark mode" });

    fireEvent.click(toggle);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem("suzy-tv-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Use light mode" })).toHaveAttribute("aria-pressed", "true");

    firstRender.unmount();
    renderAt("/");

    expect(await screen.findByRole("button", { name: "Use light mode" })).toBeInTheDocument();
  });

  it("opens an unlocked episode in the watch view with a YouTube embed", async () => {
    renderAt("/");

    fireEvent.click(await screen.findByRole("button", { name: /watch S1 E1 One/i }));

    await waitFor(() => {
      expect(screen.getByTitle("One")).toHaveAttribute("src", expect.stringContaining("youtube.com/embed/jVeYnCehEFE"));
    });
    expect(screen.getByTitle("One")).toHaveAttribute("src", expect.stringContaining("controls=1"));
    expect(screen.getByTitle("One")).not.toHaveAttribute("src", expect.stringContaining("cc_load_policy"));
    expect(screen.getByTitle("One")).not.toHaveAttribute("src", expect.stringContaining("cc_lang_pref"));
    expect(screen.getByTitle("One")).not.toHaveAttribute("src", expect.stringContaining("autoplay=1"));
    expect(screen.getByTitle("One")).not.toHaveAttribute("src", expect.stringContaining("mute=1"));
    expect(window.location.pathname).toBe("/watch/numberblocks%3As01%3Ae001");
    expect(screen.queryByRole("button", { name: /back to browse/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /replay/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /browse next/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /unmute video/i })).not.toBeInTheDocument();
  });

  it("does not force YouTube subtitles when parent settings disable them", async () => {
    const api = {
      getCatalog: vi.fn().mockResolvedValue({ ...catalog, settings: { requiredPlayCount: 10, subtitlesEnabled: false } }),
      getEvents: async () => ({ events: [] })
    };

    renderAt("/watch/numberblocks%3As01%3Ae001", api);

    await waitFor(() => {
      expect(screen.getByTitle("One")).toHaveAttribute("src", expect.stringContaining("youtube.com/embed/jVeYnCehEFE"));
    });
    expect(screen.getByTitle("One")).not.toHaveAttribute("src", expect.stringContaining("cc_load_policy=1"));
    expect(screen.getByTitle("One")).not.toHaveAttribute("src", expect.stringContaining("cc_lang_pref=en"));
  });

  it("supports a direct admin URL", async () => {
    renderAt("/admin");

    expect(await screen.findByText("Parent Admin")).toBeInTheDocument();
    expect(screen.getByLabelText("Admin password")).toBeInTheDocument();
  });

  it("lets parents edit playback requirements", async () => {
    const api = {
      getCatalog: vi.fn().mockResolvedValue({
        ...catalog,
        settings: {
          requiredPlayCount: 10,
          subtitlesEnabled: true,
          seasonModelEnabled: false,
          seasonSelections: { numberblocks: 1 }
        }
      }),
      adminLogin: vi.fn().mockResolvedValue({ ok: true }),
      adminUpdateSettings: vi.fn().mockResolvedValue({ settings: { requiredPlayCount: 5, subtitlesEnabled: false } }),
      getEvents: async () => ({ events: [] })
    };

    renderAt("/admin", api);

    fireEvent.change(await screen.findByLabelText("Admin password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const playRequirement = await screen.findByLabelText("Plays to unlock");
    const subtitleToggle = screen.getByLabelText("Subtitles");
    expect(screen.queryByLabelText("Watch requirement (%)")).not.toBeInTheDocument();
    expect(playRequirement).toHaveValue(10);
    expect(subtitleToggle).toBeChecked();

    fireEvent.change(playRequirement, { target: { value: "5" } });
    fireEvent.click(subtitleToggle);
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(api.adminUpdateSettings).toHaveBeenCalledWith({
        requiredPlayCount: 5,
        subtitlesEnabled: false,
        seasonModelEnabled: false,
        seasonSelections: { numberblocks: 1 }
      });
    });
  });

  it("lets parents select a season in season model", async () => {
    const seasonCatalog = catalogWithSecondSeason();
    const api = {
      getCatalog: vi.fn().mockResolvedValue({
        ...seasonCatalog,
        settings: {
          requiredPlayCount: 10,
          subtitlesEnabled: true,
          seasonModelEnabled: false,
          seasonSelections: { numberblocks: 1 }
        }
      }),
      adminLogin: vi.fn().mockResolvedValue({ ok: true }),
      adminUpdateSettings: vi.fn().mockResolvedValue({}),
      getEvents: async () => ({ events: [] })
    };

    renderAt("/admin", api);
    fireEvent.change(await screen.findByLabelText("Admin password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const seasonToggle = await screen.findByLabelText("Season model");
    expect(seasonToggle).not.toBeChecked();
    fireEvent.click(seasonToggle);
    fireEvent.change(screen.getByLabelText("Numberblocks season"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(api.adminUpdateSettings).toHaveBeenCalledWith({
        requiredPlayCount: 10,
        subtitlesEnabled: true,
        seasonModelEnabled: true,
        seasonSelections: { numberblocks: 2 }
      });
    });
  });

  it("clears the selected season watch data from parent admin", async () => {
    const seasonCatalog = catalogWithSecondSeason();
    const api = {
      getCatalog: vi.fn().mockResolvedValue({
        ...seasonCatalog,
        settings: {
          requiredPlayCount: 10,
          subtitlesEnabled: true,
          seasonModelEnabled: true,
          seasonSelections: { numberblocks: 2 }
        }
      }),
      adminLogin: vi.fn().mockResolvedValue({ ok: true }),
      adminResetSeason: vi.fn().mockResolvedValue({}),
      getEvents: async () => ({ events: [] })
    };

    renderAt("/admin", api);
    fireEvent.change(await screen.findByLabelText("Admin password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const clearButton = await screen.findByRole("button", {
      name: /clear numberblocks season watch data/i
    });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(api.adminResetSeason).toHaveBeenCalledWith("numberblocks", 2);
    });
  });

  it("shows only the selected season to the child in season model", async () => {
    const seasonCatalog = catalogWithSecondSeason();
    const api = {
      getCatalog: vi.fn().mockResolvedValue({
        ...seasonCatalog,
        settings: {
          requiredPlayCount: 10,
          subtitlesEnabled: true,
          seasonModelEnabled: true,
          seasonSelections: { numberblocks: 2 }
        }
      }),
      getEvents: async () => ({ events: [] })
    };

    renderAt("/", api);

    expect(await screen.findByRole("button", { name: /watch S2 E1 Six/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /locked S2 E2 Seven/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /watch S1 E1 One/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /season 1/i })).not.toBeInTheDocument();
  });

  it("supports a direct watch URL", async () => {
    renderAt("/watch/numberblocks%3As01%3Ae001");

    await waitFor(() => {
      expect(screen.getByTitle("One")).toHaveAttribute("src", expect.stringContaining("youtube.com/embed/jVeYnCehEFE"));
    });
  });

  it("moves focus with TV remote arrow keys", async () => {
    renderAt("/");

    const showButton = await screen.findByRole("button", { name: /Numberblocks 1 seasons/i });
    const nextButton = screen.getByRole("button", { name: /^Watch$/i });
    const episodeButton = screen.getByRole("button", { name: /watch S1 E1 One/i });

    showButton.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 220,
      bottom: 56,
      width: 220,
      height: 56
    });
    nextButton.getBoundingClientRect = () => ({
      left: 300,
      top: 96,
      right: 420,
      bottom: 144,
      width: 120,
      height: 48
    });
    episodeButton.getBoundingClientRect = () => ({
      left: 0,
      top: 240,
      right: 220,
      bottom: 390,
      width: 220,
      height: 150
    });

    showButton.focus();
    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(nextButton).toHaveFocus();
    expect(nextButton).toHaveAttribute("data-remote-focused", "true");

    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(episodeButton).toHaveFocus();
    expect(nextButton).not.toHaveAttribute("data-remote-focused");
    expect(episodeButton).toHaveAttribute("data-remote-focused", "true");
  });

  it("starts remote focus on the primary browse action", async () => {
    renderAt("/");

    const adminButton = await screen.findByRole("button", { name: /Parent Admin/i });
    const showButton = screen.getByRole("button", { name: /Numberblocks 1 seasons/i });
    const nextButton = screen.getByRole("button", { name: /^Watch$/i });

    adminButton.getBoundingClientRect = () => ({
      left: 960,
      top: 0,
      right: 1120,
      bottom: 44,
      width: 160,
      height: 44
    });
    showButton.getBoundingClientRect = () => ({
      left: 0,
      top: 72,
      right: 220,
      bottom: 128,
      width: 220,
      height: 56
    });
    nextButton.getBoundingClientRect = () => ({
      left: 300,
      top: 168,
      right: 420,
      bottom: 216,
      width: 120,
      height: 48
    });

    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(nextButton).toHaveFocus();
    expect(nextButton).toHaveAttribute("data-remote-focused", "true");
  });

  it("activates the focused browse action with Android TV DPAD center", async () => {
    renderAt("/");

    const nextButton = await screen.findByRole("button", { name: /^Watch$/i });
    nextButton.focus();

    fireEvent.keyDown(window, { key: "Unidentified", keyCode: 23 });

    expect(window.location.pathname).toMatch(/^\/watch\//);
  });

  it("activates the focused browse action with gamepad-style OK key codes", async () => {
    renderAt("/");

    const nextButton = await screen.findByRole("button", { name: /^Watch$/i });
    nextButton.focus();

    fireEvent.keyDown(window, { key: "Unidentified", keyCode: 96 });

    expect(window.location.pathname).toMatch(/^\/watch\//);
  });

  it("counts and refreshes when playback starts", async () => {
    let playerEvents;
    const fakePlayer = {
      getCurrentTime: () => 0,
      getDuration: () => 305,
      destroy: vi.fn()
    };
    window.YT = {
      PlayerState: { PLAYING: 1, ENDED: 0, PAUSED: 2, BUFFERING: 3 },
      Player: vi.fn(function (_element, config) {
        playerEvents = config.events;
        return fakePlayer;
      })
    };

    const inProgressCatalog = structuredClone(catalog);
    inProgressCatalog.shows[0].seasons[0].episodes[0].progress = {
      status: "in_progress",
      positionSeconds: 0,
      watchedSeconds: 0,
      durationSeconds: 305
    };
    const completedCatalog = structuredClone(inProgressCatalog);
    completedCatalog.shows[0].seasons[0].episodes[0].progress.status = "in_progress";
    completedCatalog.shows[0].seasons[0].episodes[0].progress.playCount = 1;

    const api = {
      getCatalog: vi.fn().mockResolvedValueOnce(inProgressCatalog).mockResolvedValue(completedCatalog),
      saveProgress: vi.fn().mockResolvedValue({}),
      countPlayback: vi.fn().mockResolvedValue({ progress: completedCatalog.shows[0].seasons[0].episodes[0].progress }),
      getEvents: async () => ({ events: [] })
    };

    renderAt("/watch/numberblocks%3As01%3Ae001", api);

    await waitFor(() => {
      expect(window.YT.Player).toHaveBeenCalled();
    });

    await act(async () => {
      await playerEvents.onStateChange({ data: window.YT.PlayerState.PLAYING, target: fakePlayer });
    });

    await waitFor(() => {
      expect(api.countPlayback).toHaveBeenCalledWith(
        "numberblocks:s01:e001",
        expect.objectContaining({
          durationSeconds: 305,
          playerState: "playing",
          positionSeconds: 0,
          watchedSeconds: expect.any(Number)
        })
      );
    });
    expect(document.querySelector(".watch-top")).not.toBeInTheDocument();
    expect(document.querySelector(".watch-message")).not.toBeInTheDocument();
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Play 1 of 10 saved")).not.toBeInTheDocument();
  });

  it("uses the remote back key to leave watch mode", async () => {
    renderAt("/watch/numberblocks%3As01%3Ae001");

    await waitFor(() => {
      expect(screen.getByTitle("One")).toHaveAttribute("src", expect.stringContaining("youtube.com/embed/jVeYnCehEFE"));
    });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(window.location.pathname).toBe("/");
    expect(await screen.findByRole("button", { name: /watch S1 E1 One/i })).toBeInTheDocument();
  });

  it("keeps remote focus locked on the app play button and starts playback with DPAD center", async () => {
    const fakePlayer = {
      getCurrentTime: () => 0,
      getDuration: () => 305,
      playVideo: vi.fn(),
      seekTo: vi.fn(),
      destroy: vi.fn()
    };
    window.YT = {
      PlayerState: { PLAYING: 1, ENDED: 0, PAUSED: 2, BUFFERING: 3 },
      Player: vi.fn(function () {
        return fakePlayer;
      })
    };

    renderAt("/watch/numberblocks%3As01%3Ae001");

    await waitFor(() => {
      expect(window.YT.Player).toHaveBeenCalled();
    });

    const playButton = await screen.findByRole("button", { name: /play episode/i });
    await waitFor(() => {
      expect(playButton).toHaveFocus();
    });

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(playButton).toHaveFocus();

    fireEvent.keyDown(window, { key: "Unidentified", keyCode: 23 });

    expect(fakePlayer.playVideo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /play episode/i })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/watch/numberblocks%3As01%3Ae001");
  });

  it("hides the play overlay after DPAD center even while the YouTube player API is still loading", async () => {
    renderAt("/watch/numberblocks%3As01%3Ae001");

    const playButton = await screen.findByRole("button", { name: /play episode/i });
    await waitFor(() => {
      expect(playButton).toHaveFocus();
    });

    fireEvent.keyDown(window, { key: "Unidentified", keyCode: 23 });

    expect(await screen.findByText("Starting video...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /play episode/i })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("saves final progress before returning home after the episode ends", async () => {
    let playerEvents;
    let resolveSaveProgress;
    let endedWork;
    const fakePlayer = {
      getCurrentTime: () => 305,
      getDuration: () => 305,
      playVideo: vi.fn(),
      seekTo: vi.fn(),
      destroy: vi.fn()
    };
    window.YT = {
      PlayerState: { PLAYING: 1, ENDED: 0, PAUSED: 2, BUFFERING: 3 },
      Player: vi.fn(function (_element, config) {
        playerEvents = config.events;
        return fakePlayer;
      })
    };
    const updatedCatalog = structuredClone(catalog);
    updatedCatalog.shows[0].seasons[0].episodes[0].progress = {
      status: "in_progress",
      positionSeconds: 305,
      watchedSeconds: 305,
      durationSeconds: 305,
      playCount: 1
    };
    const saveProgress = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSaveProgress = resolve;
        })
    );
    const api = {
      getCatalog: vi.fn().mockResolvedValue(catalog),
      saveProgress,
      countPlayback: vi.fn().mockResolvedValue({}),
      getEvents: async () => ({ events: [] })
    };

    renderAt("/watch/numberblocks%3As01%3Ae001", api);

    await waitFor(() => {
      expect(window.YT.Player).toHaveBeenCalled();
    });

    fireEvent.keyDown(window, { key: "Unidentified", keyCode: 23 });

    expect(screen.queryByRole("button", { name: /play episode/i })).not.toBeInTheDocument();

    await act(async () => {
      endedWork = playerEvents.onStateChange({ data: window.YT.PlayerState.ENDED, target: fakePlayer });
      await Promise.resolve();
    });

    expect(saveProgress).toHaveBeenCalledWith(
      "numberblocks:s01:e001",
      expect.objectContaining({
        durationSeconds: 305,
        positionSeconds: 305
      })
    );
    expect(window.location.pathname).toBe("/watch/numberblocks%3As01%3Ae001");

    await act(async () => {
      resolveSaveProgress({ progress: updatedCatalog.shows[0].seasons[0].episodes[0].progress });
      await endedWork;
    });

    expect(api.countPlayback).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
    expect(await screen.findByRole("button", { name: /watch S1 E1 One/i })).toBeInTheDocument();
  });

  it("auto-starts the next episode after the final play unlocks it", async () => {
    let playerEvents;
    let currentTime = 0;
    const fakePlayer = {
      getCurrentTime: () => currentTime,
      getDuration: () => 305,
      playVideo: vi.fn(),
      seekTo: vi.fn(),
      destroy: vi.fn()
    };
    window.YT = {
      PlayerState: { PLAYING: 1, ENDED: 0, PAUSED: 2, BUFFERING: 3 },
      Player: vi.fn(function (_element, config) {
        playerEvents = config.events;
        return fakePlayer;
      })
    };

    const almostDoneCatalog = structuredClone(catalog);
    almostDoneCatalog.shows[0].seasons[0].episodes[0].progress.playCount = 9;
    const unlockedCatalog = structuredClone(almostDoneCatalog);
    unlockedCatalog.shows[0].seasons[0].episodes[0].progress = {
      status: "completed",
      positionSeconds: 305,
      watchedSeconds: 305,
      durationSeconds: 305,
      playCount: 10
    };
    unlockedCatalog.shows[0].seasons[0].episodes[1].progress.status = "unlocked";

    const api = {
      getCatalog: vi.fn().mockResolvedValueOnce(almostDoneCatalog).mockResolvedValue(unlockedCatalog),
      saveProgress: vi.fn().mockResolvedValue({
        progress: unlockedCatalog.shows[0].seasons[0].episodes[0].progress
      }),
      countPlayback: vi.fn().mockResolvedValue({
        progress: unlockedCatalog.shows[0].seasons[0].episodes[0].progress
      }),
      getEvents: async () => ({ events: [] })
    };

    renderAt("/watch/numberblocks%3As01%3Ae001", api);

    await waitFor(() => {
      expect(window.YT.Player).toHaveBeenCalled();
    });

    fireEvent.keyDown(window, { key: "Unidentified", keyCode: 23 });

    await act(async () => {
      await playerEvents.onStateChange({ data: window.YT.PlayerState.PLAYING, target: fakePlayer });
    });

    await waitFor(() => {
      expect(api.countPlayback).toHaveBeenCalledWith(
        "numberblocks:s01:e001",
        expect.objectContaining({
          playerState: "playing"
        })
      );
    });

    currentTime = 305;
    await act(async () => {
      await playerEvents.onStateChange({ data: window.YT.PlayerState.ENDED, target: fakePlayer });
    });

    expect(window.location.pathname).toBe("/watch/numberblocks%3As01%3Ae002");
    expect(await screen.findByTitle("Another One")).toHaveAttribute(
      "src",
      expect.stringContaining("youtube.com/embed/bz2oWyDjgbc")
    );
    await waitFor(() => {
      expect(fakePlayer.playVideo).toHaveBeenCalledTimes(2);
    });
  });

  it("loops to the first episode when the last episode of a season ends", async () => {
    let playerEvents;
    let currentTime = 0;
    const fakePlayer = {
      getCurrentTime: () => currentTime,
      getDuration: () => 305,
      playVideo: vi.fn(),
      seekTo: vi.fn(),
      destroy: vi.fn()
    };
    window.YT = {
      PlayerState: { PLAYING: 1, ENDED: 0, PAUSED: 2, BUFFERING: 3 },
      Player: vi.fn(function (_element, config) {
        playerEvents = config.events;
        return fakePlayer;
      })
    };

    const initialCatalog = catalogWithSecondSeason();
    initialCatalog.shows[0].seasons[0].episodes[1].progress.status = "unlocked";
    const finishedCatalog = structuredClone(initialCatalog);
    finishedCatalog.shows[0].seasons[0].episodes[1].progress = {
      status: "completed",
      positionSeconds: 305,
      watchedSeconds: 305,
      durationSeconds: 305,
      playCount: 10
    };

    const api = {
      getCatalog: vi.fn().mockResolvedValueOnce(initialCatalog).mockResolvedValue(finishedCatalog),
      saveProgress: vi.fn().mockResolvedValue({}),
      getEvents: async () => ({ events: [] })
    };

    renderAt("/watch/numberblocks%3As01%3Ae002", api);

    await waitFor(() => {
      expect(window.YT.Player).toHaveBeenCalled();
    });

    fireEvent.keyDown(window, { key: "Unidentified", keyCode: 23 });
    currentTime = 305;

    await act(async () => {
      await playerEvents.onStateChange({ data: window.YT.PlayerState.ENDED, target: fakePlayer });
    });

    expect(window.location.pathname).toBe("/watch/numberblocks%3As01%3Ae001");
    expect(await screen.findByTitle("One")).toHaveAttribute(
      "src",
      expect.stringContaining("youtube.com/embed/jVeYnCehEFE")
    );
    await waitFor(() => {
      expect(fakePlayer.playVideo).toHaveBeenCalledTimes(2);
    });
  });

  it("restores the play overlay when the start request does not begin playback", async () => {
    const fakePlayer = {
      getCurrentTime: () => 0,
      getDuration: () => 305,
      playVideo: vi.fn(),
      seekTo: vi.fn(),
      destroy: vi.fn()
    };
    window.YT = {
      PlayerState: { PLAYING: 1, ENDED: 0, PAUSED: 2, BUFFERING: 3 },
      Player: vi.fn(function () {
        return fakePlayer;
      })
    };

    renderAt("/watch/numberblocks%3As01%3Ae001");

    await waitFor(() => {
      expect(window.YT.Player).toHaveBeenCalled();
    });

    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: "Unidentified", keyCode: 23 });

    expect(screen.queryByRole("button", { name: /play episode/i })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });

    const playButton = screen.getByRole("button", { name: /play episode/i });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(playButton).toHaveFocus();
    expect(screen.getByText("Video did not start. Press OK to try again.")).toBeInTheDocument();
  });

  it("clears the starting message when player time advances without a PLAYING event", async () => {
    let currentTime = 0;
    const fakePlayer = {
      getCurrentTime: () => currentTime,
      getDuration: () => 305,
      playVideo: vi.fn(),
      seekTo: vi.fn(),
      destroy: vi.fn()
    };
    window.YT = {
      PlayerState: { PLAYING: 1, ENDED: 0, PAUSED: 2, BUFFERING: 3 },
      Player: vi.fn(function () {
        return fakePlayer;
      })
    };

    renderAt("/watch/numberblocks%3As01%3Ae001");

    await waitFor(() => {
      expect(window.YT.Player).toHaveBeenCalled();
    });

    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: "Unidentified", keyCode: 23 });
    currentTime = 2;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    expect(screen.queryByText("Starting video...")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /play episode/i })).not.toBeInTheDocument();
  });

  it("lets parents reorder show tabs with drag and drop or the move buttons", async () => {
    const twoShowCatalog = {
      shows: [
        catalog.shows[0],
        { ...catalog.shows[0], slug: "alphablocks", title: "Alphablocks", seasons: [] }
      ],
      settings: { requiredPlayCount: 10, seasonModelEnabled: false, seasonSelections: {} }
    };
    const api = {
      getCatalog: vi.fn().mockResolvedValue(twoShowCatalog),
      adminLogin: vi.fn().mockResolvedValue({ ok: true }),
      adminUpdateSettings: vi.fn().mockResolvedValue({}),
      getEvents: async () => ({ events: [] })
    };

    renderAt("/admin", api);
    fireEvent.change(await screen.findByLabelText("Admin password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const items = await screen.findAllByRole("listitem");
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(items[0], { dataTransfer });
    fireEvent.dragOver(items[1], { dataTransfer });
    fireEvent.drop(items[1], { dataTransfer });

    await waitFor(() => {
      expect(api.adminUpdateSettings).toHaveBeenCalledWith({ showOrder: ["alphablocks", "numberblocks"] });
    });

    expect(screen.getByRole("button", { name: "Move Numberblocks up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Alphablocks down" })).toBeDisabled();
    api.adminUpdateSettings.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Move Alphablocks up" }));
    await waitFor(() => {
      expect(api.adminUpdateSettings).toHaveBeenCalledWith({ showOrder: ["alphablocks", "numberblocks"] });
    });
  });
});
