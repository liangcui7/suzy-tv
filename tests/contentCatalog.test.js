import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

describe("official content catalog", () => {
  it("includes the configured learning shows and their season playlists", async () => {
    const shows = await readJson("src/content/shows.json");
    const episodes = await readJson("src/content/episodes.json");
    const expectedShows = {
      numberblocks: 9,
      alphablocks: 6,
      colourblocks: 2,
      wonderblocks: 1,
      "pinkfong-pinyin": 9,
      "learn-with-peppa": 8,
      "learn-with-baby-shark": 7
    };

    expect(Object.fromEntries(shows.map((show) => [show.slug, show.seasons.length]))).toEqual(
      expectedShows
    );

    for (const show of shows) {
      for (const season of show.seasons) {
        const seasonEpisodes = episodes.filter(
          (episode) =>
            episode.showSlug === show.slug && Number(episode.seasonNumber) === Number(season.number)
        );

        expect(seasonEpisodes.length).toBeGreaterThan(0);
        expect(new Set(seasonEpisodes.map((episode) => episode.playlistId))).toEqual(
          new Set([season.playlistId])
        );
        expect(seasonEpisodes.map((episode) => episode.playlistIndex)).toEqual(
          seasonEpisodes.map((_episode, index) => index + 1)
        );
        expect(seasonEpisodes.every((episode) => episode.youtubeId && episode.thumbnailUrl)).toBe(true);
      }
    }

    const wonderblocksFirstEpisode = episodes.find((episode) => episode.id === "wonderblocks:s01:e001");
    expect(wonderblocksFirstEpisode.title).toBe("Go!");
    expect(wonderblocksFirstEpisode.youtubeTitle).toContain("Coding For Kids");

    const pinkfongPinyinFirstEpisode = episodes.find(
      (episode) => episode.id === "pinkfong-pinyin:s01:e001"
    );
    expect(pinkfongPinyinFirstEpisode).toBeDefined();
    expect(pinkfongPinyinFirstEpisode.youtubeTitle).toContain("拼音");
    const peppaNumbers = episodes.find((episode) => episode.id === "learn-with-peppa:s01:e006");
    expect(peppaNumbers).toBeDefined();
    expect(peppaNumbers.title).toBe("Learning Numbers With Peppa Pig ⭐️");
    expect(peppaNumbers.youtubeId).toBe("urmFKtNYdBw");
    expect(
      episodes.filter((episode) => episode.showSlug === "learn-with-peppa").map((episode) => episode.seasonNumber)
    ).toEqual([
      ...Array(7).fill(1),
      ...Array(8).fill(2),
      ...Array(3).fill(3),
      ...Array(4).fill(4),
      ...Array(13).fill(5),
      ...Array(5).fill(6),
      ...Array(5).fill(7),
      ...Array(13).fill(8)
    ]);
    expect(
      episodes.find((episode) => episode.id === "learn-with-peppa:s08:e001")?.youtubeId
    ).toBe("iYzY7hGIRlM");

    const pinkfong = shows.find((show) => show.slug === "pinkfong-pinyin");
    expect(pinkfong.title).toBe("Pinkfong");
    expect(pinkfong.seasons.map((season) => season.title)).toEqual([
      "Pinyin Songs",
      "Space & Planets",
      "My Body",
      "Preschool Lessons",
      "Dinosaurs & Animals",
      "Jobs",
      "Earth & Environment",
      "How To",
      "Around the World"
    ]);
    expect(episodes.find((episode) => episode.id === "pinkfong-pinyin:s02:e001")?.title).toBe("Eight Planets");
    expect(episodes.find((episode) => episode.id === "pinkfong-pinyin:s05:e001")?.title).toBe(
      "We Are Dino Explorers!"
    );

    const babySharkAbc = episodes.find((episode) => episode.id === "learn-with-baby-shark:s01:e001");
    expect(babySharkAbc?.youtubeId).toBe("S5nrPezsYJk");
    expect(babySharkAbc?.title).toBe("Alphabet A");
    expect(
      episodes.find((episode) => episode.id === "learn-with-baby-shark:s05:e003")?.title
    ).toBe("Tooth Brushing is Fun");

    expect(
      episodes
        .filter((episode) => episode.showSlug === "pinkfong-pinyin" && episode.seasonNumber === 1)
        .map((episode) => episode.youtubeId)
    ).toEqual([
      "cMulxJEntdI",
      "8Wj7xueKzJI",
      "Hj8SJnhpjws",
      "fKvN1CmKBJo",
      "NkmGmQ7xE9Q",
      "Frphza0pMQc",
      "kPn1UEWvQug",
      "7Okc9LzY3-g",
      "ulezHRQX5is",
      "d9PnuXK7PGg"
    ]);
  });
});
