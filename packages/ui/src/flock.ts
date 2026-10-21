import { flockDots, flockMotion } from '@logitland/flock';

/** Inline styles for each dot of an agent's flock, consumed by `.flock > i` in ui.css. */
export function flockDotStyles(id: string): string[] {
  const motion = flockMotion(id);
  return flockDots(id).map((d, j) => `--x:${d.x}%;--y:${d.y}%;--d:${d.size}%;--j:${j};--mx:${motion[j]!.dx}px;--my:${motion[j]!.dy}px`);
}

/** Fill a `<span class="flock" data-flock="agt_…">` with its seven dots. */
export function renderFlock(el: HTMLElement): void {
  const id = el.dataset.flock;
  if (!id) return;
  el.innerHTML = flockDotStyles(id)
    .map((style) => `<i style="${style}"></i>`)
    .join('');
  el.setAttribute('aria-hidden', 'true');
}
