import { describe, expect, it } from 'vitest';
import { DEFAULT_COLOURS, DEFAULT_CURVE, levelColour, levelXp, type LevelColours } from '../src/lib/levels.ts';

describe('level thresholds', () => {
  // Proves every level's threshold follows `base × L^growth` with no cap, as settled on #6.
  it.each([
    [0, 0],
    [1, 250],
    [5, 6_250],
    [10, 25_000],
    [40, 400_000],
  ])('level %i starts at %i XP on the default curve', (level, xp) => {
    expect(levelXp(level, DEFAULT_CURVE)).toBe(xp);
  });

  it('rounds a fractional growth to whole XP', () => {
    expect(levelXp(2, { base: 100, growth: 1.5 })).toBe(283);
  });
});

describe('level colours', () => {
  const GREEN = { hue: 145, chroma: 0.16 };
  const PURPLE = { hue: 305, chroma: 0.16 };
  const YELLOW = { hue: 85, chroma: 0.12 };
  const colours: LevelColours = { 2: GREEN, 6: PURPLE, 8: YELLOW };

  // Proves assigned levels keep their colour, gaps tween, and the ends hold the nearest assigned colour.
  it.each([
    ['an assigned level keeps its colour', 6, PURPLE],
    ['a gap tweens hue and chroma halfway', 4, { hue: 225, chroma: 0.16 }],
    ['hue takes the shorter arc, through 0°', 7, { hue: 15, chroma: 0.14 }],
    ['levels past the last keep its colour', 30, YELLOW],
    ['levels before the first keep its colour', 0, GREEN],
  ])('%s', (_, level, expected) => {
    const colour = levelColour(level, colours);
    expect(colour.hue).toBeCloseTo(expected.hue);
    expect(colour.chroma).toBeCloseTo(expected.chroma);
  });

  it('tweens out of white along the next colour’s hue', () => {
    expect(levelColour(1, DEFAULT_COLOURS)).toEqual({ hue: DEFAULT_COLOURS[2].hue, chroma: DEFAULT_COLOURS[2].chroma / 2 });
  });
});
