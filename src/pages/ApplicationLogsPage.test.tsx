// @vitest-environment jsdom
import "../i18n";
import "@testing-library/jest-dom/vitest";
import { App as AntApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../services/backend", () => ({
  backend: {
    listApplicationLogs: vi.fn(() =>
      Promise.resolve([
        {
          time: 1_700_000_000_000,
          level: "ERROR",
          target: "command.scan_organizer_task",
          message: "source-read-failed",
        },
      ]),
    ),
    clearApplicationLogs: vi.fn(() => Promise.resolve()),
  },
}));

import ApplicationLogsPage from "./ApplicationLogsPage";

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

describe("application logs page", () => {
  it("renders persisted software diagnostics separately from task history", async () => {
    render(
      <AntApp>
        <ApplicationLogsPage />
      </AntApp>,
    );
    expect(
      await screen.findByText("command.scan_organizer_task"),
    ).toBeInTheDocument();
    expect(screen.getByText("source-read-failed")).toBeInTheDocument();
  });
});
