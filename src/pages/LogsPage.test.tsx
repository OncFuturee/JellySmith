// @vitest-environment jsdom
import "../i18n";
import "@testing-library/jest-dom/vitest";
import { App as AntApp } from "antd";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const run = {
  id: "run-1",
  workflowId: "task-1",
  workflowName: "Media organization",
  workflowVersion: "organizer-v1",
  status: "completed",
  startedAt: 1000,
  finishedAt: 2500,
  nodeStates: { "file-transaction": "completed" },
  logs: [
    {
      time: 2000,
      level: "INFO",
      message: "completed:D:/Incoming/Dune.mkv -> D:/Media/Dune/Dune.mkv",
    },
  ],
  outputs: {
    plan: {
      id: "plan-1",
      taskId: "task-1",
      taskRevision: 3,
      createdAt: 1000,
      status: "completed",
      operations: [
        {
          id: "item-1",
          groupId: "group-1",
          source: "D:/Incoming/Dune.mkv",
          target: "D:/Media/Dune/Dune.mkv",
          operation: "move",
          selected: true,
          size: 1024,
          modifiedAt: 1,
          status: "completed",
        },
      ],
    },
  },
};
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve([run])),
}));
import { invoke } from "@tauri-apps/api/core";
import LogsPage from "./LogsPage";

beforeAll(() => {
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
describe("logs page", () => {
  it("renders persisted run transactions and details", async () => {
    render(
      <AntApp>
        <LogsPage />
      </AntApp>,
    );
    expect((await screen.findAllByText("run-1")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("D:/Incoming/Dune.mkv").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getAllByText("D:/Media/Dune/Dune.mkv").length,
    ).toBeGreaterThan(0);
  });

  it("deletes the selected persisted run after confirmation", async () => {
    render(
      <AntApp>
        <LogsPage />
      </AntApp>,
    );
    await screen.findAllByText("run-1");
    fireEvent.click(screen.getByRole("button", { name: "Delete run" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("delete_run", { runId: "run-1" }),
    );
  });
});
