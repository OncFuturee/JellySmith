// @vitest-environment jsdom
import i18n from "../i18n";
import "@testing-library/jest-dom/vitest";
import { App as AntApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const { openUrl, settings, saveSettings } = vi.hoisted(() => ({
  openUrl: vi.fn(() => Promise.resolve()),
  settings: {
    language: "zh-CN",
    theme: "dark" as const,
    ffprobePath: "ffprobe",
    defaultMovieRoot: "",
    defaultShowRoot: "",
    backgroundProbe: true,
    defaultAllowOverwrite: false,
    backupBeforeOverwrite: true,
    layout: { leftWidth: 230, rightWidth: 300, bottomHeight: 350 },
    ai: {
      provider: "gemini" as const,
      model: "gemini-3.6-flash",
      baseUrl: "",
    },
  },
  saveSettings: vi.fn((value) => Promise.resolve(value)),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("../services/backend", () => ({
  backend: {
    hasApiKey: vi.fn(() => Promise.resolve(false)),
    saveApiKey: vi.fn(() => Promise.resolve()),
    listAiModels: vi.fn(() => Promise.resolve([])),
    writeApplicationLog: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock("../settings/SettingsContext", () => ({
  useSettings: () => ({
    settings,
    save: saveSettings,
  }),
}));

import SettingsPage from "./SettingsPage";

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

describe("settings credential links", () => {
  it("opens the official TMDB and selected AI provider key pages", async () => {
    render(
      <AntApp>
        <SettingsPage />
      </AntApp>,
    );

    fireEvent.click(screen.getByRole("tab", { name: "媒体工具" }));
    fireEvent.click(await screen.findByRole("button", { name: /获取 Key/ }));
    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith(
        "https://www.themoviedb.org/settings/api",
      ),
    );

    fireEvent.click(screen.getByRole("tab", { name: "AI 分组服务" }));
    fireEvent.click(await screen.findByRole("button", { name: /获取 Key/ }));
    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith(
        "https://aistudio.google.com/app/apikey",
      ),
    );
  });
});
