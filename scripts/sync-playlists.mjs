import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { episodeKey } from "../src/lib/catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const showsPath = path.join(rootDir, "src/content/shows.json");
const episodesPath = path.join(rootDir, "src/content/episodes.json");

function walk(value, visit) {
  if (!value || typeof value !== "object") {
    return;
  }

  visit(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visit);
    }
    return;
  }

  for (const item of Object.values(value)) {
    walk(item, visit);
  }
}

function initialDataFromHtml(html) {
  const match =
    html.match(/var ytInitialData = (\{.*?\});<\/script>/s) ||
    html.match(/window\["ytInitialData"\] = (\{.*?\});/s);
  if (!match) {
    throw new Error("Could not find ytInitialData in playlist page.");
  }
  return JSON.parse(match[1]);
}

function metadataFromLockup(lockup) {
  const title = lockup.metadata?.lockupMetadataViewModel?.title?.content ?? "";
  const badges = lockup.contentImage?.thumbnailViewModel?.overlays?.flatMap(
    (overlay) => overlay.thumbnailBottomOverlayViewModel?.badges ?? []
  ) ?? [];
  const duration = badges
    .map((badge) => badge.thumbnailBadgeViewModel?.text)
    .find((text) => typeof text === "string" && /^\d+:\d{2}(?::\d{2})?$/.test(text));

  return {
    videoId: lockup.contentId,
    title,
    duration
  };
}

function collectVideosAndContinuations(data) {
  const videos = [];
  const continuations = [];

  walk(data, (node) => {
    const lockup = node.lockupViewModel;
    if (lockup?.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && lockup.contentId) {
      videos.push(metadataFromLockup(lockup));
    }

    const token = node.continuationCommand?.token;
    if (token && !continuations.includes(token)) {
      continuations.push(token);
    }
  });

  return { videos, continuations };
}

function youtubeConfigFromHtml(html) {
  return {
    apiKey: html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1],
    clientVersion: html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? "2.20260630.03.00"
  };
}

async function fetchJsonContinuation(token, config) {
  const response = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${config.apiKey}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0"
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB",
          clientVersion: config.clientVersion
        }
      },
      continuation: token
    })
  });

  if (!response.ok) {
    throw new Error(`Continuation request failed: ${response.status}`);
  }

  return response.json();
}

function durationToSeconds(duration) {
  if (!duration) {
    return null;
  }
  return duration
    .split(":")
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}

function playerResponseFromHtml(html) {
  const marker = "var ytInitialPlayerResponse = ";
  const start = html.indexOf(marker);
  const end = html.indexOf(";</script>", start);
  if (start < 0 || end <= start) {
    throw new Error("Could not find ytInitialPlayerResponse in video page.");
  }
  return JSON.parse(html.slice(start + marker.length, end));
}

async function fetchVideoMetadata(videoId) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "user-agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Video ${videoId} failed: ${response.status}`);
  }

  const playerResponse = playerResponseFromHtml(await response.text());
  const details = playerResponse.videoDetails ?? {};
  if (!details.videoId || !details.title) {
    throw new Error(`Video ${videoId} returned no metadata.`);
  }

  const durationSeconds = Number(details.lengthSeconds);
  const duration = Number.isFinite(durationSeconds)
    ? [
        Math.floor(durationSeconds / 3600),
        Math.floor((durationSeconds % 3600) / 60),
        durationSeconds % 60
      ]
        .slice(durationSeconds >= 3600 ? 0 : 1)
        .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
        .join(":")
    : null;

  return {
    videoId,
    title: details.title,
    duration
  };
}

function babySharkTitle(rawTitle) {
  if (!/Baby Shark|Pinkfong/i.test(rawTitle) || !rawTitle.includes("|")) {
    return rawTitle;
  }
  const letter = rawTitle.match(/\bAlphabet ([A-Z])\b/)?.[1];
  if (letter && /Learn ABCs? with Baby Shark!/i.test(rawTitle)) {
    return `Alphabet ${letter}`;
  }
  return rawTitle.split("|")[0].replace(/\s*@PinkfongDinosaurs\b/i, "");
}

