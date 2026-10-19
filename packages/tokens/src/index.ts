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

/** The three faces: Bricolage Grotesque (display), Instrument Sans (text), Martian Mono at 87.5% width (machine values). */
export const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..700&family=Instrument+Sans:wght@400;500;600;700&family=Martian+Mono:wdth,wght@87.5,400;87.5,500&display=swap';

/** Inline script for <head>: applies the saved theme before first paint and marks the first visit for entrance motion. */
export const PREPAINT_SCRIPT =
  "try{var d=document.documentElement,t=localStorage.getItem('logitland-theme');if(t==='light'||t==='dark')d.dataset.theme=t;if(!sessionStorage.getItem('logitland-seen')){d.classList.add('first-load');sessionStorage.setItem('logitland-seen','1')}}catch(e){}";
