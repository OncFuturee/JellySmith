import { describe, expect, it } from "vitest";
import { createDetailTheme } from "./detailTheme";

describe("TMDB detail theme", () => {
  it("turns three poster colors into stable semantic tokens", () => {
    const theme = createDetailTheme([
      { red: 20, green: 138, blue: 211 },
      { red: 238, green: 178, blue: 74 },
      { red: 21, green: 65, blue: 92 },
    ]);
    expect(theme?.style["--detail-bg"]).toMatch(/^hsl\(/);
    expect(theme?.style["--detail-card"]).toContain("linear-gradient");
    expect(theme?.style["--detail-text"]).toBe("rgb(248 252 255)");
    expect(theme?.control).not.toBe(theme?.controlHover);
  });

  it("uses no custom theme when extraction yields no colors", () => {
    expect(createDetailTheme([])).toBeUndefined();
  });
});
