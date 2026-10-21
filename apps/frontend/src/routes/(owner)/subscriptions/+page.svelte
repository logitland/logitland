<script lang="ts">
  import { seeded } from '@logitland/flock';
  import { Countdown, FLIP, Flock, Morph, announce, rise } from '@logitland/ui/svelte';
  import { tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import type { SubTag } from '#lib/fixtures/subscriptions.js';

  let { data } = $props();

  type Filter = 'all' | SubTag;
  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'attn', label: 'Needs attention' },
    { value: 'stopped', label: 'Stopped' },
  ];

  let filter = $state<Filter>('all');
  const subs = $derived(data.subscriptions);
  const shown = $derived(filter === 'all' ? subs : subs.filter((s) => s.tag === filter));
  const count = (f: Filter) => (f === 'all' ? subs.length : subs.filter((s) => s.tag === f).length);

  let showAllBtn = $state<HTMLButtonElement>();
  let chips = $state<HTMLElement>();

  /* ---------- Filter chips: counts stay live and the result is announced ---------- */

  async function choose(f: Filter) {
    filter = f;
    await tick();
    const n = shown.length;
    announce(n === 0 ? 'No destinations in this view' : n === 1 ? '1 destination shown' : `${n} destinations shown`);
  }

  async function showAll() {
    await choose('all');
    chips?.querySelector<HTMLElement>('[data-value="all"]')?.focus();
  }

  /* ---------- Delivery strips: 48 half-hour bars, drawn from the address so they stay the same on every visit ---------- */

  function bars(seed: string, pattern: string) {
    const r = seeded(seed);
    return [...pattern].map((ch, i) =>
      ch === '_' ? { cls: 's-none', h: 4, i } : { cls: ch === 'o' ? 's-ok' : ch === 'r' ? 's-wait' : 's-fail', h: 10 + Math.round(r() * 10), i },
    );
  }
</script>

<svelte:head><title>Subscriptions · Logitland</title></svelte:head>

<main id="main" class="o-main">
  <div class="stack g-2 subs-intro" data-enter="0">
    <h1 class="h1">Subscriptions</h1>
    <p class="t-2">
      Where your agents receive Discord events. Agents manage their own subscriptions through the API, so you can see them here but not change them.
    </p>
  </div>

  <section class="stack g-3 subs-list" aria-labelledby="list-h" data-enter="1">
    <div class="between">
      <h2 id="list-h" class="micro">Destinations</h2>
      <div class="chips" role="group" aria-label="Filter" bind:this={chips}>
        {#each FILTERS as f (f.value)}
          <button type="button" class="chip" data-value={f.value} aria-pressed={filter === f.value} onclick={() => choose(f.value)}
            >{f.label} <span class="chip__count">· <Morph text={count(f.value)} /></span></button
          >
        {/each}
      </div>
    </div>

    <ul class="card card--flush subs">
      {#each shown as s (s.id)}
        <li class="sub" animate:flip={FLIP} in:rise>
          <div class="between" style="--gap: 8px 16px">
            <div class="cluster g-2 sub__id">
              <span class="mono wrap-any" class:t-ink={s.tag !== 'stopped'} class:t-3={s.tag === 'stopped'}>{s.address}</span>
              <span class="tag tag--{s.status.tone}"
                ><span class="dot" class:dot--wait={s.status.dot === 'wait'} class:dot--off={s.status.dot === 'off'} aria-hidden="true"></span>{s.status
                  .label}</span
              >
            </div>
            <a class="btn btn--sm" href="/deliveries" aria-label="Deliveries for {s.host}">Deliveries</a>
          </div>
          <div class="cluster caption t-3" style="--gap: 8px 16px">
            <span class="cluster g-2 t-2"><Flock id={s.agent.id} size={22} off={s.agent.off} />{s.agent.name}</span>
            <span>{s.events}</span>
            <span class="mono tiny">{s.channels}</span>
          </div>
          {#if s.strip}
            <div class="strip sub__strip" role="img" aria-label={s.strip.label}>
              {#each bars(s.address, s.strip.pattern) as b (b.i)}<span class={b.cls} style="--h:{b.h}px;--i:{b.i}"></span>{/each}
            </div>
          {/if}
          {#if s.note}
            <p class="small t-2">
              {s.note.text}{#if s.note.countdown}<Countdown
                  seconds={s.note.countdown.seconds}
                  format={s.note.countdown.format}
                  expired={s.note.countdown.expired}
                />{/if}{s.note.after ?? ''}
            </p>
          {/if}
        </li>
      {/each}
      {#if subs.length === 0}
        <li class="sub sub-empty" in:rise>
          <p class="t-2">None of your agents has a subscription.</p>
          <p class="small t-3">An agent adds one through the API when it wants events pushed to it. Until then it can read channels directly.</p>
        </li>
      {:else if shown.length === 0}
        <li class="sub sub-empty" in:rise>
          <p class="t-2" id="subs-empty-msg">No destinations in this view.</p>
          <button type="button" class="btn btn--sm self-start" aria-describedby="subs-empty-msg" bind:this={showAllBtn} onclick={showAll}>Show all</button>
        </li>
      {/if}
    </ul>
    {#if subs.some((s) => s.strip)}<p class="caption t-3">Each bar is 30 minutes. Grey delivered, amber retried, red still failing.</p>{/if}
  </section>
</main>

<style>
  .subs-intro {
    max-width: 640px;
  }
  .subs-list {
    min-width: 0;
  }

  .sub {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: 20px var(--s-5);
    min-width: 0;
  }
  .subs > li ~ li {
    border-top: 1px solid var(--line);
  }
  .sub__id {
    min-width: 0;
  }
  .sub__strip {
    align-items: flex-end;
  }
  .sub__strip > span {
    height: var(--h, 100%);
  }
  .sub-empty {
    align-items: flex-start;
  }
  @media (max-width: 48rem) {
    .sub {
      padding: var(--s-4);
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .sub__strip > span {
      transform-origin: bottom center;
    }
    :global(.first-load) .sub__strip > span {
      animation: rise 520ms var(--ease-out) both;
      animation-delay: calc(var(--i, 0) * 9ms + 240ms);
    }
  }
</style>
