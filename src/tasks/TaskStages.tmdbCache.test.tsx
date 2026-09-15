// @vitest-environment jsdom
import i18n from "../i18n";
import "@testing-library/jest-dom/vitest";
import { App as AntApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizerTask, TmdbCandidate } from "../models";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import TaskStages from "./TaskStages";

const group = {
  id: "group-1",
  titleGuess: "Default Show",
  mediaType: "tv" as const,
  confidence: 1,
  source: "manual" as const,
  confirmed: false,
  fileIds: ["video-1"],
  episodeMappings: [],
};

const task: OrganizerTask = {
  id: "task-1",
  name: "Default Show",
  mode: "single",
  sourceRoot: "D:/Incoming",
  movieRoot: "D:/Movies",
  showRoot: "D:/Shows",
  operation: "move",
  status: "active",
  stage: "match",
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  groups: [group],
  files: [
    {
      id: "video-1",
      relativePath: "show.mkv",
      name: "show.mkv",
      extension: "mkv",
      kind: "video",
      size: 1,
      modifiedAt: 1,
      groupId: "group-1",
      parsed: { title: "Default Show", episodes: [] },
    },
  ],
};

const cachedCandidate: TmdbCandidate = {
  id: 11,
  mediaType: "tv",
  title: "Cached Show",
  originalTitle: "Cached Show",
  overview: "Restored without a request",
  voteAverage: 8,
};

beforeAll(() => {
  void i18n.changeLanguage("zh-CN");
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: Observer,
  });
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("jellysmith-tmdb-language", "zh-CN");
  localStorage.setItem(
    "jellysmith-tmdb-search-results-v1",
    JSON.stringify({
      entries: {
        "task-1:group-1:tv:zh-CN:cached show": {
          query: "Cached Show",
          mediaType: "tv",
          language: "zh-CN",
          candidates: [cachedCandidate],
          posterPalettes: {},
          savedAt: 1,
        },
      },
      lastByGroup: {
        "task-1:group-1": "task-1:group-1:tv:zh-CN:cached show",
      },
    }),
  );
  invoke.mockReset();
  invoke.mockResolvedValue([
    { ...cachedCandidate, id: 12, title: "Fresh Show" },
  ]);
});

describe("TMDB candidate cache", () => {
  it("restores results locally and refreshes only after a manual search", async () => {
    const view = render(
      <AntApp>
        <TaskStages
          task={task}
          stage="match"
          selectedGroup={group}
          busy={false}
          onBusy={() => {}}
          onTask={() => {}}
          onSelectGroup={() => {}}
          onStageChange={() => {}}
          onFinished={() => {}}
        />
      </AntApp>,
    );

    expect(await screen.findByText("Cached Show")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /搜索 TMDB/ }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("search_tmdb", {
        query: "Cached Show",
        mediaType: "tv",
        language: "zh-CN",
        page: 1,
        refresh: true,
      }),
    );
    expect(await screen.findByText("Fresh Show")).toBeInTheDocument();
    view.unmount();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
});
