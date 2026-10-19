<script lang="ts">
  import { applyAction, enhance, type ActionResult } from '$app/forms';
  import { seeded } from '@logitland/flock';
  import { Countdown, FLIP, Flock, Morph, announce, fold, rise, toast } from '@logitland/ui/svelte';
  import { tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import type { SubTag, SubscriptionRow } from '#lib/fixtures/subscriptions.js';
  import type { SubmitFunction } from './$types';

  let { data } = $props();

  type Filter = 'all' | SubTag;
  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'attn', label: 'Needs attention' },
    { value: 'stopped', label: 'Stopped' },
  ];

  // Rows start from the data and reset if it changes; deleting removes them here.
  let subs = $derived(data.subscriptions);
  let filter = $state<Filter>('all');
  const shown = $derived(filter === 'all' ? subs : subs.filter((s) => s.tag === filter));
  const count = (f: Filter) => (f === 'all' ? subs.length : subs.filter((s) => s.tag === f).length);

  let pending = $state<string | null>(null);
  let listHeading = $state<HTMLElement>();
  let showAllBtn = $state<HTMLButtonElement>();
  let chips = $state<HTMLElement>();

  async function failed(result: ActionResult) {
    if (result.type === 'failure') toast(String(result.data?.message ?? ''));
    else await applyAction(result);
  }

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

  /* ---------- Delivery strips: 48 half-hour bars, drawn from the host so they stay the same on every visit ---------- */

  function bars(seed: string, pattern: string) {
    const r = seeded(seed);
    return [...pattern].map((ch, i) => (ch === '_' ? { cls: 's-none', h: 4, i } : { cls: ch === 'o' ? 's-ok' : ch === 'r' ? 's-wait' : 's-fail', h: 10 + Math.round(r() * 10), i }));
  }

  /* ---------- Delete a stopped destination: it folds away and every count follows ---------- */

  // Rows leaving because of a filter disappear at once, as in the prototype; only a deleted row folds.
  let deleting: string | null = null;
  const leave = (node: Element, id: string) => (id === deleting ? fold(node) : { duration: 0 });
  const rowControl = (id: string) => document.querySelector<HTMLElement>(`[data-sub="${id}"] a, [data-sub="${id}"] button`);

  function remove(row: SubscriptionRow): SubmitFunction {
    return ({ cancel }) => {
      if (pending) return cancel();
      pending = row.id;
      return async ({ result }) => {
        pending = null;
        if (result.type !== 'success') return failed(result);
        const i = shown.findIndex((s) => s.id === row.id);
        const next = shown[i + 1] ?? shown[i - 1];
        deleting = row.id;
        subs = subs.filter((s) => s.id !== row.id);
        toast(`Deleted the subscription to ${row.host}`);
        await tick();
        deleting = null;
        (next ? rowControl(next.id) : shown.length === 0 ? showAllBtn : listHeading)?.focus();
      };
    };
  }

  /* ---------- New subscription: a simulated challenge, then the result ---------- */

  let check = $state<'unverified' | 'sending' | 'verified'>('unverified');
  let echoMs = $state(0);
  let verifiedNote = $state<HTMLElement>();
  const checkLabel = $derived(check === 'verified' ? 'Verified' : check === 'sending' ? 'Sending token…' : 'Not verified');

  const challenge: SubmitFunction = ({ cancel }) => {
    if (check !== 'unverified') return cancel();
    check = 'sending';
    return async ({ result }) => {
      if (result.type !== 'success' || !result.data || !('echoMs' in result.data)) {
        check = 'unverified';
        return failed(result);
      }
      echoMs = result.data.echoMs;
      check = 'verified';
      await tick();
      verifiedNote?.focus();
    };
  };

  const VERIFY_CODE = 'import { Webhook } from "standardwebhooks"\nconst wh = new Webhook(env.LOGITLAND_WHSEC)\nconst event = wh.verify(rawBody,\n  Object.fromEntries(request.headers))\n';
  const VERIFY_NOTE = '// retries reuse webhook-id: drop repeats';
</script>

<svelte:head><title>Subscriptions · Logitland</title></svelte:head>

