// @vitest-environment jsdom
import i18n from "../i18n";
import "@testing-library/jest-dom/vitest";
import { App as AntApp } from "antd";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { OrganizerTask } from "../models";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
}));

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
  const getComputedStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(window, "getComputedStyle", {
    writable: true,
    value: (element: Element) => getComputedStyle(element),
  });
});

const task: OrganizerTask = {
  id: "task-1",
  name: "Show",
  mode: "single",
  sourceRoot: "F:\\Incoming\\Show",
  movieRoot: "F:\\Media\\Movies",
  showRoot: "F:\\Media\\Shows",
  operation: "move",
  status: "active",
  stage: "plan",
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  groups: [],
  files: [
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
  ],
  plan: {
    id: "plan-1",
    taskId: "task-1",
    taskRevision: 1,
    createdAt: 1,
    status: "ready",
    operations: [
      {
        id: "operation-1",
        groupId: "group-1",
        source: "F:\\Incoming\\Show\\Show.01.mkv",
        target:
          "F:\\Media\\Shows\\Show (2024) [tmdbid-1]\\Season 01\\Show S01E01.mkv",
        operation: "move",
        selected: true,
        size: 1,
        modifiedAt: 1,
        status: "planned",
      },
    ],
  },
};

describe("file plan preview", () => {
  it("renders target folders and file metadata in a tree table", async () => {
    render(
      <AntApp>
        <TaskStages
          task={task}
          stage="plan"
          busy={false}
          onBusy={() => {}}
          onTask={() => {}}
          onSelectGroup={() => {}}
          onStageChange={() => {}}
          onFinished={() => {}}
        />
      </AntApp>,
    );

    expect(screen.getAllByText("输出目录结构")[0]).toBeInTheDocument();
    expect(screen.getAllByText("文件类型")[0]).toBeInTheDocument();
    expect(screen.getAllByText("文件操作")[0]).toBeInTheDocument();
    expect(screen.getAllByText("状态")[0]).toBeInTheDocument();
    expect(await screen.findByText("Season 01")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Show S01E01.mkv")).toBeInTheDocument();
    expect(screen.getByText(".mkv")).toBeInTheDocument();
    expect(screen.getByText("视频")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /确认并执行/ }),
    ).toBeEnabled();
  });
});
