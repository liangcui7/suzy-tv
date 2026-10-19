import express from "express";
import { adminCookie, adminToken, isAdminRequest } from "./auth.js";
import { createVideoStore } from "./videoStore.js";

function asyncRoute(handler) {
  return async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      response.status(400).json({ error: error.message || "Something went wrong." });
    }
  };
}

function requireAdmin(config) {
  return (request, response, next) => {
    if (!isAdminRequest(request, config)) {
      response.status(401).json({ error: "Admin login required." });
      return;
    }
    next();
  };
}

function playbackSessionIdFromBody(body) {
  return typeof body.playbackSessionId === "string" && body.playbackSessionId.trim()
    ? body.playbackSessionId.trim()
    : null;
}

export async function createVideoApp({
  dbPath,
  shows,
  episodes,
  adminPassword = "change-me",
  sessionSecret = "development-secret",
  staticDir = null
}) {
  const app = express();
  const store = await createVideoStore({ dbPath, shows, episodes });
  const authConfig = { adminPassword, sessionSecret };

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true, service: "video" });
  });

  app.get(
    "/api/catalog",
    asyncRoute(async (_request, response) => {
      response.json(await store.getCatalog());
    })
  );

  app.get(
    "/api/progress",
    asyncRoute(async (_request, response) => {
      response.json({ progress: await store.getProgress() });
    })
  );

  app.get(
    "/api/next",
    asyncRoute(async (_request, response) => {
      response.json(await store.getNext());
    })
  );

  app.post(
    "/api/progress/:episodeId",
    asyncRoute(async (request, response) => {
      const record = await store.updateProgress({
        episodeId: request.params.episodeId,
        positionSeconds: request.body.positionSeconds,
        watchedSeconds: request.body.watchedSeconds,
        durationSeconds: request.body.durationSeconds
      });
      response.json({ progress: record });
    })
  );

  app.post(
    "/api/progress/:episodeId/play",
    asyncRoute(async (request, response) => {
      const record = await store.completeEpisode({
        episodeId: request.params.episodeId,
        positionSeconds: request.body.positionSeconds,
        watchedSeconds: request.body.watchedSeconds,
        durationSeconds: request.body.durationSeconds,
        playbackSessionId: playbackSessionIdFromBody(request.body)
      });
      response.json({ progress: record, catalog: await store.getCatalog() });
    })
  );

  app.post(
    "/api/progress/:episodeId/complete",
    asyncRoute(async (request, response) => {
      const record = await store.completeEpisode({
        episodeId: request.params.episodeId,
        positionSeconds: request.body.positionSeconds,
        watchedSeconds: request.body.watchedSeconds,
        durationSeconds: request.body.durationSeconds,
        playbackSessionId: playbackSessionIdFromBody(request.body)
      });
      response.json({ progress: record, catalog: await store.getCatalog() });
    })
  );

  app.post(
    "/api/admin/login",
    asyncRoute(async (request, response) => {
      if (request.body.password !== adminPassword) {
        response.status(401).json({ error: "Incorrect password." });
        return;
      }

      response.setHeader("Set-Cookie", adminCookie(request, adminToken(adminPassword, sessionSecret)));
      response.json({ ok: true });
    })
  );

  app.post(
    "/api/admin/progress",
    requireAdmin(authConfig),
    asyncRoute(async (request, response) => {
      response.json({
        progress: await store.adminSetProgress({
          episodeId: request.body.episodeId,
          status: request.body.status,
          positionSeconds: request.body.positionSeconds,
          watchedSeconds: request.body.watchedSeconds,
          durationSeconds: request.body.durationSeconds,
          playCount: request.body.playCount
        })
      });
    })
  );

  app.post(
    "/api/admin/settings",
    requireAdmin(authConfig),
    asyncRoute(async (request, response) => {
      response.json({
        settings: await store.updateSettings({
          requiredPlayCount: request.body.requiredPlayCount,
          subtitlesEnabled: request.body.subtitlesEnabled,
          seasonModelEnabled: request.body.seasonModelEnabled,
          seasonSelections: request.body.seasonSelections,
          showOrder: request.body.showOrder
        })
      });
    })
  );

  app.post(
    "/api/admin/unlock-through",
    requireAdmin(authConfig),
    asyncRoute(async (request, response) => {
      await store.unlockThrough({
        showSlug: request.body.showSlug,
        seasonNumber: request.body.seasonNumber,
        episodeNumber: request.body.episodeNumber
      });
      response.json({ catalog: await store.getCatalog(), events: await store.getAdminEvents() });
    })
  );

  app.post(
    "/api/admin/reset-season",
    requireAdmin(authConfig),
    asyncRoute(async (request, response) => {
      await store.resetSeason({
        showSlug: request.body.showSlug,
        seasonNumber: request.body.seasonNumber
      });
      response.json({ catalog: await store.getCatalog(), events: await store.getAdminEvents() });
    })
  );

  app.post(
    "/api/admin/reset-show",
    requireAdmin(authConfig),
    asyncRoute(async (request, response) => {
      await store.resetShow({ showSlug: request.body.showSlug });
      response.json({ catalog: await store.getCatalog(), events: await store.getAdminEvents() });
    })
  );

  app.get(
    "/api/admin/events",
    requireAdmin(authConfig),
    asyncRoute(async (_request, response) => {
      response.json({ events: await store.getAdminEvents() });
    })
  );

  if (staticDir) {
    app.use(express.static(staticDir));
    app.get("*", (_request, response) => {
      response.sendFile("index.html", { root: staticDir });
    });
  }

  return app;
}
