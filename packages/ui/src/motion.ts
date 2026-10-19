// Motion helpers shared by the prototype and the SvelteKit app. Every one of them steps aside under
// prefers-reduced-motion, and none animates layout properties on high-frequency interactions.

export const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const motionOK = (): boolean => !reducedMotion?.matches;

/** Run a DOM update inside a same-document view transition. `plain` cross-fades without the page lift. */
export function transition(update: () => void, { plain = false } = {}): Promise<void> {
  if (!document.startViewTransition || !motionOK()) {
    update();
    return Promise.resolve();
  }
  const root = document.documentElement;
  if (plain) root.classList.add('vt-plain');
  const vt = document.startViewTransition(update);
  return vt.finished.catch(() => {}).finally(() => root.classList.remove('vt-plain'));
}

/** Replay the `.reveal` entrance on content that just appeared. */
export function reveal(el: Element | null | undefined): void {
  if (!el || !motionOK()) return;
  el.classList.remove('reveal');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('reveal');
  el.addEventListener('animationend', () => el.classList.remove('reveal'), { once: true });
}

/** Animate siblings from where they were to where a DOM change puts them (FLIP). */
export function flip(container: Element, mutate: () => void): void {
  const kids = [...container.children] as HTMLElement[];
  const before = new Map(kids.map((k) => [k, k.getBoundingClientRect()]));
  mutate();
  if (!motionOK()) return;
  for (const k of [...container.children] as HTMLElement[]) {
    if (k.hidden) continue;
    const a = before.get(k);
    const b = k.getBoundingClientRect();
    if (!a || (a.width === 0 && a.height === 0)) {
      k.animate(
        [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 280, easing: EASE },
      );
      continue;
    }
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (dx || dy) k.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 320, easing: EASE });
  }
}

/** Fold a row away, then hide or remove it. */
export async function collapse(el: HTMLElement, { remove = false } = {}): Promise<void> {
  if (motionOK()) {
    const h = el.offsetHeight;
    el.style.overflow = 'hidden';
    await el
      .animate(
        [
          { height: `${h}px`, opacity: 1 },
          { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' },
        ],
        { duration: 260, easing: EASE },
      )
      .finished.catch(() => {});
    el.style.overflow = '';
  }
  if (remove) el.remove();
  else el.hidden = true;
}

/** Show a spinner on a button for a moment, as if a request were in flight. Keeps keyboard focus. */
export function busy(btn: HTMLButtonElement | null | undefined, ms = 650): Promise<void> {
  if (!btn) return Promise.resolve();
  if (!btn.querySelector('.btn__spin')) btn.insertAdjacentHTML('afterbegin', '<span class="btn__spin" aria-hidden="true"></span>');
  // Disabling a focused button drops focus to <body>; put it back afterwards.
  const hadFocus = document.activeElement === btn;
  btn.classList.add('is-busy');
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  return new Promise((resolve) =>
    setTimeout(() => {
      btn.classList.remove('is-busy');
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
      if (hadFocus && !btn.hidden && document.activeElement === document.body) btn.focus();
      resolve();
    }, ms),
  );
}

/** A short scale pop, used on cord knots when their state changes. */
export function pop(el: Element | null | undefined): void {
  if (!el || !motionOK()) return;
  el.classList.remove('is-pop');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('is-pop');
  el.addEventListener('animationend', () => el.classList.remove('is-pop'), { once: true });
}