export function displayTitle(rawTitle) {
  return babySharkTitle(rawTitle)
    .replace(/\s*\|\s*Full Episode.*$/i, "")
    .replace(/\s*\|\s*S\d+\s*E\d+.*$/i, "")
    .replace(/\s*\|\s*E\d+\s*S\d+.*$/i, "")
    .replace(/\s*-\s*FULL EPISODE.*$/i, "")
    .replace(/\s*\|\s*Alphablocks.*$/i, "")
    .replace(/\s*\|\s*Numberblocks.*$/i, "")
    .replace(/\s*\|\s*Colourblocks.*$/i, "")
    .replace(/\s*\|\s*Wonderblocks.*$/i, "")
    .replace(/\s*[|｜]\s*(?:学中文|Learn Chinese).*$/i, "")
    .replace(/\s*Educational Videos for Kids.*$/i, "")
    .replace(/\s*📚\s*Learn With Peppa Pig.*$/i, "")
    .replace(/\s*[|]\s*Peppa Pig Official.*$/i, "")
    .replace(/\s*[|]\s*Nursery Rhymes.*$/i, "")
    .replace(/\s*[|]\s*@PeppaPigOfficial.*$/i, "")
    .replace(/\s*[|]\s*Peppa Pig Educational Videos.*$/i, "")
    .replace(/\s*[|].*Family Kids Cartoon.*$/i, "")
    .replace(/\s*Nursery Rhymes.*$/i, "")
    .replace(/^Peppa Pig Episodes\s*-\s*/i, "")
    .replace(/^Peppa Pig\s*-\s*/i, "")
    .trim();
}

async function fetchPlaylistVideos(playlistId, fallbackVideoIds = [], { preferVideoIds = false } = {}) {
  if (preferVideoIds && fallbackVideoIds.length > 0) {
    return Promise.all(fallbackVideoIds.map((videoId) => fetchVideoMetadata(videoId)));
  }

  const response = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`, {
    headers: {
      "user-agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Playlist ${playlistId} failed: ${response.status}`);
  }

  const html = await response.text();
  const config = youtubeConfigFromHtml(html);
  const seenContinuations = new Set();
  const seenVideos = new Set();
  const queue = [];
  const videos = [];

  function addData(data) {
    const collected = collectVideosAndContinuations(data);
    for (const video of collected.videos) {
      if (!seenVideos.has(video.videoId)) {
        seenVideos.add(video.videoId);
        videos.push(video);
      }
    }
    for (const token of collected.continuations) {
      if (!seenContinuations.has(token)) {
        queue.push(token);
      }
    }
  }

  addData(initialDataFromHtml(html));

  while (config.apiKey && queue.length > 0) {
    const token = queue.shift();
    if (seenContinuations.has(token)) {
      continue;
    }
    seenContinuations.add(token);
    addData(await fetchJsonContinuation(token, config));
  }

  if (videos.length > 0 || fallbackVideoIds.length === 0) {
    return videos;
  }

  return Promise.all(fallbackVideoIds.map((videoId) => fetchVideoMetadata(videoId)));
}

async function main() {
  const shows = JSON.parse(await fs.readFile(showsPath, "utf8"));
  const episodes = [];

  for (const show of shows) {
    for (const season of show.seasons) {
      const videos = await fetchPlaylistVideos(season.playlistId, season.videoIds, {
        preferVideoIds: season.curated === true
      });
      if (videos.length === 0) {
        throw new Error(`Playlist ${season.playlistId} returned no videos.`);
      }

      videos.forEach((video, index) => {
        const episodeNumber = index + 1;
        episodes.push({
          id: episodeKey(show.slug, season.number, episodeNumber),
          showSlug: show.slug,
          seasonNumber: season.number,
          episodeNumber,
          playlistId: season.playlistId,
          playlistIndex: episodeNumber,
          youtubeId: video.videoId,
          title: displayTitle(video.title),
          youtubeTitle: video.title,
          duration: video.duration ?? null,
          durationSeconds: durationToSeconds(video.duration),
          thumbnailUrl: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
          sourceUrl: season.curated === true
            ? `https://www.youtube.com/watch?v=${video.videoId}`
            : `https://www.youtube.com/watch?v=${video.videoId}&list=${season.playlistId}`
        });
      });

      console.log(`${show.title} ${season.title}: ${videos.length} videos`);
    }
  }

  await fs.writeFile(episodesPath, `${JSON.stringify(episodes, null, 2)}\n`);
  console.log(`Wrote ${episodes.length} episodes to ${path.relative(rootDir, episodesPath)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
