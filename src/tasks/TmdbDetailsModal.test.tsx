// @vitest-environment jsdom
import i18n from "../i18n";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn((command: string) => {
    if (command === "get_tmdb_details")
      return Promise.resolve({
        id: 209867,
        mediaType: "tv",
        title: "碧蓝之海",
        originalTitle: "ぐらんぶる",
        year: 2018,
        overview: "一群大学生加入潜水社团后的故事。",
        tagline: "",
        posterPath: "/poster.jpg",
        voteAverage: 8.4,
        voteCount: 1200,
        status: "Ended",
        originalLanguage: "ja",
        genres: ["动画", "喜剧"],
        numberOfSeasons: 1,
        numberOfEpisodes: 12,
        seasons: [
          {
            season: 1,
            name: "第 1 季",
            overview: "第一季简介",
            episodeCount: 12,
          },
        ],
      });
    if (command === "get_tmdb_season")
      return Promise.resolve([
        {
          season: 1,
          episode: 1,
          title: "深海与酒会",
          overview: "新生伊织第一次来到潜水商店。",
          airDate: "2018-07-14",
          runtime: 24,
          voteAverage: 8.1,
        },
      ]);
    if (command === "get_tmdb_image_palette")
      return Promise.resolve({
        colors: [
          { red: 20, green: 138, blue: 211 },
          { red: 238, green: 178, blue: 74 },
          { red: 21, green: 65, blue: 92 },
        ],
      });
    return Promise.reject(new Error(`Unexpected command: ${command}`));
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import TmdbDetailsModal from "./TmdbDetailsModal";

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

describe("TMDB details", () => {
  it("shows title metadata, season counts, and episode descriptions", async () => {
    const { rerender } = render(
      <TmdbDetailsModal
        open
        candidate={{
          id: 209867,
          mediaType: "tv",
          title: "碧蓝之海",
          originalTitle: "ぐらんぶる",
          year: 2018,
          overview: "",
          posterPath: "/poster.jpg",
          voteAverage: 8.4,
        }}
        onClose={() => {}}
      />,
    );

    expect(
      await screen.findByText("一群大学生加入潜水社团后的故事。"),
    ).toBeInTheDocument();
    const themedDetails = document.querySelector(
      ".tmdb-details",
    ) as HTMLElement;
    expect(themedDetails.style.getPropertyValue("--detail-bg")).toMatch(
      /^hsl\(/,
    );
    expect(invoke).toHaveBeenCalledWith("get_tmdb_image_palette", {
      posterPath: "/poster.jpg",
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("tmdb-details-modal");
    expect(dialog.getAttribute("style")).toContain(
      "max-height: calc(100dvh - 20px)",
    );
    expect(dialog.style.height).toBe("");
    expect(document.querySelector(".tmdb-details-wrap")).toBeInTheDocument();
    expect(
      document.querySelector(".tmdb-details-container"),
    ).toBeInTheDocument();
    expect(document.querySelector(".tmdb-details-body")).toBeInTheDocument();
    expect(document.querySelector(".tmdb-season-browser")).toHaveClass(
      "is-compact",
    );
    const detailsScroller = document.querySelector(
      ".tmdb-details-scroll",
    ) as HTMLDivElement;
    Object.defineProperties(detailsScroller, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 600 },
      scrollTop: { configurable: true, value: 300, writable: true },
    });
    fireEvent.scroll(detailsScroller);
    expect(detailsScroller).toHaveClass("is-season-docked");
    expect(document.body).toHaveClass("tmdb-details-open");
    expect(screen.getByText("12", { selector: "dd" })).toBeInTheDocument();
    expect(await screen.findByText(/深海与酒会/)).toBeInTheDocument();
    expect(
      screen.getByText("新生伊织第一次来到潜水商店。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新详情" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "get_tmdb_details",
        expect.objectContaining({ refresh: true }),
      ),
    );
    rerender(
      <TmdbDetailsModal
        open={false}
        candidate={{
          id: 209867,
          mediaType: "tv",
          title: "碧蓝之海",
          originalTitle: "ぐらんぶる",
          year: 2018,
          overview: "",
          posterPath: "/poster.jpg",
          voteAverage: 8.4,
        }}
        onClose={() => {}}
      />,
    );
    expect(document.body).not.toHaveClass("tmdb-details-open");
  });
});
