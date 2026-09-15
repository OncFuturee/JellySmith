// @vitest-environment jsdom
import i18n from "../i18n";
import "@testing-library/jest-dom/vitest";
import { App as AntApp } from "antd";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizerTask } from "../models";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import TaskStages from "./TaskStages";

const task: OrganizerTask = {
  id: "task-scan",
  name: "Scan selection",
  mode: "single",
  sourceRoot: "D:/Incoming",
  movieRoot: "D:/Movies",
  showRoot: "D:/Shows",
  operation: "move",
  status: "active",
  stage: "scan",
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  groups: [],
  files: [
    {
      id: "video-1",
      relativePath: "show/episode.mp4",
      name: "episode.mp4",
      extension: "mp4",
      kind: "video",
      size: 1024,
      modifiedAt: 1,
      parsed: { title: "episode", episodes: [] },
    },
    {
      id: "subtitle-1",
      relativePath: "show/episode.srt",
      name: "episode.srt",
      extension: "srt",
      kind: "subtitle",
      size: 128,
      modifiedAt: 1,
      parsed: { title: "episode", episodes: [] },
    },
  ],
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
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    writable: true,
    value: () => {},
  });
  const getComputedStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(window, "getComputedStyle", {
    writable: true,
    value: (element: Element) => getComputedStyle(element),
  });
});

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string) => {
    if (command === "confirm_scan_selection")
      return Promise.resolve({ ...task, files: [task.files[0]] });
    if (command === "group_organizer_task") return Promise.resolve(task);
    return Promise.reject(new Error(`Unexpected command: ${command}`));
  });
});

describe("scan file selection", () => {
  it("passes only files selected through an extension checkbox to grouping", async () => {
    const onTask = vi.fn();
    const view = render(
      <AntApp>
        <TaskStages
          task={task}
          stage="scan"
          busy={false}
          onBusy={() => {}}
          onTask={onTask}
          onSelectGroup={() => {}}
          onStageChange={() => {}}
          onFinished={() => {}}
        />
      </AntApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: /清\s*空/ }));
    fireEvent.click(
      within(document.querySelector(".scan-file-filters")!).getByRole(
        "checkbox",
        { name: /\.mp4/ },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认所选并生成分组" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("confirm_scan_selection", {
        taskId: "task-scan",
        fileIds: ["video-1"],
      }),
    );
    expect(invoke).toHaveBeenCalledWith("group_organizer_task", {
      taskId: "task-scan",
    });
    await waitFor(() => expect(onTask).toHaveBeenCalled());
    view.unmount();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
});
