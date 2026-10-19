import { TextMorph } from 'torph';

// Text that changes morphs instead of snapping: words cross-fade by segment and numbers roll by place
// value (torph, https://torph.lochie.me). torph renders one line and respects reduced motion itself.

const morphs = new WeakMap<HTMLElement, TextMorph>();

export const MORPH_EASE = 'cubic-bezier(0.19, 1, 0.22, 1)';

export function attachMorph(el: HTMLElement): TextMorph {
  const existing = morphs.get(el);
  if (existing) return existing;
  const text = el.dataset.morphValue ?? (el.textContent ?? '').trim();
  el.dataset.morphValue = text;
  el.textContent = '';
  const m = new TextMorph({ element: el, duration: Number(el.dataset.morphDuration) || 420, ease: MORPH_EASE, locale: 'en' });
  m.update(text);
  morphs.set(el, m);
  return m;
}

/** Change an element's text through torph. The current text is kept in data-morph-value. */
export function morph(el: HTMLElement | null | undefined, value: string | number): void {
  if (!el) return;
  const text = String(value);
  attachMorph(el).update(text);
  el.dataset.morphValue = text;
}

/** The logical text of a morphing element (its DOM also holds torph's screen-reader copy). */
export const textOf = (el: HTMLElement | null | undefined): string => (el ? (el.dataset.morphValue ?? el.textContent ?? '') : '');

export function detachMorph(el: HTMLElement): void {
  morphs.get(el)?.destroy();
  morphs.delete(el);
}
