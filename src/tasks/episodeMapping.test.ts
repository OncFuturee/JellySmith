import { describe, expect, it } from "vitest";
import {
  ensureEditableEpisodeMappings,
  mergeAiEpisodeMappings,
} from "./episodeMapping";

describe("manual episode mapping", () => {
  it("creates editable sequential rows when filenames have no episode numbers", () => {
    const files = ["Episode 10.mkv", "Episode 2.mkv", "Special.mkv"].map(
      (name, index) => ({
        id: `file-${index}`,
        relativePath: name,
        name,
        extension: "mkv",
        kind: "video" as const,
        size: 1,
        modifiedAt: 1,
        groupId: "group-1",
        parsed: { title: name, episodes: [] },
      }),
    );

    const result = ensureEditableEpisodeMappings(
      [],
      files.map((file) => file.id),
      files,
    );

    expect(result.map(({ fileId, season, episode }) => ({ fileId, season, episode }))).toEqual([
      { fileId: "file-1", season: 1, episode: 1 },
      { fileId: "file-0", season: 1, episode: 2 },
      { fileId: "file-2", season: 1, episode: 3 },
    ]);
    expect(result.every((mapping) => !mapping.confirmed)).toBe(true);
  });
});

describe("AI episode mapping", () => {
  it("keeps proposals unconfirmed and preserves mappings the AI did not replace", () => {
    const result = mergeAiEpisodeMappings(
      [
        {
          fileId: "episode-1",
          season: 1,
          episode: 1,
          title: "Existing title",
          confirmed: true,
        },
        {
          fileId: "episode-2",
          season: 1,
          episode: 2,
          title: "Keep me",
          confirmed: true,
        },
      ],
      [
        {
          fileId: "episode-1",
          season: 2,
          episode: 4,
          title: "",
          confidence: 0.86,
          reason: "The folder and filename contain S02E04",
        },
        {
          fileId: "episode-3",
          season: 0,
          episode: 1,
          title: "Special",
          confidence: 0.72,
          reason: "The Specials folder indicates season zero",
        },
      ],
    );

    expect(result.mappings).toEqual([
      {
        fileId: "episode-1",
        season: 2,
        episode: 4,
        episodeEnd: undefined,
        title: "Existing title",
        confirmed: false,
      },
      {
        fileId: "episode-2",
        season: 1,
        episode: 2,
        title: "Keep me",
        confirmed: true,
      },
      {
        fileId: "episode-3",
        season: 0,
        episode: 1,
        episodeEnd: undefined,
        title: "Special",
        confirmed: false,
      },
    ]);
    expect(result.evidence["episode-1"].confidence).toBe(0.86);
  });
});
