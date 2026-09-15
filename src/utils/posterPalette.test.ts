import { describe, expect, it } from "vitest";
import { createPosterPalette } from "./posterPalette";

describe("poster palette", () => {
  it("creates opaque, soft, and glow variants from one source color", () => {
    const palette = createPosterPalette({ r: 18, g: 139, b: 220 });
    expect(palette.accent).toMatch(/^rgb\(/);
    expect(palette.accentBright).toMatch(/^rgb\(/);
    expect(palette.accentSoft).toContain("/ 0.2");
    expect(palette.accentGlow).toContain("/ 0.34");
  });
});
