/**
 * PROTOTYPE: the level curve and colours, in memory. The admin dashboard edits them and both dashboards read them,
 * so a change shows on the owner side within the same browser session; a reload starts over.
 */
import { DEFAULT_COLOURS, DEFAULT_CURVE, levelColour, levelXp, type LevelColours, type LevelCurve } from '#lib/levels.js';

class LevelSettings {
  curve = $state<LevelCurve>({ ...DEFAULT_CURVE });
  colours = $state<LevelColours>(structuredClone(DEFAULT_COLOURS));

  reset() {
    this.curve = { ...DEFAULT_CURVE };
    this.colours = structuredClone(DEFAULT_COLOURS);
  }

  xp(level: number) {
    return levelXp(level, this.curve);
  }

  colour(level: number) {
    return levelColour(level, this.colours);
  }
}

export const levelSettings = new LevelSettings();
