<script lang="ts">
  import { FLIP, Morph, announce, motionOK, rise, toast } from '@logitland/ui/svelte';
  import { applyAction, enhance, type SubmitFunction } from '$app/forms';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { ActOutcome, DeliveryAct, DeliveryItem } from '#lib/fixtures/deliveries.js';
  import { onMount, untrack } from 'svelte';
  import { flip } from 'svelte/animate';

  let { data } = $props();

  // Attempts appended by Retry, Send again and Replay live here (fixtures mode; see +page.server.ts).
  let items = $state<DeliveryItem[]>(untrack(() => structuredClone(data.deliveries)));
  let selectedId = $state(untrack(() => data.selected));
  const d = $derived(items.find((i) => i.id === selectedId));

  let q = $state('');
  const shown = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => [i.eventType, i.when, `${i.agent} ${i.channel ?? ''}`, i.row.text, ...i.ids].join(' ').toLowerCase().includes(needle));
  });

  // The relay's clock, so the scheduled attempt counts down and new attempts get a time.
  const toSec = (t: string) => t.split(':').reduce((s, n) => s * 60 + Number(n), 0);
  const hms = (s: number) => [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
  const start = untrack(() => toSec(data.clock));
  let t0 = 0;
  let elapsed = $state(0);
  const nowSec = () => start + (t0 ? Math.floor((Date.now() - t0) / 1000) : 0);
  onMount(() => {
    t0 = Date.now();
    const id = setInterval(() => {
      if (!document.hidden) elapsed = Math.floor((Date.now() - t0) / 1000);
    }, 1000);
    return () => clearInterval(id);
  });
  function nextLabel(at: string) {
    const left = toSec(at) - (start + elapsed);
    return left > 0 ? `in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'due now';
  }

  let detailEl = $state<HTMLElement>();
  async function pick(id: string) {
    if (id === selectedId) return;
    selectedId = id;
    announce(`Showing ${id}`);
    if (matchMedia('(max-width: 48rem)').matches) detailEl?.scrollIntoView({ block: 'start', behavior: motionOK() ? 'smooth' : 'auto' });
    await mirror(id);
  }

  // ?d=<id> keeps the pick across reloads; shallow, so the root layout skips its page view transition.
  async function mirror(id: string) {
    const url = new URL(page.url.href);
    url.searchParams.set('d', id);
    await goto(url, { replace: true, shallow: true });
  }

  // Body and Headers: APG tabs with automatic activation and a sliding indicator, like Seg.svelte.
  const TABS = ['body', 'headers'] as const;
  type Tab = (typeof TABS)[number];
  let tab = $state<Tab>('body');
  let tablist = $state<HTMLElement>();
  let segReady = $state(false);
  let ind = $state({ x: 0, w: 0 });
  function place() {
    const sel = tablist?.querySelector<HTMLElement>(':scope > [aria-selected="true"]');
    if (!sel) return;
    ind = { x: sel.offsetLeft, w: sel.offsetWidth };
    if (!segReady) requestAnimationFrame(() => (segReady = true));
  }
  $effect(() => {
    void tab;
    place();
  });
  $effect(() => {
    if (!tablist) return;
    const ro = new ResizeObserver(place);
    ro.observe(tablist);
    return () => ro.disconnect();
  });
  function onTabKey(e: KeyboardEvent) {
    const i = TABS.indexOf(tab);
    const moves: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 };
    const next = moves[e.key];
    if (next === undefined) return;
    e.preventDefault();
    tab = TABS[(next + TABS.length) % TABS.length]!;
    tablist?.querySelector<HTMLElement>(`#tab-${tab}`)?.focus();
  }

  // Retry now, Send again and Replay: a request, its attempt on the timeline, and a toast.
  let acting = $state(false);
  let actionBtn = $state<HTMLButtonElement>();
  const act: SubmitFunction = ({ formData, cancel }) => {
    if (acting) return cancel();
    const id = String(formData.get('id'));
    acting = true;
    return async ({ result }) => {
      acting = false;
      if (result.type === 'success' && result.data) land(id, result.data as ActOutcome & { act: DeliveryAct; becomes: ActOutcome['becomes'] | null });
      else if (result.type === 'failure') toast(String(result.data?.message ?? 'That didn’t go through. Try again.'));
      else await applyAction(result);
    };
  };
  function land(id: string, o: ActOutcome & { act: DeliveryAct; becomes: ActOutcome['becomes'] | null }) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    it.count += 1;
    if (o.act === 'retry') it.row.text = `Retrying · ${it.count} attempts`;
    if (o.becomes) Object.assign(it, structuredClone(o.becomes));
    const t = { ...o.attempt, at: hms(nowSec()) };
    const nextIdx = it.attempts.findIndex((a) => a.kind === 'next');
    if (nextIdx >= 0) it.attempts.splice(nextIdx, 0, t);
    else it.attempts.push(t);
    toast(o.message);
    if (!document.activeElement || document.activeElement === document.body) actionBtn?.focus();
  }

  const DOT = { wait: 'dot--wait', ok: '', fail: 'dot--fail' } as const;
  const TAG = { wait: 'tag--wait', ok: 'tag--plain', fail: 'tag--fail' } as const;
  const ROW_TEXT = { wait: 't-wait', ok: 't-2', fail: 't-fail' } as const;
  const RESULT = { fail: 't-fail', wait: 't-wait', ok: 't-ink', next: 't-3' } as const;
