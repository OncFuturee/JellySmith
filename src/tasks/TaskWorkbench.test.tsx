// @vitest-environment jsdom
import i18n from "../i18n";
import "@testing-library/jest-dom/vitest";
import { App as AntApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const summary = {
  id: "task-1",
  name: "Dune review",
  mode: "single",
  status: "active",
  stage: "group",
  updatedAt: 1,
  fileCount: 2,
  groupCount: 1,
};
const secondSummary = {
  ...summary,
  id: "task-2",
  name: "Arrakis review",
  stage: "scan",
  fileCount: 0,
  groupCount: 0,
};

const task = {
  id: "task-1",
  name: "Dune review",
  mode: "single",
  sourceRoot: "D:/Incoming/Dune",
  movieRoot: "D:/Media/Movies",
  showRoot: "D:/Media/Shows",
  operation: "move",
  status: "active",
  stage: "group",
  revision: 2,
  createdAt: 1,
  updatedAt: 1,
  files: [
    {
      id: "f1",
      relativePath: "Dune.2021.mkv",
      name: "Dune.2021.mkv",
      extension: "mkv",
      kind: "video",
      size: 1,
      modifiedAt: 1,
      groupId: "g1",
      parsed: { title: "Dune", year: 2021, episodes: [] },
    },
    {
      id: "f2",
      relativePath: "notes.txt",
      name: "notes.txt",
      extension: "txt",
      kind: "unknown",
      size: 1,
      modifiedAt: 1,
      parsed: { title: "notes", episodes: [] },
      warning: "unsupported-file",
    },
  ],
  groups: [
    {
      id: "g1",
      titleGuess: "Dune",
      year: 2021,
      mediaType: "movie",
      confidence: 0.9,
      source: "local",
      confirmed: false,
      fileIds: ["f1"],
      episodeMappings: [],
    },
  ],
};
const secondTask = {
  ...task,
  id: "task-2",
  name: "Arrakis review",
  sourceRoot: "D:/Incoming/Arrakis",
  stage: "scan",
  files: [],
  groups: [],
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string, args?: { taskId?: string }) => {
    if (command === "list_organizer_tasks")
      return Promise.resolve([summary, secondSummary]);
    if (command === "load_organizer_task")
      return args?.taskId === "task-2"
        ? new Promise((resolve) =>
            window.setTimeout(() => resolve(secondTask), 40),
          )
        : Promise.resolve(task);
    return Promise.resolve(undefined);
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

import TaskWorkbench from "./TaskWorkbench";

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

afterEach(cleanup);

describe("task workbench", () => {
  it("restores a saved task and lets the user inspect grouped, unassigned, and all files", async () => {
    render(
      <AntApp>
        <TaskWorkbench />
      </AntApp>,
    );
    expect((await screen.findAllByText("Dune review")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByRole("heading", { name: "Dune", level: 1 })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "任务操作" })[0]);
    expect(await screen.findByText("编辑任务配置")).toBeInTheDocument();
    expect(screen.getByText("重新选择来源")).toBeInTheDocument();
    expect(screen.getByText("删除任务")).toBeInTheDocument();
    expect(await screen.findByText("Dune.2021.mkv")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Dune")).toBeInTheDocument();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText("全部文件")[0]);
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Dune")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("未分组文件")[0]);
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Dune")).toBeInTheDocument();
  });

  it("keeps the workbench mounted while switching task cards", async () => {
    render(
      <AntApp>
        <TaskWorkbench />
      </AntApp>,
    );
    expect(
      await screen.findByRole("heading", { name: "Dune", level: 1 }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Arrakis review/ }));
    expect(
      screen.getByRole("heading", { name: "Dune", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Arrakis", level: 1 }),
    ).toBeInTheDocument();
  });
});
