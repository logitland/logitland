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

  const lab = ({ hue, chroma }: { hue: number; chroma: number }) => [
    chroma * Math.cos((hue * Math.PI) / 180),
    chroma * Math.sin((hue * Math.PI) / 180),
  ];

  // Proves assigned levels keep their colour and the ends hold the nearest assigned colour.
  it.each([
    ['an assigned level keeps its colour', 6, PURPLE],
    ['levels past the last keep its colour', 30, YELLOW],
    ['levels before the first keep its colour', 0, GREEN],
  ])('%s', (_, level, expected) => {
    const colour = levelColour(level, colours);
    expect(colour.hue).toBeCloseTo(expected.hue);
    expect(colour.chroma).toBeCloseTo(expected.chroma);
  });

  // Proves a gap is the straight OKLab line between its neighbours, as Mia asked: halfway is the midpoint of a and b,
  // so purple to yellow passes through a soft rose-grey rather than sweeping through red.
  it.each([
    ['green to purple', 4, GREEN, PURPLE],
    ['purple to yellow', 7, PURPLE, YELLOW],
  ])('halfway from %s is the OKLab midpoint', (_, level, from, to) => {
    const [a, b] = lab(levelColour(level, colours));
    const [[a1, b1], [a2, b2]] = [lab(from), lab(to)];
    expect(a).toBeCloseTo((a1 + a2) / 2);
    expect(b).toBeCloseTo((b1 + b2) / 2);
  });

  it('tweens out of white along the next colour’s hue', () => {
    const colour = levelColour(1, DEFAULT_COLOURS);
    expect(colour.hue).toBeCloseTo(DEFAULT_COLOURS[2].hue);
    expect(colour.chroma).toBeCloseTo(DEFAULT_COLOURS[2].chroma / 2);
  });
});
