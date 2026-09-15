import { describe, expect, it } from "vitest";
import type { FileOperation, ScannedFile } from "../models";
import { buildPlanTree, replaceTargetFileName } from "./planTree";

const operation = (
  id: string,
  source: string,
  target: string,
): FileOperation => ({
  id,
  groupId: "group-1",
  source,
  target,
  operation: "move",
  selected: true,
  size: 1,
  modifiedAt: 1,
  status: "planned",
});

describe("file plan tree", () => {
  it("turns target paths into a directory tree with typed file leaves", () => {
    const sourceRoot = "F:\\Incoming\\Show";
    const files: ScannedFile[] = [
      {
        id: "video",
        relativePath: "Show.01.mkv",
        name: "Show.01.mkv",
        extension: "mkv",
        kind: "video",
        size: 1,
        modifiedAt: 1,
        parsed: { title: "Show", episodes: [1] },
      },
      {
        id: "subtitle",
        relativePath: "Show.01.zh.ass.txt",
        name: "Show.01.zh.ass.txt",
        extension: "txt",
        kind: "unknown",
        size: 1,
        modifiedAt: 1,
        parsed: { title: "Show", episodes: [1] },
      },
    ];
    const targetRoot =
      "\\\\?\\F:\\Media\\Shows\\Show (2024) [tmdbid-1]\\Season 01";
    const tree = buildPlanTree(
      [
        operation(
          "video",
          `${sourceRoot}\\Show.01.mkv`,
          `${targetRoot}\\Show S01E01.mkv`,
        ),
        operation(
          "subtitle",
          `${sourceRoot}\\Show.01.zh.ass.txt`,
          `${targetRoot}\\Show S01E01.zh.ass`,
        ),
      ],
      files,
      "No target",
    );

    expect(tree[0].name).toBe("F:");
    const season = tree[0].children?.[0].children?.[0].children?.[0].children?.[0];
    expect(season?.name).toBe("Season 01");
    expect(season?.children?.map((item) => item.name)).toEqual([
      "Show S01E01.mkv",
      "Show S01E01.zh.ass",
    ]);
    expect(season?.children?.map((item) => item.fileKind)).toEqual([
      "video",
      "subtitle",
    ]);
    expect(season?.children?.map((item) => item.extension)).toEqual([
      "mkv",
      "ass",
    ]);
  });

  it("renames only the target file leaf", () => {
    expect(
      replaceTargetFileName(
        "F:\\Media\\Shows\\Season 01\\Old.mkv",
        "New.mkv",
      ),
    ).toBe("F:\\Media\\Shows\\Season 01\\New.mkv");
  });
});
