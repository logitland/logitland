// Behaviour for static pages (the prototype), declared with data attributes. Page scripts import the
// helpers below; booting wires states, tabs, filters, dialogs, popovers, live values and copy buttons.
// Built into apps/prototype as assets/logitland.js.

import { lcg, seeded } from '@logitland/flock';
import { renderFlock } from './flock';
import { attachMorph, morph, textOf } from './morph';
import { busy, collapse, flip, motionOK, pop, reveal, transition } from './motion';

export { busy, collapse, flip, motionOK, morph, pop, renderFlock, reveal, seeded, textOf, transition };
export const rng = lcg;

const root = document.documentElement;

export const $ = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = document) => scope.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = document) => [...scope.querySelectorAll<T>(sel)];

export function remember(key: string, value?: string, kind: 'local' | 'session' = 'local'): string | null {
  try {
    const s = kind === 'session' ? sessionStorage : localStorage;
    if (value === undefined) return s.getItem(key);
    s.setItem(key, value);
  } catch {
    // Storage can be blocked (private windows, sandboxed frames); the page works without it.
  }
  return null;
}

/* ---------- Announcements and toasts ---------- */

let announcer: HTMLElement | undefined;
export function announce(message: string): void {
  if (!announcer) {
    announcer = document.createElement('div');
    announcer.className = 'sr-only';
    announcer.setAttribute('role', 'status');
    document.body.append(announcer);
  }
  const node = announcer;
  node.textContent = '';
  setTimeout(() => (node.textContent = message), 60);
}

