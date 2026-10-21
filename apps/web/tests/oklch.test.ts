import { describe, expect, it } from 'vitest';
import { linearRgb, maxChroma } from '../src/lib/oklch.ts';

describe('OKLCH to sRGB', () => {
  // Proves the conversion lands on known points, so the colour picker draws real colours.
  it('maps white and black to the ends of sRGB', () => {
    for (const [lightness, expected] of [
      [1, 1],
      [0, 0],
    ]) {
      for (const channel of linearRgb(lightness, 0, 0)) expect(channel).toBeCloseTo(expected, 4);
    }
  });

  // Proves the picker's ceiling is the edge of sRGB: at it every channel fits, and a little above it one doesn't.
  it.each([0, 90, 145, 255, 305])('finds the edge of sRGB at hue %i', (hue) => {
    const edge = maxChroma(0.86, hue);
    const fits = (chroma: number) => linearRgb(0.86, chroma, hue).every((c) => c >= -1e-4 && c <= 1 + 1e-4);
    expect(fits(edge)).toBe(true);
    expect(fits(edge + 0.01)).toBe(false);
  });
});