</script>

<svelte:head><title>Deliveries · Logitland</title></svelte:head>

<main id="main" class="o-main">
  <div class="page-head" data-enter="0">
    <div class="page-head__text measure">
      <h1 class="h1">Deliveries</h1>
      <p class="t-2">
        {data.live
          ? 'Events the relay sent to your agents’ receivers, each attempt, and how each one went.'
          : 'Every event the relay sent to your agents’ receivers, each attempt, and exactly what was sent.'}
      </p>
    </div>
    <div class="dl-search">
      <label class="sr-only" for="d-search">Search deliveries</label>
      <input class="input" id="d-search" type="search" placeholder="Event, delivery or message ID" autocomplete="off" bind:value={q} />
    </div>
  </div>

  <div class="dl">
    <section class="stack g-3 dl__list" aria-label="Delivery list" data-enter="1">
      <ul class="card card--flush dl-list" id="dl-list">
        {#each shown as it (it.id)}
          <li animate:flip={FLIP} in:rise>
            <button type="button" class="dl-row" aria-pressed={it.id === selectedId} onclick={() => pick(it.id)}>
              <span class="dot {DOT[it.row.tone]}" aria-hidden="true"></span>
              <span class="dl-row__text">
                <span class="dl-row__top"><span class="mono tiny">{it.eventType}</span><span class="caption t-3">{it.when}</span></span>
                <span class="small t-2">{it.channel ? `${it.agent} · ${it.channel}` : it.agent}</span>
                <Morph class="caption fw-600 {ROW_TEXT[it.row.tone]}" text={it.row.text} />
              </span>
            </button>
          </li>
        {/each}
        {#if !shown.length}<li class="dl-empty caption t-3">
            {items.length ? 'No deliveries match.' : 'Events sent to your agents’ receivers will show up here.'}
          </li>{/if}
      </ul>
      <span class="caption t-3 dl__keep">Deliveries are kept for 30 days after they finish.</span>
      {#if data.older}<a class="link dl__keep" href="?before={data.older}">Older deliveries</a>{/if}
    </section>

    {#if d}
      <section class="card card--lg dl__detail" id="detail" aria-labelledby="det-h" data-enter="2" bind:this={detailEl}>
        <div class="between det-head">
          <div class="stack g-2 det-head__text">
            <div class="cluster g-3">
              <Morph as="h2" id="det-h" class="mono det-id" text={d.id} />
              <span class="tag {TAG[d.tone]}" id="det-tag"
                ><span class="dot {DOT[d.tone]}" id="det-tag-dot" aria-hidden="true"></span><Morph id="det-state" text={d.state} /></span
              >
            </div>
            {#key d.id}<p class="small t-2" id="det-headline" in:rise>{d.headline}</p>{/key}
          </div>
          <form method="POST" action="?/{d.act ?? 'retry'}" use:enhance={act} hidden={!d.act || data.live}>
            <input type="hidden" name="id" value={d.id} />
            <button
              type="submit"
              class="btn"
              class:btn--primary={d.primary}
              class:is-busy={acting}
              aria-busy={acting || undefined}
              id="det-action"
              bind:this={actionBtn}><span class="btn__spin" aria-hidden="true"></span><Morph id="det-action-label" text={d.action || ' '} /></button
            >
          </form>
        </div>

        <dl class="facts" id="det-facts">
          {#each d.facts as f, j (j)}
            <div class="stack g-hair">
              <Morph as="dt" class="stat__label" text={f.label} /><Morph as="dd" class={f.mono ? 'mono tiny t-ink' : 'small t-ink'} text={f.value} />
            </div>
          {/each}
        </dl>

        {#if d.attempts.length}
          <div class="stack g-3">
            <h3 class="micro">Attempts</h3>
            <div id="att-wrap">
              {#key d.id}
                <ol class="thread" id="att-list" in:rise>
                  {#each d.attempts as t (t)}
                    <li in:rise>
                      <span
                        class="thread__knot"
                        class:thread__knot--fail={t.kind === 'fail'}
                        class:thread__knot--wait={t.kind === 'wait'}
                        class:thread__knot--ring={t.kind === 'next'}
                        class:att-ok={t.kind === 'ok'}
                        aria-hidden="true"
                      ></span>
                      <div class="att">
                        <span class="caption t-3">{t.at}</span>
                        <span class="small"><strong class="fw-600 {RESULT[t.kind]}">{t.result}</strong> <span class="t-3">{t.note}</span></span>
                        {#if t.kind === 'next'}<Morph class="caption t-3" id="next-in" text={nextLabel(t.at)} />{:else}<span class="caption t-3">{t.ms}</span
                          >{/if}
                      </div>
                    </li>
                  {/each}
                </ol>
              {/key}
            </div>
          </div>
        {/if}

        {#if d.body}
          <div class="stack g-3">
            <div class="seg tabs self-start" class:is-ready={segReady} role="tablist" aria-label="Show" bind:this={tablist}>
              <span class="seg__ind" aria-hidden="true" style="width: {ind.w}px; translate: {ind.x}px 0"></span>
              <button
                type="button"
                role="tab"
                id="tab-body"
                aria-selected={tab === 'body'}
                aria-controls="code-body"
                tabindex={tab === 'body' ? 0 : -1}
                onkeydown={onTabKey}
                onclick={() => (tab = 'body')}>Body</button
              >
              <button
                type="button"
                role="tab"
                id="tab-headers"
                aria-selected={tab === 'headers'}
                aria-controls="code-headers"
                tabindex={tab === 'headers' ? 0 : -1}
                onkeydown={onTabKey}
                onclick={() => (tab = 'headers')}>Headers</button
              >
            </div>
            {#key `${d.id}:${tab}`}
              <!-- The panels are the pre blocks themselves, as in the prototype. -->
              <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
              <pre class="code" id="code-body" role="tabpanel" aria-labelledby="tab-body" tabindex="0" hidden={tab !== 'body'} in:rise>{d.body}</pre>
              <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
              <pre
                class="code"
                id="code-headers"
                role="tabpanel"
                aria-labelledby="tab-headers"
                tabindex="0"
                hidden={tab !== 'headers'}
                in:rise>{d.headers}</pre>
            {/key}
            {#if tab === 'body'}
              <span class="caption t-3" id="note-body" in:rise>The event as the receiver got it.</span>
            {:else}
              <span class="caption t-3" id="note-headers" in:rise
                >Built fresh for each attempt from a fixed list. No keys, tokens or cookies are ever attached.</span
              >
            {/if}
          </div>
        {/if}

        {#if d.cursor}
          <p class="small t-2 det-foot">
            Missed events? Read the channel from cursor <Morph class="mono tiny t-ink det-cursor" id="det-cursor" text={d.cursor} />. Reads return messages that
            still exist; missed edits and deletions only arrive as events.
          </p>
        {:else if data.live}
          <p class="small t-2 det-foot">
            Missed events? An agent can read the channel again through the API. Reads return messages that still exist; missed edits and deletions only arrive
            as events.
          </p>
        {/if}
      </section>
    {/if}
  </div>
</main>

<style>
  .dl-search {
    width: 300px;
    max-width: 100%;
  }
  .dl {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-6);
    align-items: flex-start;
  }
  .dl__list {
    flex: 1 1 320px;
  }
  .dl__detail {
    flex: 999 1 560px;
  }
  .dl__keep {
    padding-inline: var(--s-1);
  }
  .dl-list > li ~ li {
    border-top: 1px solid var(--line);
  }
  .dl-empty {
    padding: var(--s-4) 20px;
  }
  .dl-row {
    width: 100%;
    display: flex;
    gap: var(--s-3);
    align-items: flex-start;
    padding: var(--s-4) 20px;
    border: 0;
    background: transparent;
    color: var(--ink);
    text-align: start;
  }
  .dl-row:hover {
    background: color-mix(in oklch, var(--sunken) 70%, transparent);
  }
  .dl-row[aria-pressed='true'] {
    background: var(--act-soft);
  }
  .dl-row:focus-visible {
    outline-offset: -2px;
  }
  .dl-row > .dot {
    margin-top: 8px;
  }
  .dl-row__text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .dl-row__top {
    display: flex;
    justify-content: space-between;
    gap: var(--s-2);
  }
  .det-head {
    align-items: flex-start;
  }
  .det-head__text {
    max-width: 520px;
  }
  .det-head :global(.det-id) {
    font-size: 18px;
    font-weight: 500;
    color: var(--ink);
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
    gap: var(--s-4) var(--s-5);
  }
  .facts :global(dd) {
    min-width: 0;
  }
  .att {
    display: grid;
    grid-template-columns: 80px minmax(0, 1fr) auto;
    gap: var(--s-4);
    align-items: baseline;
    min-width: 0;
  }
  .att-ok {
    background: var(--ink);
  }
  .det-foot {
    padding-top: var(--s-5);
    border-top: 1px solid var(--line);
  }
  .det-foot :global(.det-cursor) {
    vertical-align: baseline;
  }
  @media (max-width: 48rem) {
    .dl-search {
      width: 100%;
    }
  }
  @media (max-width: 30rem) {
    .att {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'at ms' 'res res';
      row-gap: 0;
    }
    .att > :nth-child(1) {
      grid-area: at;
    }
    .att > :nth-child(2) {
      grid-area: res;
    }
    .att > :global(:nth-child(3)) {
      grid-area: ms;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .dl-row {
      transition: background-color var(--dur-fast) ease-out;
    }
  }
</style>