let toastHost: HTMLElement | undefined;
export function toast(message: string, { duration = 3600 } = {}): void {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    document.body.append(toastHost);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = '<span class="dot" aria-hidden="true"></span><span></span>';
  t.lastElementChild!.textContent = message;
  toastHost.append(t);
  setTimeout(() => {
    if (!motionOK()) return t.remove();
    t.classList.add('is-out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  }, duration);
}

/* ---------- Timers and live values ---------- */

interface Ticker {
  ms: number;
  fn: () => void;
  last: number;
}
const tickers = new Set<Ticker>();
/** Run fn every ms while the page is visible. Returns a stop function. */
export function every(ms: number, fn: () => void): () => void {
  const t: Ticker = { ms, fn, last: performance.now() };
  tickers.add(t);
  return () => tickers.delete(t);
}
setInterval(() => {
  if (document.hidden) return;
  const now = performance.now();
  for (const t of tickers) {
    if (now - t.last >= t.ms - 20) {
      t.last = now;
      t.fn();
    }
  }
}, 250);

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const fill = (tpl: string, map: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(map[k] ?? ''));
const ago = (s: number) => (s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`);

const live = new WeakSet<Element>();
function initLive(scope: ParentNode = document): void {
  // data-countdown="238" data-format="Expires in {t}" data-expired="Expired"
  for (const el of $$('[data-countdown]', scope)) {
    if (live.has(el)) continue;
    live.add(el);
    let left = Number(el.dataset.countdown);
    const tpl = el.dataset.format || '{t}';
    el.dataset.morph = '';
    morph(el, fill(tpl, { t: clock(left) }));
    const stop = every(1000, () => {
      left -= 1;
      if (left <= 0) {
        stop();
        morph(el, el.dataset.expired || 'Expired');
        el.dispatchEvent(new CustomEvent('expired', { bubbles: true }));
        return;
      }
      morph(el, fill(tpl, { t: clock(left) }));
    });
  }
  // data-ago="4" data-format="Live · updated {t}" data-reset="15"
  for (const el of $$('[data-ago]', scope)) {
    if (live.has(el)) continue;
    live.add(el);
    let s = Number(el.dataset.ago);
    const tpl = el.dataset.format || '{t}';
    const reset = Number(el.dataset.reset) || 0;
    el.dataset.morph = '';
    morph(el, fill(tpl, { t: ago(s) }));
    every(1000, () => {
      s = reset && s >= reset ? 0 : s + 1;
      morph(el, fill(tpl, { t: ago(s) }));
      if (s === 0) el.dispatchEvent(new CustomEvent('refresh', { bubbles: true }));
    });
  }
  // data-tick="312" data-range="290,340" data-step="6" data-format="{n}/min" data-every="4000" data-dir="up"
  for (const el of $$('[data-tick]', scope)) {
    if (live.has(el)) continue;
    live.add(el);
    let n = Number(el.dataset.tick);
    const [lo = n * 0.9, hi = n * 1.1] = (el.dataset.range ?? '').split(',').filter(Boolean).map(Number);
    const step = Number(el.dataset.step) || Math.max(1, Math.round(n * 0.03));
    const tpl = el.dataset.format || '{n}';
    el.dataset.morph = '';
    morph(el, fill(tpl, { n: n.toLocaleString('en') }));
    every(Number(el.dataset.every) || 4000, () => {
      const delta = el.dataset.dir === 'up' ? Math.round(Math.random() * step) : Math.round((Math.random() * 2 - 1) * step);
      n = Math.min(hi, Math.max(lo, n + delta));
      morph(el, fill(tpl, { n: n.toLocaleString('en') }));
    });
  }
}

/* ---------- Theme ---------- */

const currentTheme = () => (root.dataset.theme === 'light' ? 'light' : 'dark');
export function setTheme(theme: 'dark' | 'light'): void {
  void transition(
    () => {
      root.dataset.theme = theme;
      remember('logitland-theme', theme);
      syncTheme();
    },
    { plain: true },
  );
}
function syncTheme(): void {
  const t = currentTheme();
  for (const b of $$('[data-theme-set]')) b.setAttribute('aria-pressed', String(b.dataset.themeSet === t));
  $$('.seg').forEach(placeSeg);
}

/* ---------- Segmented controls: a sliding selection ---------- */

const segSelected = (seg: Element) =>
  seg.querySelector<HTMLElement>(':scope > [aria-pressed="true"], :scope > [aria-selected="true"], :scope > [aria-current="page"]');
export function placeSeg(seg: HTMLElement): void {
  let ind = seg.querySelector<HTMLElement>(':scope > .seg__ind');
  if (!ind) {
    ind = document.createElement('span');
    ind.className = 'seg__ind';
    ind.setAttribute('aria-hidden', 'true');
    seg.prepend(ind);
  }
  const sel = segSelected(seg);
  if (!sel || !sel.offsetWidth) {
    ind.style.width = '0px';
    return;
  }
  ind.style.width = `${sel.offsetWidth}px`;
  ind.style.translate = `${sel.offsetLeft}px 0`;
  if (!seg.classList.contains('is-ready')) requestAnimationFrame(() => seg.classList.add('is-ready'));
}
const segs = new WeakSet<Element>();
function initSegs(scope: ParentNode = document): void {
  for (const seg of $$('.seg', scope)) {
    if (segs.has(seg)) continue;
    segs.add(seg);
    placeSeg(seg);
    new MutationObserver(() => placeSeg(seg)).observe(seg, {
      attributes: true,
      subtree: true,
      attributeFilter: ['aria-pressed', 'aria-selected', 'aria-current', 'hidden'],
    });
    new ResizeObserver(() => placeSeg(seg)).observe(seg);
  }
}

/* ---------- Page states: data-state scopes with data-when children ---------- */

const scopeOf = (el: Element) => el.parentElement?.closest('[data-state]');

export function setState(scopeOrSelector: HTMLElement | string | null, state: string, { focus = true, animate = true } = {}): void {
  const scope = typeof scopeOrSelector === 'string' ? $(scopeOrSelector) : scopeOrSelector;
  if (!scope) return;
  const prev = scope.dataset.state;
  scope.dataset.state = state;
  const shown: HTMLElement[] = [];
  for (const el of $$('[data-when]', scope)) {
    if (scopeOf(el) !== scope) continue;
    const on = (el.dataset.when ?? '').split(/\s+/).includes(state);
    if (on && el.hidden) {
      el.hidden = false;
      shown.push(el);
      if (animate) reveal(el);
    } else if (!on && !el.hidden) el.hidden = true;
  }
  for (const el of $$(`[data-text-${state}]`, scope)) morph(el, el.getAttribute(`data-text-${state}`) ?? '');
  for (const el of $$(`[data-class-${state}]`, scope)) {
    const next = el.getAttribute(`data-class-${state}`) ?? '';
    if (el.className !== next) {
      el.className = next;
      if (animate && el.classList.contains('knot')) pop(el);
    }
  }
  for (const el of $$(`[data-attr-${state}]`, scope)) {
    for (const pair of (el.getAttribute(`data-attr-${state}`) ?? '').split(';')) {
      const [k = '', ...v] = pair.split('=');
      if (k.trim()) el.setAttribute(k.trim(), v.join('=').trim());
    }
  }
  if (focus && shown.length) {
    const target = shown.map((s) => (s.matches('[data-focus]') ? s : s.querySelector<HTMLElement>('[data-focus]'))).find(Boolean) ?? shown[0]!;
    if (!target.matches('a, button, input, select, textarea, [tabindex]')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: false });
  }
  scope.dispatchEvent(new CustomEvent('statechange', { bubbles: true, detail: { state, prev } }));
}

function initStates(scope: ParentNode = document): void {
  for (const s of $$('[data-state]', scope)) setState(s, s.dataset.state ?? '', { focus: false, animate: false });
}

/* ---------- Tabs (APG pattern, automatic activation) ---------- */

export function selectTab(tab: HTMLElement, { focus = false } = {}): void {
  const list = tab.closest<HTMLElement>('[role="tablist"]');
  if (!list) return;
  for (const t of $$('[role="tab"]', list)) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
    if (panel) {
      const wasHidden = panel.hidden;
      panel.hidden = !on;
      if (on && wasHidden) reveal(panel);
    }
  }
  if (focus) tab.focus();
  list.dispatchEvent(new CustomEvent('tabchange', { bubbles: true, detail: { tab } }));
}
const tablists = new WeakSet<Element>();
function initTabs(scope: ParentNode = document): void {
  for (const list of $$('[role="tablist"]', scope)) {
    if (tablists.has(list)) continue;
    tablists.add(list);
    const tabs = $$('[role="tab"]', list);
    const current = tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs[0];
    tabs.forEach((t) => (t.tabIndex = t === current ? 0 : -1));
    list.addEventListener('click', (e) => {
      const t = (e.target as Element).closest<HTMLElement>('[role="tab"]');
      if (t) selectTab(t);
    });
    list.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      const vertical = list.getAttribute('aria-orientation') === 'vertical';
      const moves: Record<string, number> = {
        [vertical ? 'ArrowDown' : 'ArrowRight']: i + 1,
        [vertical ? 'ArrowUp' : 'ArrowLeft']: i - 1,
        Home: 0,
        End: tabs.length - 1,
      };
      const next = moves[e.key];
      if (next === undefined) return;
      e.preventDefault();
      selectTab(tabs[(next + tabs.length) % tabs.length]!, { focus: true });
    });
  }
}

/* ---------- Filters: chips and search over a list ---------- */

const chipOut = new WeakSet<Element>();
const searchOut = new WeakSet<Element>();

function applyVisibility(list: HTMLElement): void {
  const items = $$(':scope > [data-tags], :scope > [data-item]', list);
  flip(list, () => {
    for (const it of items) it.hidden = chipOut.has(it) || searchOut.has(it);
  });
  const n = items.filter((it) => !it.hidden).length;
  for (const c of $$(`[data-count-for="${list.id}"]`)) {
    const tpl = n === 1 ? (c.dataset.one ?? c.dataset.format ?? '{n}') : (c.dataset.format ?? '{n}');
    morph(c, fill(tpl, { n }));
  }
  for (const e of $$(`[data-empty-for="${list.id}"]`)) e.hidden = n > 0;
  list.dispatchEvent(new CustomEvent('filterchange', { bubbles: true, detail: { shown: n } }));
}
const wired = new WeakSet<Element>();
function initFilters(scope: ParentNode = document): void {
  for (const group of $$('[data-filter]', scope)) {
    if (wired.has(group)) continue;
    wired.add(group);
    const list = $(group.dataset.filter ?? '');
    group.addEventListener('click', (e) => {
      const chip = (e.target as Element).closest<HTMLElement>('[data-value]');
      if (!chip || !list) return;
      for (const c of $$('[data-value]', group)) c.setAttribute('aria-pressed', String(c === chip));
      const v = chip.dataset.value ?? 'all';
      for (const it of $$(':scope > [data-tags]', list)) {
        if (v !== 'all' && !(it.dataset.tags ?? '').split(/\s+/).includes(v)) chipOut.add(it);
        else chipOut.delete(it);
      }
      applyVisibility(list);
    });
  }
  for (const input of $$<HTMLInputElement>('[data-search]', scope)) {
    if (wired.has(input)) continue;
    wired.add(input);
    const list = $(input.dataset.search ?? '');
    input.addEventListener('input', () => {
      if (!list) return;
      const q = input.value.trim().toLowerCase();
      for (const it of $$(':scope > [data-tags], :scope > [data-item]', list)) {
        if (q !== '' && !(it.textContent ?? '').toLowerCase().includes(q)) searchOut.add(it);
        else searchOut.delete(it);
      }
      applyVisibility(list);
    });
  }
}

/* ---------- Copy ---------- */

const copyTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
const copyLabels = new WeakMap<Element, string>();

function selectContents(el: Element | null): void {
  if (!el) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  const s = getSelection();
  s?.removeAllRanges();
  s?.addRange(r);
}
async function copyFrom(btn: HTMLElement): Promise<void> {
  const source = btn.dataset.copyFrom ? $(btn.dataset.copyFrom) : null;
  const text = btn.dataset.copy ?? source?.textContent ?? '';
  const label = btn.querySelector<HTMLElement>('[data-morph]');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    selectContents(source);
    toast('Selected. Press Ctrl+C or ⌘C to copy.');
    return;
  }
  btn.classList.add('is-swapped');
  if (label) {
    if (!copyLabels.has(label)) copyLabels.set(label, textOf(label));
    morph(label, btn.dataset.copiedLabel ?? 'Copied');
  }
  announce(btn.dataset.copiedStatus ?? 'Copied');
  clearTimeout(copyTimers.get(btn));
  copyTimers.set(
    btn,
    setTimeout(() => {
      btn.classList.remove('is-swapped');
      if (label) morph(label, copyLabels.get(label) ?? 'Copy');
    }, 1800),
  );
}

/* ---------- Popovers placed next to their button ---------- */

function placePopover(popEl: HTMLElement, anchor: Element | null): void {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const w = popEl.offsetWidth;
  const h = popEl.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const left = Math.max(16, Math.min(r.right - w, vw - w - 16));
  let top = r.bottom + 8;
  if (top + h > innerHeight - 16 && r.top - h - 8 > 16) top = r.top - h - 8;
  Object.assign(popEl.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
}
function initPopovers(): void {
  document.addEventListener(
    'toggle',
    (e) => {
      const p = e.target;
      if (!(p instanceof HTMLElement) || !p.hasAttribute('popover') || (e as ToggleEvent).newState !== 'open') return;
      placePopover(p, document.querySelector(`[popovertarget="${p.id}"]`));
      $$('.seg', p).forEach(placeSeg);
    },
    true,
  );
}

/* ---------- Dialogs ---------- */

const openers = new WeakMap<HTMLDialogElement, HTMLElement>();
/** Open a modal from script; focus returns to `opener` when it closes. */
export function openDialog(dialog: HTMLDialogElement, opener?: HTMLElement): void {
  if (dialog.open) return;
  if (opener) openers.set(dialog, opener);
  dialog.showModal();
  dialog.dispatchEvent(new CustomEvent('opened'));
}
function initDialogs(): void {
  document.addEventListener('click', (e) => {
    const target = e.target as Element;
    const opener = target.closest<HTMLElement>('[data-open]');
    if (opener) {
      const d = document.getElementById(opener.dataset.open ?? '');
      if (d instanceof HTMLDialogElement && !d.open) {
        openers.set(d, opener);
        d.showModal();
        d.dispatchEvent(new CustomEvent('opened'));
      }
      return;
    }
    const closer = target.closest<HTMLElement>('[data-close]');
    if (closer) {
      closer.closest('dialog')?.close(closer.dataset.close ?? '');
      return;
    }
    if (target instanceof HTMLDialogElement && target.hasAttribute('data-light-dismiss')) {
      const r = target.getBoundingClientRect();
      const ev = e as MouseEvent;
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (!inside) target.close('dismiss');
    }
  });
  document.addEventListener(
    'cancel',
    (e) => {
      if (e.target instanceof HTMLDialogElement && e.target.hasAttribute('data-locked')) e.preventDefault();
    },
    true,
  );
  // Chrome's close watcher lets repeated Escape presses skip a prevented cancel, so stop the key itself.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && e.target instanceof Element && e.target.closest('dialog[open][data-locked]')) e.preventDefault();
    },
    true,
  );
  document.addEventListener(
    'close',
    (e) => {
      const opener = e.target instanceof HTMLDialogElement ? openers.get(e.target) : undefined;
      if (opener && document.contains(opener)) opener.focus();
    },
    true,
  );
}

/* ---------- Scenarios (prototype only) ---------- */

function scenarioList(): { key: string; label: string }[] {
  const raw = document.body.dataset.scenarios;
  if (!raw) return [];
  return raw.split(',').map((pair) => {
    const [key = '', ...label] = pair.split(':');
    return { key: key.trim(), label: label.join(':').trim() };
  });
}
export function setScenario(key: string, { animate = true } = {}): void {
  const apply = () => {
    document.body.dataset.scenario = key;
    for (const el of $$('[data-scenario-only]')) el.hidden = !(el.dataset.scenarioOnly ?? '').split(/\s+/).includes(key);
    for (const el of $$(`[data-scenario-text-${key}]`)) morph(el, el.getAttribute(`data-scenario-text-${key}`) ?? '');
    for (const el of $$(`[data-scenario-class-${key}]`)) el.className = el.getAttribute(`data-scenario-class-${key}`) ?? '';
    for (const b of $$('[data-scenario-set]')) b.setAttribute('aria-pressed', String(b.dataset.scenarioSet === key));
    document.dispatchEvent(new CustomEvent('scenariochange', { detail: { scenario: key } }));
  };
  if (animate) void transition(apply, { plain: true });
  else apply();
}

/* ---------- Prototype controls (not part of the product) ---------- */

function buildProto(): void {
  if (document.querySelector('[data-no-proto]')) return;
  const scenarios = scenarioList();
  const wrap = document.createElement('div');
  wrap.className = 'proto';
  wrap.innerHTML = `
    <button type="button" class="proto__btn" popovertarget="proto-panel"><span class="dot" aria-hidden="true"></span><span class="proto__label">Prototype</span></button>
    <div id="proto-panel" class="proto__panel" popover>
      <div class="stack">
        <div class="stack g-1">
          <span class="micro">Prototype controls</span>
          <span class="caption t-3">Switch how this mockup looks. These controls aren’t part of Logitland.</span>
        </div>
        <div class="stack g-2">
          <span class="label" id="proto-theme">Theme</span>
          <div class="seg" role="group" aria-labelledby="proto-theme">
            <button type="button" data-theme-set="dark" aria-pressed="false">Dark</button>
            <button type="button" data-theme-set="light" aria-pressed="false">Light</button>
          </div>
        </div>
        ${
          scenarios.length
            ? `<div class="stack g-2">
          <span class="label" id="proto-scn">Scenario</span>
          <div class="seg" role="group" aria-labelledby="proto-scn">
            ${scenarios.map((s) => `<button type="button" data-scenario-set="${s.key}" aria-pressed="false">${s.label}</button>`).join('')}
          </div>
        </div>`
            : ''
        }
        <a class="pop__item" href="index.html">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/></svg>
          All screens
        </a>
      </div>
    </div>`;
  document.body.append(wrap);
}

/* ---------- Boot ---------- */

function boot(): void {
  buildProto();
  $$('[data-flock]').forEach(renderFlock);
  for (const c of $$('.copybox > code')) if (!c.title) c.title = (c.textContent ?? '').trim();
  initStates();
  initTabs();
  initFilters();
  initSegs();
  initPopovers();
  initDialogs();
  initLive();
  syncTheme();

  const scenarios = scenarioList();
  if (scenarios.length) {
    const fromHash = scenarios.find((s) => `#${s.key}` === location.hash);
    setScenario(fromHash?.key ?? document.body.dataset.scenario ?? scenarios[0]!.key, { animate: false });
  }
  const hashTab = location.hash ? document.querySelector<HTMLElement>(`[role="tab"][aria-controls="${CSS.escape(location.hash.slice(1))}"]`) : null;
  if (hashTab) selectTab(hashTab);

  document.addEventListener('click', (e) => {
    const target = e.target as Element;
    const copy = target.closest<HTMLElement>('[data-copy], [data-copy-from]');
    if (copy) return void copyFrom(copy);
    const toastBtn = target.closest<HTMLElement>('[data-toast]');
    if (toastBtn) toast(toastBtn.dataset.toast ?? '');
    const themeBtn = target.closest<HTMLElement>('[data-theme-set]');
    if (themeBtn) return setTheme(themeBtn.dataset.themeSet === 'light' ? 'light' : 'dark');
    const scn = target.closest<HTMLElement>('[data-scenario-set]');
    if (scn) return setScenario(scn.dataset.scenarioSet ?? '');
    const setter = target.closest<HTMLButtonElement>('[data-set]');
    if (setter) {
      e.preventDefault();
      const scope = setter.dataset.scope ? $(setter.dataset.scope) : setter.closest<HTMLElement>('[data-state]');
      const go = () => setState(scope, setter.dataset.set ?? '');
      if (setter.dataset.busy) void busy(setter, Number(setter.dataset.busy)).then(go);
      else go();
    }
  });

  $$('[data-morph]').forEach(attachMorph);
  setTimeout(() => root.classList.remove('first-load'), 2600);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
