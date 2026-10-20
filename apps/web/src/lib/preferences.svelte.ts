/** How XP bars are coloured: in each agent's own sigil colour, or by level, more saturated the higher it is. */
export type XpColour = 'agent' | 'level';

const XP_COLOUR_KEY = 'logitland:xp-colour';

/** Undefined during server rendering, where nothing is remembered. */
const storage = typeof localStorage === 'undefined' ? undefined : localStorage;

/** The viewer's display preferences, remembered in this browser. */
class Preferences {
  #xpColour = $state<XpColour>(storage?.getItem(XP_COLOUR_KEY) === 'level' ? 'level' : 'agent');

  get xpColour() {
    return this.#xpColour;
  }

  set xpColour(value: XpColour) {
    this.#xpColour = value;
    storage?.setItem(XP_COLOUR_KEY, value);
  }
}

export const preferences = new Preferences();
