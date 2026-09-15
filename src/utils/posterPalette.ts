export type PosterPalette = {
  accent: string;
  accentBright: string;
  accentSoft: string;
  accentGlow: string;
};

type Rgb = { r: number; g: number; b: number };

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const rgbToHsl = ({ r, g, b }: Rgb) => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta) {
    if (maximum === red) hue = ((green - blue) / delta) % 6;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const lightness = (maximum + minimum) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return { hue, saturation, lightness };
};

const hslToRgb = (hue: number, saturation: number, lightness: number): Rgb => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const values =
    section < 1
      ? [chroma, secondary, 0]
      : section < 2
        ? [secondary, chroma, 0]
        : section < 3
          ? [0, chroma, secondary]
          : section < 4
            ? [0, secondary, chroma]
            : section < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const match = lightness - chroma / 2;
  return {
    r: Math.round((values[0] + match) * 255),
    g: Math.round((values[1] + match) * 255),
    b: Math.round((values[2] + match) * 255),
  };
};

const cssRgb = ({ r, g, b }: Rgb, alpha?: number) =>
  alpha === undefined
    ? `rgb(${r} ${g} ${b})`
    : `rgb(${r} ${g} ${b} / ${alpha})`;

export function createPosterPalette(color: Rgb): PosterPalette {
  const hsl = rgbToHsl(color);
  const accent = hslToRgb(
    hsl.hue,
    clamp(hsl.saturation, 0.52, 0.88),
    clamp(hsl.lightness, 0.46, 0.58),
  );
  const bright = hslToRgb(
    hsl.hue,
    clamp(hsl.saturation + 0.08, 0.6, 0.94),
    clamp(hsl.lightness + 0.14, 0.6, 0.72),
  );
  return {
    accent: cssRgb(accent),
    accentBright: cssRgb(bright),
    accentSoft: cssRgb(accent, 0.2),
    accentGlow: cssRgb(accent, 0.34),
  };
}

export const fallbackPosterPalette = (seed: number) => {
  const hue = (seed * 47 + 202) % 360;
  return createPosterPalette(hslToRgb(hue, 0.72, 0.52));
};
