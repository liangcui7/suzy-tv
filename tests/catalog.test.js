import { describe, expect, it } from "vitest";
import { buildCatalog, episodeKey, nextEpisodeAfter, normalizeShowOrder } from "../src/lib/catalog.js";

const shows = [
  {
    slug: "numberblocks",
    title: "Numberblocks",
    seasons: [
      { number: 1, title: "Season 1", playlistId: "season-one" },
      { number: 2, title: "Season 2", playlistId: "season-two" }
    ]
  }
];

const episodes = [
  { id: "numberblocks:s01:e001", showSlug: "numberblocks", seasonNumber: 1, episodeNumber: 1, title: "One" },
  { id: "numberblocks:s01:e002", showSlug: "numberblocks", seasonNumber: 1, episodeNumber: 2, title: "Another One" },
  { id: "numberblocks:s02:e001", showSlug: "numberblocks", seasonNumber: 2, episodeNumber: 1, title: "Six" }
];

describe("catalog helpers", () => {
  it("builds seasons with ordered episodes", () => {
    const catalog = buildCatalog(shows, episodes, []);

    expect(catalog.shows[0].seasons).toHaveLength(2);
    expect(catalog.shows[0].seasons[0].episodes.map((episode) => episode.title)).toEqual([
      "One",
      "Another One"
    ]);
    expect(catalog.shows[0].seasons[1].episodes.map((episode) => episode.title)).toEqual(["Six"]);
  });

  it("uses stable show season episode keys", () => {
    expect(episodeKey("numberblocks", 3, 12)).toBe("numberblocks:s03:e012");
  });

  it("finds the next episode across season boundaries", () => {
    expect(nextEpisodeAfter(episodes, "numberblocks:s01:e002")?.id).toBe("numberblocks:s02:e001");
  });

  it("orders shows by saved show order and tolerates unknown or missing slugs", () => {
    const threeShows = ["a", "b", "c"].map((slug) => ({ slug, title: slug, seasons: [] }));

    expect(normalizeShowOrder(threeShows, ["c", "zzz", "a", "c"])).toEqual(["c", "a", "b"]);
    expect(normalizeShowOrder(threeShows, undefined)).toEqual(["a", "b", "c"]);
    expect(
      buildCatalog(threeShows, [], [], { showOrder: ["b", "c", "a"] }).shows.map((show) => show.slug)
    ).toEqual(["b", "c", "a"]);
    expect(buildCatalog(threeShows, [], []).shows.map((show) => show.slug)).toEqual(["a", "b", "c"]);
  });
});
