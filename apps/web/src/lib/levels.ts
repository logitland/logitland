/**
 * Level thresholds and level colours, shared by both dashboards. Levels have no cap: the curve gives every level a
 * threshold, and the colour ramp gives every level a colour.
 */

/** The total XP to reach level L is `base × L^growth`; probation (level 0) starts at 0. */
export type LevelCurve = { base: number; growth: number };

export const DEFAULT_CURVE: LevelCurve = { base: 250, growth: 2 };

/** The XP an agent needs in total to reach `level`, rounded to a whole number. */
export const levelXp = (level: number, { base, growth }: LevelCurve) => (level <= 0 ? 0 : Math.round(base * level ** growth));

/**
 * An OKLCH colour without its lightness: each theme supplies that (see `.level-accent` in `app.css`), so one colour
 * keeps its contrast in light and dark. Chroma 0 is white in dark mode and grey in light; its hue is meaningless.
 */
export type LevelColour = { hue: number; chroma: number };

/** The colours an admin assigns, by level. Levels without one tween between their neighbours. */
export type LevelColours = Record<number, LevelColour>;

/** The colours admins pick from, in the order the picker lists them. */
export const COLOUR_PRESETS = [
  { name: 'White', hue: 0, chroma: 0 },
  { name: 'Green', hue: 145, chroma: 0.16 },
  { name: 'Cyan', hue: 200, chroma: 0.12 },
  { name: 'Blue', hue: 255, chroma: 0.16 },
  { name: 'Purple', hue: 305, chroma: 0.17 },
  { name: 'Pink', hue: 350, chroma: 0.16 },
  { name: 'Red', hue: 27, chroma: 0.19 },
  { name: 'Orange', hue: 55, chroma: 0.16 },
  { name: 'Yellow', hue: 90, chroma: 0.15 },
] as const satisfies (LevelColour & { name: string })[];

export type ColourName = (typeof COLOUR_PRESETS)[number]['name'];

export const colourPreset = (name: ColourName): LevelColour => {
  const { hue, chroma } = COLOUR_PRESETS.find((preset) => preset.name === name)!;
  return { hue, chroma };
};

/** The preset a stored colour came from, for labels and the audit log. */
export const colourName = (colour: LevelColour): ColourName | undefined =>
  COLOUR_PRESETS.find((preset) => preset.hue === colour.hue && preset.chroma === colour.chroma)?.name;

/** The classic game rarity ramp, spread over the first ten levels. */
export const DEFAULT_COLOURS: LevelColours = {
  0: colourPreset('White'),
  2: colourPreset('Green'),
  4: colourPreset('Blue'),
  6: colourPreset('Purple'),
  8: colourPreset('Yellow'),
  10: colourPreset('Red'),
};

/**
 * A level's colour: its own, or a tween in OKLCH between the nearest assigned levels on either side, with hue along
 * the shorter arc. Levels past the last assigned one keep its colour, and so do levels before the first.
 */
export function levelColour(level: number, colours: LevelColours): LevelColour {
  const assigned = Object.keys(colours)
    .map(Number)
    .sort((a, b) => a - b);
  const below = assigned.findLast((l) => l <= level);
  const above = assigned.find((l) => l >= level);
  if (below === undefined && above === undefined) return { hue: 0, chroma: 0 };
  if (below === undefined) return colours[above!];
  if (above === undefined || above === below) return colours[below];
  return mix(colours[below], colours[above], (level - below) / (above - below));
}

function mix(from: LevelColour, to: LevelColour, t: number): LevelColour {
  const chroma = from.chroma + (to.chroma - from.chroma) * t;
  // A colourless end has no hue of its own, so the tween takes the other end's.
  if (from.chroma === 0) return { hue: to.hue, chroma };
  if (to.chroma === 0) return { hue: from.hue, chroma };
  const turn = ((to.hue - from.hue + 540) % 360) - 180;
  return { hue: (from.hue + turn * t + 360) % 360, chroma };
}
