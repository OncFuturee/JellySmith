// @vitest-environment jsdom
import i18n from "../i18n";
import "@testing-library/jest-dom/vitest";
import { App as AntApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { OrganizerTask } from "../models";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import TaskStages from "./TaskStages";

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
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    writable: true,
    value: () => {},
  });
  const getComputedStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(window, "getComputedStyle", {
    writable: true,
    value: (element: Element) => getComputedStyle(element),
  });
});

describe("episode naming before AI mapping", () => {
  it("persists the chosen filename format before requesting AI suggestions", async () => {
    const group = {
      id: "group-1",
      titleGuess: "Example Show",
      year: 2024,
      mediaType: "tv" as const,
      confidence: 1,
      source: "manual" as const,
      confirmed: true,
      fileIds: ["file-1"],
      matched: {
        candidate: {
          id: 123,
          mediaType: "tv" as const,
          title: "Example Show",
          originalTitle: "Example Show",
          year: 2024,
          overview: "",
          voteAverage: 8,
        },
        displayTitle: "Example Show",
        source: "tmdb" as const,
        confirmedAt: 1,
      },
      episodeMappings: [
        {
          fileId: "file-1",
          season: 1,
          episode: 2,
          title: "Episode Two",
          confirmed: false,
        },
      ],
    };
    const task: OrganizerTask = {
      id: "task-1",
      name: "Example Show",
      mode: "single",
      sourceRoot: "D:/Incoming/Example Show",
      movieRoot: "D:/Media/Movies",
      showRoot: "D:/Media/Shows",
      operation: "move",
      episodeNamingFormat: "series-year-title",
      status: "active",
      stage: "episodes",
      revision: 3,
      createdAt: 1,
      updatedAt: 1,
      files: [
        {
          id: "file-1",
          relativePath: "Example.Show.S01E02.mkv",
          name: "Example.Show.S01E02.mkv",
          extension: "mkv",
          kind: "video",
          size: 1,
          modifiedAt: 1,
          groupId: "group-1",
          parsed: { title: "Example Show", season: 1, episodes: [2] },
        },
      ],
      groups: [group],
    };
    invoke.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "update_episode_naming_format")
          return Promise.resolve({
            ...task,
            episodeNamingFormat: "episode-title",
          });
        if (command === "propose_ai_episode_mappings")
          return Promise.resolve([]);
        if (command === "update_episode_mappings")
          return Promise.resolve({
            ...task,
            groups: [{ ...group, episodeMappings: args?.mappings }],
          });
        if (command === "generate_organization_plan")
          return Promise.resolve({ ...task, stage: "plan" });
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    );

    const onStageChange = vi.fn();
    const view = render(
      <AntApp>
        <TaskStages
          task={task}
          stage="episodes"
          selectedGroup={group}
          busy={false}
          onBusy={() => {}}
          onTask={() => {}}
          onSelectGroup={() => {}}
          onStageChange={onStageChange}
          onFinished={() => {}}
        />
      </AntApp>,
    );

    expect(screen.getByRole("grid")).toHaveClass("episode-data-grid");
    expect(document.querySelector(".episode-sheet")).not.toBeInTheDocument();
    const seasonCell = document.querySelector<HTMLElement>(
      '[data-episode-cell="0-season"]',
    );
    expect(seasonCell).not.toBeNull();
    fireEvent.click(seasonCell!);
    fireEvent.paste(document.querySelector(".episode-grid-shell")!, {
      clipboardData: { getData: () => "5\t7\t8\tPasted title" },
    });
    await waitFor(() => {
      expect(
        document.querySelector('[data-episode-cell="0-season"]'),
      ).toHaveTextContent("5");
    });

    fireEvent.click(screen.getByRole("button", { name: /AI 初始映射/ }));
    expect(screen.getByText("选择 Jellyfin 剧集命名格式")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("集数优先"));
    fireEvent.click(
      screen.getByRole("button", { name: /使用此格式并开始 AI 映射/ }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("update_episode_naming_format", {
        taskId: "task-1",
        namingFormat: "episode-title",
      });
      expect(invoke).toHaveBeenCalledWith("propose_ai_episode_mappings", {
        taskId: "task-1",
        groupId: "group-1",
        language: "zh-CN",
      });
    });
    const saveOrder = invoke.mock.invocationCallOrder[0];
    const aiOrder = invoke.mock.invocationCallOrder[1];
    expect(saveOrder).toBeLessThan(aiOrder);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "update_episode_mappings",
        expect.objectContaining({ taskId: "task-1", groupId: "group-1" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认映射并继续" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("generate_organization_plan", {
        taskId: "task-1",
      });
      expect(onStageChange).toHaveBeenCalledWith("plan");
    });
    view.unmount();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
});
