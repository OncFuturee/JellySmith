import type { CSSProperties } from "react";
import type { TmdbImageColor } from "../models";

type Hsl = { hue: number; saturation: number; lightness: number };
type ThemeStyle = CSSProperties & Record<`--detail-${string}`, string>;

export type DetailTheme = {
  style: ThemeStyle;
  control: string;
  controlHover: string;
  popup: string;
  popupBorder: string;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const toHsl = ({ red, green, blue }: TmdbImageColor): Hsl => {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === r) hue = ((g - b) / delta) % 6;
    else if (maximum === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const lightness = (maximum + minimum) / 2;
  const saturation = delta
    ? delta / (1 - Math.abs(2 * lightness - 1))
    : 0;
  return { hue, saturation, lightness };
};

const hsl = (
  color: Hsl,
  saturation: number,
  lightness: number,
  alpha?: number,
) =>
  alpha === undefined
    ? `hsl(${Math.round(color.hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%)`
    : `hsl(${Math.round(color.hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}% / ${alpha})`;

const tuned = (color: Hsl, saturationOffset = 0): Hsl => ({
  hue: color.hue,
  saturation: clamp(color.saturation + saturationOffset, 0.38, 0.82),
  lightness: color.lightness,
});

export function createDetailTheme(colors: TmdbImageColor[]): DetailTheme | undefined {
  if (!colors.length) return undefined;
  const primary = tuned(toHsl(colors[0]), 0.08);
  const secondary = tuned(toHsl(colors[1] ?? colors[0]), -0.06);
  const tertiary = tuned(toHsl(colors[2] ?? colors[1] ?? colors[0]), -0.12);
  const accent = hsl(primary, primary.saturation, 0.54);
  const accentHover = hsl(primary, clamp(primary.saturation + 0.06, 0, 0.9), 0.62);
  const control = hsl(primary, clamp(primary.saturation, 0.5, 0.78), 0.43);
  const controlHover = hsl(primary, clamp(primary.saturation + 0.05, 0, 0.86), 0.51);
  const popup = `linear-gradient(145deg, ${hsl(primary, 0.58, 0.31, 0.99)}, ${hsl(secondary, 0.48, 0.2, 0.99)})`;
  const border = hsl(primary, 0.68, 0.76, 0.42);

  return {
    control,
    controlHover,
    popup,
    popupBorder: hsl(primary, 0.62, 0.8, 0.52),
    style: {
      "--detail-bg": hsl(secondary, 0.34, 0.1),
      "--detail-bg-soft": hsl(secondary, 0.4, 0.15, 0.9),
      "--detail-surface": `linear-gradient(180deg, ${hsl(secondary, 0.48, 0.25, 0.8)}, ${hsl(tertiary, 0.42, 0.15, 0.9)})`,
      "--detail-card": `linear-gradient(105deg, ${hsl(tertiary, 0.46, 0.24, 0.88)}, ${hsl(secondary, 0.4, 0.16, 0.82)})`,
      "--detail-footer": `linear-gradient(180deg, ${hsl(secondary, 0.38, 0.13, 0.5)}, ${hsl(tertiary, 0.34, 0.09, 0.94)})`,
      "--detail-accent": accent,
      "--detail-accent-hover": accentHover,
      "--detail-accent-soft": hsl(primary, 0.7, 0.56, 0.26),
      "--detail-control": control,
      "--detail-control-hover": controlHover,
      "--detail-border": border,
      "--detail-border-strong": hsl(primary, 0.7, 0.82, 0.62),
      "--detail-glow": hsl(primary, 0.74, 0.52, 0.28),
      "--detail-text": "rgb(248 252 255)",
      "--detail-text-secondary": "rgb(218 231 242)",
      "--detail-text-muted": "rgb(164 190 211)",
    },
  };
}

