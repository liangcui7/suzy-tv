# Suzy TV

Suzy TV organizes official learning videos by show, season, and episode. It includes Numberblocks, Alphablocks, Colourblocks, Wonderblocks, and Pinkfong Pinyin.

The app supports tablet use, PWA installation, TV remote navigation, parent controls, episode play counts, subtitles, and season selection. When the last episode of a season ends, playback starts again at the first episode of that season.

## Run Locally

Use Node.js 22.9 or later.

```bash
cp .env.example .env
npm ci
npm run build
npm start
```

Open <http://localhost:8080>. Open `/admin` for parent controls. The initial parent password is `suzy&yuna`. To change it, edit `VIDEO_ADMIN_PASSWORD` in `.env`, then restart the server. Keep `.env` private.

For development, run `npm run dev`. Open <http://localhost:5173>. The development server forwards API requests to port 8080.

## Docker

```bash
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:8080>. Progress and settings are stored in the `suzy-tv-data` Docker volume. For a public website, configure your own domain and HTTPS reverse proxy.

Without Docker, progress and settings are stored in `data/`. Each new installation starts with fresh watch data. Set a unique `VIDEO_SESSION_SECRET` in `.env` to keep parent login valid across server restarts. The server generates a temporary secret if this setting is absent.

## Shows

Playlist settings are in `src/content/shows.json`. Episode metadata is in `src/content/episodes.json`. To add a show, add its playlist settings and run:

```bash
npm run sync:playlists
```

Review the changes before release. Some official playlists are hidden from unauthenticated requests. A season can use an ordered `videoIds` fallback for these playlists.

Videos play through the YouTube embed player and require an internet connection. YouTube controls account sign-in, cookies, ads, and caption availability.

## Android TV

The `android-tv/` folder contains the Android TV wrapper. It uses a separate app ID, `tv.suzy.app`, so it can be installed beside other TV apps.

After you host Suzy TV at your own HTTPS address, build with JDK 17, Android SDK 34, and Gradle 8.7:

```bash
cd android-tv
gradle assembleDebug -PsuzyTvUrl=https://your-suzy-tv-domain/
```

Replace the example URL with your deployed Suzy TV address. The wrapper has no link to the original installation. The Android APK build requires the Android toolchain and is separate from the web build.

## Checks

```bash
npm test
npm run build
```

## Repository Contents

This repository contains only the Suzy TV app, its tests, its show catalog, and its Android TV wrapper. It has a fresh Git history. It does not contain watch data, the original project's environment files, deployment credentials, SSH keys, tunnel configuration, or code for other projects.
