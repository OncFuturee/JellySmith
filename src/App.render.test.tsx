// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => {
    if (command === "load_settings")
      return Promise.resolve({
        language: "zh-CN",
        theme: "light",
        ffprobePath: "ffprobe",
        defaultMovieRoot: "",
        defaultShowRoot: "",
        backgroundProbe: true,
        defaultAllowOverwrite: false,
        backupBeforeOverwrite: true,
        layout: { leftWidth: 230, rightWidth: 300, bottomHeight: 350 },
        ai: { provider: "disabled", model: "", baseUrl: "" },
      });
    if (command === "list_organizer_tasks" || command === "list_runs")
      return Promise.resolve([]);
    return Promise.resolve(undefined);
  }),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("0.1.0"),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
    toggleMaximize: () => Promise.resolve(),
    minimize: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

import App from "./App";

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
});
afterEach(cleanup);
describe("application rendering", () => {
  it("opens the task-first media organizer without the node editor", async () => {
    render(<App />);
    expect(
      await screen.findByText("开始整理 Jellyfin 媒体库"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("新建任务").length).toBeGreaterThan(0);
    expect(document.querySelector(".task-workbench")).toBeInTheDocument();
    expect(document.querySelector(".react-flow")).not.toBeInTheDocument();
    expect(document.querySelector(".global-statusbar")).toBeInTheDocument();
    expect(screen.getByText("就绪")).toBeInTheDocument();
    const rail = document.querySelector(".rail");
    expect(rail).toBeInTheDocument();
    expect(rail?.querySelectorAll("button")).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "文件(F)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "运行(R)" }),
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
