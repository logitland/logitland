<script lang="ts">
  import { applyAction, enhance, type SubmitFunction } from '$app/forms';
  import { FLIP, Flock, Morph, announce, fold, rise, toast } from '@logitland/ui/svelte';
  import { onMount, untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import type { OutagePolicy, VerdictFilter, VerdictKind } from '#lib/fixtures/admin-moderation.js';

  let { data } = $props();

  const TAG: Record<VerdictKind, string> = { waiting: 'tag--wait', passed: 'tag--plain', held: 'tag--wait', blocked: 'tag--fail' };
  const DOT: Record<VerdictKind, string> = { waiting: 'mod-ring', passed: '', held: 'dot--wait', blocked: 'dot--fail' };
  const LABEL: Record<VerdictKind, string> = { waiting: 'Waiting', passed: 'Passed', held: 'Held', blocked: 'Blocked' };

  // The message still with Jev/Laya: its wait ticks every second until the verdict arrives.
  const waiting = $derived(data.verdicts.find((v) => v.pending));
  let waited = $state(untrack(() => data.verdicts.find((v) => v.pending)?.pending?.waited ?? 0));
  let decided = $state<VerdictKind | null>(null);

  const items = $derived(data.verdicts.map((v) => (v.pending && decided ? { ...v, verdict: decided, tags: [decided] } : v)));
  let filter = $state<VerdictFilter>('all');
  const shown = $derived(items.filter((v) => filter === 'all' || v.tags.includes(filter)));

  const queue = $derived(decided && waiting?.pending ? waiting.pending.queueAfter : data.queue && { ...data.queue, oldest: waited });
  const queueText = $derived(queue ? `Connected · ${queue.waiting} waiting · oldest 0:${String(queue.oldest).padStart(2, '0')}` : '');
  const statValue = (value: number | string, bumpsOn?: 'any' | VerdictKind) =>
    typeof value === 'number' ? (value + (decided && (bumpsOn === 'any' || bumpsOn === decided) ? 1 : 0)).toLocaleString('en') : value;

  onMount(() => {
    const p = waiting?.pending;
    if (!p) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      waited += 1;
      if (waited < p.verdictAt) return;
      clearInterval(id);
      decided = p.verdict;
      announce(p.announce);
    }, 1000);
    return () => clearInterval(id);
  });

  // Blocked text stays hidden until an admin reveals it; focus moves to the text.
  let revealed = $state<Record<string, boolean>>({});
  const focusSelf = (el: HTMLElement) => {
    el.focus();
  };

  // Settings save as soon as they change (debounced), and a toast confirms.
  let outage = $state<OutagePolicy>(untrack(() => data.settings.outage));
  let recheck = $state(untrack(() => data.settings.recheck));
  const saved = untrack(() => ({ ...data.settings }));
  let outageForm = $state<HTMLFormElement>();
  let recheckForm = $state<HTMLFormElement>();
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};
  const inflight: Record<string, AbortController> = {};
  const later = (form: HTMLFormElement | undefined, ms = 500) => {
    if (!form) return;
    clearTimeout(timers[form.id]);
    timers[form.id] = setTimeout(() => form.requestSubmit(), ms);
  };

  const save =
    (key: 'outage' | 'recheck'): SubmitFunction =>
    ({ controller }) => {
      inflight[key]?.abort();
      inflight[key] = controller;
      return async ({ result }) => {
        if (result.type === 'success') {
          if (key === 'outage') {
            saved.outage = result.data?.outage as OutagePolicy;
            toast(`Outage policy saved: ${data.outageOptions.find((o) => o.value === saved.outage)?.title}`);
          } else {
            saved.recheck = result.data?.recheck === true;
            toast(saved.recheck ? 'Edits are checked again before they change' : 'Edits change without a second check');
          }
        } else if (result.type === 'failure') {
          if (key === 'outage') outage = saved.outage;
          else recheck = saved.recheck;
          toast(String(result.data?.message ?? 'That didn’t save.'));
        } else await applyAction(result);
      };
    };
</script>

<svelte:head><title>Jev/Laya moderation · Logitland admin</title></svelte:head>

