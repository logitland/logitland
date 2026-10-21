/**
 * OKLCH to sRGB, for drawing colour pickers. Formulas from Björn Ottosson's OKLab definition
 * (https://bottosson.github.io/posts/oklab/).
 */

/** The lightness and chroma scale `.level-accent` applies per theme (see `app.css`). */
export const BAR_LIGHTNESS = { light: { lightness: 0.6, chroma: 1 }, dark: { lightness: 0.86, chroma: 0.87 } } as const;

/** Linear-light sRGB channels for an OKLCH colour; values outside 0–1 are outside sRGB. */
export function linearRgb(lightness: number, chroma: number, hue: number): [number, number, number] {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** sRGB 0–255 channels, gamma-encoded for a canvas. */
export const srgb = (channels: [number, number, number]) =>
  channels.map((c) => {
    const v = Math.min(1, Math.max(0, c));
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  }) as [number, number, number];

/**
 * The highest chroma sRGB can show for this hue and lightness. Drawing anything above it at this chroma instead keeps
 * hue and lightness and avoids the hue shifts of clipping each channel.
 */
export function maxChroma(lightness: number, hue: number, ceiling = 0.4): number {
  const fits = (chroma: number) => linearRgb(lightness, chroma, hue).every((c) => c >= -1e-4 && c <= 1 + 1e-4);
  let [low, high] = [0, ceiling];
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return low;
}
