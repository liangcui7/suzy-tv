async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

export const defaultApi = {
  getCatalog() {
    return requestJson("/api/catalog");
  },
  getProgress() {
    return requestJson("/api/progress");
  },
  getEvents() {
    return requestJson("/api/admin/events");
  },
  saveProgress(episodeId, payload) {
    return requestJson(`/api/progress/${encodeURIComponent(episodeId)}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  countPlayback(episodeId, payload) {
    return requestJson(`/api/progress/${encodeURIComponent(episodeId)}/play`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  completeEpisode(episodeId, payload) {
    return requestJson(`/api/progress/${encodeURIComponent(episodeId)}/complete`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  adminLogin(password) {
    return requestJson("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password })
    });
  },
  adminSetProgress(payload) {
    return requestJson("/api/admin/progress", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  adminUpdateSettings(payload) {
    return requestJson("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  adminUnlockThrough(payload) {
    return requestJson("/api/admin/unlock-through", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  adminResetShow(showSlug) {
    return requestJson("/api/admin/reset-show", {
      method: "POST",
      body: JSON.stringify({ showSlug })
    });
  },
  adminResetSeason(showSlug, seasonNumber) {
    return requestJson("/api/admin/reset-season", {
      method: "POST",
      body: JSON.stringify({ showSlug, seasonNumber })
    });
  }
};
