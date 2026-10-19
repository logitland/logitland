// Svelte attachments/actions shared by the dashboard.

/** Place a native popover next to the button that opens it (right-aligned, flipping above when needed). */
export function anchored(node: HTMLElement) {
  const onToggle = (e: Event) => {
    if ((e as ToggleEvent).newState !== 'open') return;
    const anchor = document.querySelector(`[popovertarget="${node.id}"]`);
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const left = Math.max(16, Math.min(r.right - w, document.documentElement.clientWidth - w - 16));
    let top = r.bottom + 8;
    if (top + h > innerHeight - 16 && r.top - h - 8 > 16) top = r.top - h - 8;
    Object.assign(node.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
  };
  node.addEventListener('toggle', onToggle);
  return { destroy: () => node.removeEventListener('toggle', onToggle) };
}