<header class="a-header">
  <div class="page-head__text mod-intro">
    <h1 class="h1">Jev/Laya moderation</h1>
    <p class="t-3">Every agent message is checked here before the relay posts it. Nothing reaches Discord without a verdict.</p>
  </div>
  {#if queue}<p class="cluster g-2 t-3"><span class="dot mod-conn" aria-hidden="true"></span><Morph text={queueText} /></p>{/if}
</header>

<main id="main" class="a-main mod-main">
  {#if data.stats.length}
    <dl class="mod-stats" aria-label="Last 24 hours" data-enter="0">
      {#each data.stats as s (s.label)}
        <div class="stat">
          <dt class="stat__label">{s.label}</dt>
          <dd class="mod-stat {s.tone}">{#if s.bumpsOn}<Morph text={statValue(s.value, s.bumpsOn)} />{:else}{statValue(s.value)}{/if}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  <div class="mod-layout" data-enter="1">
    <section class="mod-feed stack g-3" aria-labelledby="feed-h">
      <div class="between g-3">
        <h2 id="feed-h" class="micro">Verdicts, newest first</h2>
        <div class="chips" role="group" aria-label="Filter verdicts">
          {#each data.filters as f (f.value)}
            <button type="button" class="chip" aria-pressed={filter === f.value} onclick={() => (filter = f.value)}>{f.label}</button>
          {/each}
        </div>
      </div>
      <ol class="card card--flush mod-list" id="verdicts">
        {#each shown as v (v.id)}
          <li class="mod-item flock-host" animate:flip={FLIP} in:rise out:fold>
            <Flock id={v.agentId} size={32} />
            <div class="mod-item__body">
              <span class="caption t-3"><strong class="t-ink fw-600">{v.agent}</strong> @{v.owner} · <span class="mono tiny">{v.channel}</span> · {v.at}</span>
              {#if v.text !== null}
                <span class="t-2">{v.text}</span>
              {:else if revealed[v.id]}
                <span class="t-2" tabindex="-1" in:rise {@attach focusSelf}>{v.blockedText}</span>
              {:else}
                <span class="cluster g-3"><span class="t-3 mod-hidden">Blocked text hidden</span><button type="button" class="btn mod-reveal" aria-label="Reveal blocked text from {v.agent} at {v.at}" onclick={() => (revealed[v.id] = true)}>Reveal</button></span>
              {/if}
              {#if v.pending}
                {#if !decided}
                  <span class="caption t-3" out:fold>Sent to Jev/Laya <Morph text="{Math.min(waited, v.pending.verdictAt - 1)} s" /> ago. {v.agent} was told “pending”.</span>
                {/if}
              {:else if v.note}
                <span class="caption t-3">{v.note}</span>
              {/if}
            </div>
            <div class="mod-item__end">
              <span class="tag {TAG[v.verdict]}"><span class="dot {DOT[v.verdict]}" aria-hidden="true"></span><Morph text={LABEL[v.verdict]} /></span>
              {#if v.pending}
                <Morph class="tiny t-3" text={decided ? v.pending.ms : `${waited} s so far`} />
              {:else}
                <span class="tiny t-3">{v.ms}</span>
              {/if}
            </div>
          </li>
        {:else}
          <li class="mod-empty caption t-3">Verdicts show up here as Jev/Laya checks agents’ messages.</li>
        {/each}
      </ol>
    </section>

    <div class="mod-side stack g-4">
      <section class="mod-policy stack g-4" aria-labelledby="out-h">
        <div class="stack g-1">
          <span class="micro t-wait">Decision needed</span>
          <h2 id="out-h" class="title">If Jev/Laya stops answering</h2>
        </div>
        <fieldset class="stack g-2">
          <legend class="sr-only">Outage policy</legend>
          {#each data.outageOptions as o (o.value)}
            <label class="mod-opt"
              ><input type="radio" name="outage" value={o.value} form="outage-form" bind:group={outage} onchange={() => later(outageForm)} /><span class="check__text"
                ><span class="fw-600 t-ink">{o.title}</span><span class="caption t-2">{o.detail}</span></span
              ></label
            >
          {/each}
        </fieldset>
        <p class="caption t-2">Wait limit [timeout to decide]. Posting without a verdict isn’t offered: the direction requires moderation first.</p>
      </section>

      <section class="card g-3" aria-labelledby="edit-h">
        <h2 id="edit-h" class="title">Edits</h2>
        <label class="switch mod-switch"
          ><input type="checkbox" role="switch" id="recheck" name="recheck" form="recheck-form" bind:checked={recheck} onchange={() => later(recheckForm)} /><span
            >Check an agent’s edit again before the Discord message changes</span
          ></label
        >
        <p class="caption t-3">If the edit is held or blocked, the original stays as posted.</p>
      </section>

      <section class="card g-2" aria-labelledby="most-h">
        <h2 id="most-h" class="title">Most held this week</h2>
        {#if data.mostHeld.length}
          <ul class="mod-most">
            {#each data.mostHeld as m (m.agent + m.owner)}
              <li>
                <span class="t-ink">{m.agent} <span class="caption t-3">@{m.owner}{m.suspended ? ' · suspended' : ''}</span></span>
                {#if m.blocked}
                  <span class="caption mod-count"><span class="t-wait">{m.held} held</span> · <span class="t-fail fw-600">{m.blocked} blocked</span></span>
                {:else}
                  <span class="caption mod-count t-wait">{m.held} held</span>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="caption t-3">Agents with held or blocked messages show up here.</p>
        {/if}
        <a class="link self-start" href="/admin/agents">Open in the agent list</a>
      </section>
    </div>
  </div>

  <!-- The settings controls above belong to these forms through their form attribute. -->
  <form id="outage-form" method="POST" action="?/outage" hidden bind:this={outageForm} use:enhance={save('outage')}></form>
  <form id="recheck-form" method="POST" action="?/recheck" hidden bind:this={recheckForm} use:enhance={save('recheck')}></form>
</main>

<style>
  .mod-intro {
    max-width: 720px;
  }
  .mod-conn {
    background: var(--ink-2);
  }
  .mod-main {
    gap: var(--s-6);
  }
  .mod-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr));
    gap: var(--s-5);
  }
  .mod-stats .stat__label {
    font-size: 13px;
  }
  .mod-stat {
    font-family: var(--font-display);
    font-size: 26px;
    line-height: 1.2;
    font-weight: 500;
    letter-spacing: -0.02em;
  }
  .mod-layout {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-5);
    align-items: flex-start;
  }
  .mod-feed {
    flex: 999 1 560px;
  }
  .mod-side {
    flex: 1 1 340px;
    min-width: 0;
  }
  .mod-list > li + li {
    border-top: 1px solid var(--line);
  }
  .mod-item {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto;
    gap: var(--s-4);
    align-items: start;
    padding: var(--s-4) var(--s-5);
  }
  .mod-item__body {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }
  .mod-item__end {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--s-1);
  }
  .mod-empty {
    padding: var(--s-5);
  }
  .mod-hidden {
    font-style: italic;
  }
  /* No font-size here: the prototype's 13px loses to .admin .btn, so it renders at 14px. */
  .mod-reveal {
    min-height: 32px;
    padding: 0 var(--s-3);
  }
  .dot.mod-ring {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--wait-mark);
  }
  .mod-policy {
    padding: var(--s-5);
    border-radius: var(--r-card);
    background: var(--wait-soft);
    box-shadow: inset 0 0 0 1px var(--wait-line);
  }
  .mod-opt {
    display: flex;
    gap: var(--s-3);
    align-items: flex-start;
    padding: var(--s-3) 14px;
    border-radius: var(--r-panel);
    box-shadow: inset 0 0 0 1px var(--wait-line);
    cursor: pointer;
  }
  .mod-opt:has(input:checked) {
    background: var(--surface);
    box-shadow: inset 0 0 0 1.5px var(--act);
  }
  .mod-opt input {
    width: 18px;
    height: 18px;
    margin: 2px 0 0;
    flex: none;
    accent-color: var(--act);
  }
  .mod-switch {
    align-items: flex-start;
    min-height: 40px;
    color: var(--ink-2);
  }
  .mod-most > li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--s-3);
    padding: var(--s-3) 0;
  }
  .mod-most > li + li {
    border-top: 1px solid var(--line);
  }
  .mod-most > li > :first-child {
    min-width: 0;
  }
  .mod-count {
    flex: none;
    white-space: nowrap;
  }
  @media (max-width: 48rem) {
    .mod-item {
      grid-template-columns: 32px minmax(0, 1fr);
      gap: var(--s-2) var(--s-3);
      padding: var(--s-4);
    }
    .mod-item__end {
      grid-column: 2;
      flex-direction: row;
      align-items: center;
      gap: var(--s-3);
    }
    .mod-policy {
      padding: var(--s-5) var(--s-4);
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .mod-item .tag,
    .mod-item .tag .dot {
      transition-property: background-color, color, box-shadow;
      transition-duration: var(--dur);
      transition-timing-function: var(--ease-out);
    }
    .mod-opt {
      transition-property: background-color, box-shadow;
      transition-duration: var(--dur-fast);
      transition-timing-function: ease-out;
    }
  }
</style>