<main id="main" class="o-main">
  <div class="stack g-2 subs-intro" data-enter="0">
    <h1 class="h1">Subscriptions</h1>
    <p class="t-2">Where your agents receive Discord events. The relay reads Discord once, checks each agent’s channel access, and posts signed events to these addresses.</p>
  </div>

  <div class="subs-layout">
    <section class="stack g-3 subs-list" aria-labelledby="list-h" data-enter="1">
      <div class="between">
        <h2 id="list-h" class="micro" tabindex="-1" bind:this={listHeading}>Destinations</h2>
        <div class="chips" role="group" aria-label="Filter" bind:this={chips}>
          {#each FILTERS as f (f.value)}
            <button type="button" class="chip" data-value={f.value} aria-pressed={filter === f.value} onclick={() => choose(f.value)}>{f.label} <span class="chip__count">· <Morph text={count(f.value)} /></span></button>
          {/each}
        </div>
      </div>

      <ul class="card card--flush subs">
        {#each shown as s (s.id)}
          <li class="sub" data-sub={s.id} animate:flip={FLIP} in:rise out:leave={s.id}>
            <div class="between" style="--gap: 8px 16px">
              <div class="cluster g-2 sub__id">
                <span class="mono wrap-any" class:t-ink={s.tag !== 'stopped'} class:t-3={s.tag === 'stopped'}>{s.address}</span>
                <span class="tag tag--{s.status.tone}"><span class="dot" class:dot--wait={s.status.dot === 'wait'} class:dot--off={s.status.dot === 'off'} aria-hidden="true"></span>{s.status.label}</span>
              </div>
              {#if s.action.kind === 'link'}
                <a class="btn btn--sm" href={s.action.href} aria-label="{s.action.label} for {s.host}">{s.action.label}</a>
              {:else}
                <form method="POST" action="?/delete" use:enhance={remove(s)}>
                  <input type="hidden" name="id" value={s.id} />
                  <button class="btn btn--danger btn--sm" class:is-busy={pending === s.id} aria-busy={pending === s.id} aria-label="Delete for {s.host}"><span class="btn__spin" aria-hidden="true"></span>Delete</button>
                </form>
              {/if}
            </div>
            <div class="cluster caption t-3" style="--gap: 8px 16px">
              <span class="cluster g-2 t-2"><Flock id={s.agent.id} size={22} off={s.agent.off} />{s.agent.name}</span>
              <span>{s.events}</span>
              <span class="mono tiny">{s.channels}</span>
            </div>
            <div class="strip sub__strip" role="img" aria-label={s.strip.label}>
              {#each bars(s.address, s.strip.pattern) as b (b.i)}<span class={b.cls} style="--h:{b.h}px;--i:{b.i}"></span>{/each}
            </div>
            {#if s.note}
              <p class="small t-2">{s.note.text}{#if s.note.countdown}<Countdown seconds={s.note.countdown.seconds} format={s.note.countdown.format} expired={s.note.countdown.expired} />{/if}{s.note.after ?? ''}</p>
            {/if}
          </li>
        {/each}
        {#if shown.length === 0}
          <li class="sub sub-empty" in:rise>
            <p class="t-2" id="subs-empty-msg">No destinations in this view.</p>
            <button type="button" class="btn btn--sm self-start" aria-describedby="subs-empty-msg" bind:this={showAllBtn} onclick={showAll}>Show all</button>
          </li>
        {/if}
      </ul>
      <p class="caption t-3">Each bar is 30 minutes. Grey delivered, amber retried, red still failing.</p>
    </section>

    <div class="stack subs-side" data-enter="2">
      <section class="card g-5" id="new-sub" aria-labelledby="new-h">
        <h2 id="new-h" class="title">New subscription</h2>
        <form class="ns" method="POST" action="?/challenge" use:enhance={challenge}>
          <div class="field">
            <label class="label" for="s-agent">For agent</label>
            <select class="select" id="s-agent" name="agent_id">
              {#each data.agents as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
            </select>
          </div>
          <div class="field">
            <label class="label" for="s-url">Destination</label>
            <input class="input input--mono" id="s-url" name="url" type="url" value={data.draft.url} aria-describedby="s-url-hint" autocomplete="off" />
            <span class="hint" id="s-url-hint">Treated as a secret. Only you and relay admins see it in full.</span>
          </div>
          {#if data.draft.checks.length}
            <ul class="sub-checks small" aria-label="Address checks">
              {#each data.draft.checks as c (c.title)}
                <li>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" /></svg>
                  <span class="stack g-0"><span>{c.title}</span><span class="caption t-3">{c.detail}</span></span>
                </li>
              {/each}
            </ul>
          {/if}

          <div class="panel stack g-2">
            <div class="between g-2">
              <strong class="small fw-600">Prove you control it</strong>
              <span class="tag" class:tag--wait={check !== 'verified'} class:tag--quiet={check === 'verified'}><span class="dot" class:dot--wait={check !== 'verified'} aria-hidden="true"></span><Morph id="ch-status" text={checkLabel} /></span>
            </div>
            {#if check === 'verified'}
              <p class="small t-2" tabindex="-1" bind:this={verifiedNote} in:rise>Verified. Your receiver echoed the one-time token in {echoMs} ms.</p>
            {:else}
              <p class="small t-2">The relay posts a one-time token here. Your receiver echoes it back within [timeout] before any conversation is sent.</p>
              <button class="btn btn--sm self-start" class:is-busy={check === 'sending'} aria-busy={check === 'sending'}><span class="btn__spin" aria-hidden="true"></span>Send challenge</button>
            {/if}
          </div>

          <fieldset class="stack g-0">
            <legend class="label sub-legend">Events</legend>
            {#each data.draft.events as e (e.type)}
              <label class="sub-ev"
                ><input type="checkbox" name="events" value={e.type} checked={e.checked} disabled={e.locked} /><span class="mono tiny">{e.type}</span>{#if e.note}<span class="caption t-3">{e.note}</span>{/if}</label
              >
            {/each}
          </fieldset>

          <button type="button" class="btn btn--primary btn--block" disabled={check !== 'verified'} onclick={() => toast('Creating a subscription isn’t part of this mockup.')}>Create subscription</button>
          <p class="caption t-3">Its signing secret is shown once after you create it.</p>
        </form>
      </section>

      <details class="details small sub-help">
        <summary
          ><svg class="chev" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>Verifying events on your receiver</summary
        >
        <div class="details__body">
          <!-- A scrollable code block takes focus so it can be scrolled from the keyboard. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <pre class="code sub-code" tabindex="0" role="region" aria-label="Verifying an event with standardwebhooks">{VERIFY_CODE}<span class="c-dim">{VERIFY_NOTE}</span></pre>
        </div>
      </details>
      <details class="details small sub-help">
        <summary
          ><svg class="chev" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>Addresses the relay refuses</summary
        >
        <div class="details__body">
          <p class="t-2">Plain http, private networks like 192.168.x.x, cloud metadata at 169.254.169.254, credentials inside the URL, and localhost. The relay looks each address up again before every delivery, so a later DNS change is caught at the next send.</p>
        </div>
      </details>
    </div>
  </div>
</main>

<style>
  .subs-intro {
    max-width: 640px;
  }
  .subs-layout {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-6);
    align-items: flex-start;
  }
  .subs-list {
    flex: 999 1 560px;
  }
  .subs-side {
    flex: 1 1 340px;
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

  .sub-checks {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .sub-checks > li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .sub-checks svg {
    flex: none;
    margin-top: 4px;
    color: var(--ink);
  }

  .ns {
    display: contents;
  }
  .sub-legend {
    margin-bottom: var(--s-1);
  }
  .sub-ev {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 40px;
    cursor: pointer;
  }
  .sub-ev input {
    width: 18px;
    height: 18px;
    margin: 0;
    flex: none;
    accent-color: var(--act);
  }
  .sub-ev input:disabled {
    cursor: not-allowed;
  }
  .sub-ev:has(input:disabled) {
    cursor: not-allowed;
  }

  .sub-help {
    padding-inline: var(--s-2);
  }
  .sub-code {
    white-space: pre;
    overflow-wrap: normal;
    overflow-x: auto;
  }

  /* A busy button looks disabled but keeps focus. */
  .btn.is-busy {
    opacity: 0.5;
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
