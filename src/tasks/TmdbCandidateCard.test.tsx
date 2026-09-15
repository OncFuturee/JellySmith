// @vitest-environment jsdom
import i18n from "../i18n";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  TmdbCandidateCard,
  TmdbCandidateViewSwitch,
  type CandidateView,
} from "./TmdbCandidateCard";

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
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

describe("TMDB candidate cards", () => {
  it("switches between single, double, and compact layouts", () => {
    let selected: CandidateView = "single";
    const { rerender } = render(
      <TmdbCandidateViewSwitch
        value={selected}
        onChange={(value) => {
          selected = value;
        }}
      />,
    );

    expect(screen.getByText("单列")).toBeInTheDocument();
    expect(screen.getByText("双列")).toBeInTheDocument();
    fireEvent.click(screen.getByText("简略"));
    expect(selected).toBe("compact");

    rerender(<TmdbCandidateViewSwitch value={selected} onChange={() => {}} />);
    expect(screen.getByText("简略").closest("label")).toHaveClass(
      "ant-segmented-item-selected",
    );
  });

  it("opens details from the compact overview affordance", () => {
    const onDetails = vi.fn();
    render(
      <TmdbCandidateCard
        candidate={{
          id: 209867,
          mediaType: "tv",
          title: "碧蓝之海",
          originalTitle: "ぐらんぶる",
          year: 2018,
          overview: "北原伊织升入大学后开始的新生活。",
          posterPath: "/poster.jpg",
          voteAverage: 7.8,
        }}
        posterUrl="https://image.tmdb.org/t/p/w342/poster.jpg"
        style={{}}
        selected={false}
        view="compact"
        onDetails={onDetails}
        onConfirm={() => {}}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "查看详情" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看更多" }));
    expect(onDetails).toHaveBeenCalledOnce();
  });
});
