// Svelte transitions matching the stylesheet's motion: content rises in (opacity, 8px lift, 4px blur)
// and folds away softly. Both collapse to nothing under prefers-reduced-motion.
import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';
import { motionOK } from '../motion';

/** Enter: the same "reveal" as .reveal in ui.css. */
export function rise(_node: Element, { delay = 0, duration = 360 } = {}): TransitionConfig {
  if (!motionOK()) return { duration: 0 };
  return {
    delay,
    duration,
    easing: cubicOut,
    css: (t, u) => `opacity: ${t}; translate: 0 ${u * 8}px; filter: blur(${u * 4}px);`,
  };
}

/** Exit: fold a row's height away while it fades (use as out:fold on list items). */
export function fold(node: Element, { duration = 260 } = {}): TransitionConfig {
  if (!motionOK()) return { duration: 0 };
  const style = getComputedStyle(node);
  const h = parseFloat(style.height);
  const pt = parseFloat(style.paddingTop);
  const pb = parseFloat(style.paddingBottom);
  return {
    duration,
    easing: cubicOut,
    css: (t) => `overflow: hidden; opacity: ${t}; height: ${t * h}px; padding-top: ${t * pt}px; padding-bottom: ${t * pb}px;`,
  };
}

/** Options for svelte/animate's flip so list reordering matches flip() in motion.ts. */
export const FLIP = { duration: 320, easing: cubicOut } as const;
