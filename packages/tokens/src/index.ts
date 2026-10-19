// Token names for code that colours things in JavaScript (charts, canvas, Svelte props).
// Values live in tokens.css so both themes stay in one place; reference them as CSS variables.

/** Colour carries meaning. Use these four roles; never pick a hue for decoration. */
export const MEANING = {
  act: { token: '--act', text: '--act-text', soft: '--act-soft', means: 'You can press it, or it is selected' },
  wait: { token: '--wait', mark: '--wait-mark', soft: '--wait-soft', means: 'Waiting on someone, or a decision is needed' },
  fail: { token: '--fail', mark: '--fail-mark', soft: '--fail-soft', means: 'Broken or refused' },
  quiet: { token: '--ink', mark: '--quiet-mark', soft: '--sunken', means: 'Healthy, nothing to do' },
} as const;

export type Meaning = keyof typeof MEANING;

export const cssVar = (name: string) => `var(${name})`;

export const THEMES = ['dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];
/** Dark is the default; light applies under [data-theme="light"]. */
export const DEFAULT_THEME: Theme = 'dark';
