import { describe, expect, it } from "vitest";
import type { EpisodeMapping } from "../models";
import {
  analyzeEpisodeMappings,
  offsetEpisodeMappings,
  renumberEpisodeMappings,
} from "./episodeMappingTools";

const mappings: EpisodeMapping[] = [
  { fileId: "1", season: 1, episode: 1, title: "", confirmed: true },
  { fileId: "3", season: 1, episode: 3, title: "", confirmed: true },
  { fileId: "4a", season: 1, episode: 4, title: "", confirmed: false },
  { fileId: "4b", season: 1, episode: 4, title: "", confirmed: true },
];

describe("episode mapping batch tools", () => {
  it("finds gaps and overlapping episode assignments", () => {
    const analysis = analyzeEpisodeMappings(mappings);
    expect(analysis.gaps).toEqual([{ season: 1, from: 2, to: 2 }]);
    expect(analysis.overlaps[0]).toMatchObject({ season: 1, episode: 4 });
    expect(analysis.issueFileIds).toEqual(new Set(["3", "4a", "4b"]));
  });

  it("offsets a selected tail without changing other mappings", () => {
    const result = offsetEpisodeMappings(mappings, new Set(["3", "4a"]), -1);
    expect(result.map((item) => item.episode)).toEqual([1, 2, 3, 4]);
    expect(result[1].confirmed).toBe(false);
  });

  it("renumbers selected files continuously and preserves multi-episode spans", () => {
    const source: EpisodeMapping[] = [
      { fileId: "a", season: 2, episode: 8, episodeEnd: 9, title: "", confirmed: true },
      { fileId: "b", season: 2, episode: 11, title: "", confirmed: true },
    ];
    const result = renumberEpisodeMappings(source, ["a", "b"], 1, 5);
    expect(result).toMatchObject([
      { season: 1, episode: 5, episodeEnd: 6, confirmed: false },
      { season: 1, episode: 7, confirmed: false },
    ]);
  });
});
