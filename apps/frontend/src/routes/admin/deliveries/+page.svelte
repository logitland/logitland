<script lang="ts">
  import { applyAction, enhance, type SubmitFunction } from '$app/forms';
  import { FLIP, Morph, fold, motionOK, reveal, rise, toast } from '@logitland/ui/svelte';
  import { tick, untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import type { SubFilter, SubState, SubscriptionHealth } from '#lib/fixtures/admin-deliveries.js';

  let { data } = $props();

  // Pause and resume a receiver (fixtures-only simulation). The row's state, detail and button morph.
  let paused = $state<Record<string, boolean>>({});
  let pausing = $state<Record<string, boolean>>({});
  let pausedBy = $state('');

  interface Row extends SubscriptionHealth {
    tag: SubState;
    text: string;
  }
  const rows = $derived(
    data.subscriptions.map((s): Row => {
      const r = paused[s.host]
        ? { ...s, stateLabel: 'Paused', tone: 'plain' as const, dot: 'dot--off' as const, detail: `Paused by @${pausedBy}`, tag: 'paused' as const }
        : { ...s, tag: s.state };
      return { ...r, text: [r.host, `${r.agent} · @${r.owner}`, r.stateLabel, r.detail, r.rate].join(' ').toLowerCase() };
    }),
  );

  // Chips and search filter the list when they change, as in the prototype; a row that changes state
  // stays put until the next filter change.
  let filter = $state<SubFilter>('all');
  let query = $state('');
  let shownHosts = $state<string[]>(untrack(() => data.subscriptions.map((s) => s.host)));
  const shown = $derived(rows.filter((r) => shownHosts.includes(r.host)));
  function apply() {
    const q = query.trim().toLowerCase();
    shownHosts = rows.filter((r) => (filter === 'all' || r.tag === filter) && (!q || r.text.includes(q))).map((r) => r.host);
  }

  const pause =
    (host: string): SubmitFunction =>
    ({ cancel, submitter }) => {
      if (pausing[host]) return cancel();
      pausing[host] = true;
      return async ({ result }) => {
        pausing[host] = false;
        if (result.type === 'success') {
          const now = result.data?.paused === true;
          pausedBy = String(result.data?.by ?? '');
          paused[host] = now;
          toast(now ? `Paused deliveries to ${host}` : `Resumed deliveries to ${host}`);
        } else if (result.type === 'failure') {
          toast(String(result.data?.message ?? 'That didn’t work.'));
        } else await applyAction(result);
        submitter?.focus();
      };
    };

  // Review jumps to the explanation in "Refused at send time".
  function review(e: MouseEvent, target: string) {
    const el = document.getElementById(target);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ block: 'center', behavior: motionOK() ? 'smooth' : 'auto' });
    el.focus({ preventScroll: true });
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
  }

  // Replay the selected failed deliveries.
  let picked = $state<string[]>(untrack(() => data.failed.filter((f) => f.selected).map((f) => f.id)));
  let queued = $state<Record<string, boolean>>({});
  let replaying = $state(false);
  let status = $state('');
  let statusEl = $state<HTMLElement>();
  let failedList = $state<HTMLElement>();
  const replayLabel = $derived(picked.length === 1 ? 'Replay 1 delivery' : `Replay ${picked.length} deliveries`);

  const replay: SubmitFunction = ({ cancel }) => {
    if (replaying || !picked.length) return cancel();
    replaying = true;
    return async ({ result }) => {
      replaying = false;
      if (result.type !== 'success' && result.type !== 'failure') return applyAction(result);
      const ids = (result.data?.replayed as string[] | undefined) ?? [];
      if (ids.length) {
        for (const id of ids) queued[id] = true;
        picked = picked.filter((id) => !ids.includes(id));
        const msg = `${ids.length} ${ids.length === 1 ? 'delivery' : 'deliveries'} queued again with the same webhook-id.`;
        status = msg;
        reveal(statusEl);
        toast(msg);
        await tick();
        failedList?.querySelector<HTMLInputElement>(`input[value="${CSS.escape(ids[0]!)}"]`)?.focus();
      }
      if (result.type === 'failure') toast(String(result.data?.message ?? 'The replay didn’t go through.'));
    };
  };
</script>

<svelte:head><title>Delivery health · Logitland admin</title></svelte:head>

<header class="a-header">
  <div class="page-head__text head-text">
    <h1 class="h1">Delivery health</h1>
    <p class="t-3">Events sent to agents’ receivers. Each is signed with Standard Webhooks and arrives at least once, in no guaranteed order; receivers drop repeats by webhook-id.</p>
  </div>
  <div class="a-tools" role="search">
    <label class="sr-only" for="d-search">Search subscriptions by host, agent or owner</label>
    <input class="input input--sm" id="d-search" type="search" placeholder="Host, agent or owner" autocomplete="off" bind:value={query} oninput={apply} />
  </div>
</header>

<main id="main" class="a-main">
  {#if data.dispatch.length}
    <section class="stack" aria-labelledby="disp-h" data-enter="0">
      <h2 id="disp-h" class="micro">Right now</h2>
      <ol class="cord cord--wide">
        {#each data.dispatch as d (d.label)}
          <li>
            <span class="knot knot--{d.knot}" aria-hidden="true"></span>
            <span class="fw-600 t-ink">{d.label}</span>
            <span class="cord__value {d.tone ?? ''}">{d.value}</span>
            <span class="cord__note">{d.note}</span>
          </li>
        {/each}
      </ol>
      <p class="caption t-3">{data.dispatchNote}</p>
    </section>
  {/if}

  <div class="split" data-enter="1">
    <section class="stack g-3" aria-labelledby="subs-h">
      <div class="between baseline g-2">
        <h2 id="subs-h" class="micro">Subscriptions, most troubled first</h2>
        <span class="caption t-3" role="status"><Morph text="{shown.length} shown" /></span>
      </div>
      <div class="chips" role="group" aria-label="Filter subscriptions by state">
        {#each data.filters as f (f.value)}
          <button
            type="button"
            class="chip"
            aria-pressed={filter === f.value}
            onclick={() => {
              filter = f.value;
              apply();
            }}>{f.label}</button
          >
        {/each}
      </div>
      <ul class="card card--flush vrows" id="subs-list">
        {#each shown as s (s.host)}
          <li class="row sub" animate:flip={FLIP} in:rise out:fold>
            <div class="sub__id">
              <span class="mono t-ink wrap-any">{s.host}</span>
              <span class="caption t-3">{s.agent} · @{s.owner}</span>
            </div>
            <div class="sub__state">
              <span class="tag tag--{s.tone}"><span class="dot {s.dot}" aria-hidden="true"></span><Morph text={s.stateLabel} /></span>
              {#if s.action?.kind === 'pause'}<Morph class="caption t-3" text={s.detail} />{:else}<span class="caption t-3">{s.detail}</span>{/if}
            </div>
            <span class="caption sub__rate {s.rateTone}">{s.rate}</span>
            <span class="sub__act"
              >{#if s.action?.kind === 'pause'}<form method="POST" action="?/pause" use:enhance={pause(s.host)}>
                  <input type="hidden" name="host" value={s.host} />
                  <input type="hidden" name="paused" value={String(!paused[s.host])} />
                  <button type="submit" class="btn btn--sm" class:is-busy={pausing[s.host]} aria-busy={pausing[s.host] || undefined} aria-label="{paused[s.host] ? 'Resume' : 'Pause'} {s.host}"
                    ><span class="btn__spin" aria-hidden="true"></span><Morph text={paused[s.host] ? 'Resume' : 'Pause'} /></button
                  >
                </form>{:else if s.action?.kind === 'review'}{@const target = s.action.target}<a
                  class="btn btn--sm"
                  href="#{target}"
                  aria-label="Review {s.host}"
                  onclick={(e) => review(e, target)}>Review</a
                >{/if}</span
            >
          </li>
        {/each}
        <li class="row t-3" hidden={shown.length > 0}>No subscriptions match.</li>
      </ul>
    </section>

    {#if data.refusals.length || data.gap}
      <div class="stack g-4">
        {#if data.refusals.length}
          <section class="card g-3" aria-labelledby="ssrf-h">
            <h2 id="ssrf-h" class="title">Refused at send time</h2>
            <div class="rows refused">
              {#each data.refusals as r (r.host)}
                <!-- Review moves focus here (tabindex is -1 or absent, never in the tab order). -->
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <div class="stack g-1" id={r.id} tabindex={r.id ? -1 : undefined}>
                  <span class="mono t-ink">{r.host}</span>
                  <span>{r.before}<span class="mono tiny t-fail">{r.address}</span>{r.after}</span>
                  <span class="tiny t-3">{r.when}</span>
                </div>
              {/each}
            </div>
            <p class="caption t-3">The relay looks up each address itself before every send. Workers doesn’t document blocking private addresses, so the platform isn’t relied on for this.</p>
          </section>
        {/if}
        {#if data.gap}
          <section class="card g-2" aria-labelledby="gap-h">
            <h2 id="gap-h" class="title">Gap notices</h2>
            <span>{data.gap.before}<span class="mono tiny t-ink">{data.gap.event}</span>{data.gap.after}</span>
            <a class="link self-start" href="/admin">See it on Health</a>
          </section>
        {/if}
      </div>
    {/if}
  </div>

  <section aria-labelledby="dl-h" data-enter="2">
    <form class="stack g-3" method="POST" action="?/replay" use:enhance={replay}>
      <div class="between" style="--gap: 12px 24px">
        <div class="stack g-1">
          <h2 id="dl-h" class="micro">Failed, kept for replay</h2>
          <span class="caption t-3">Kept for [retention period]. A replay rechecks channel access and the address first.</span>
        </div>
        <button type="submit" class="btn btn--primary btn--sm" id="replay" disabled={picked.length === 0} class:is-busy={replaying} aria-busy={replaying || undefined}
          ><span class="btn__spin" aria-hidden="true"></span><Morph text={replayLabel} /></button
        >
      </div>
      <ul class="card card--flush rows" id="failed-list" bind:this={failedList}>
        {#each data.failed as d (d.id)}
          <li>
            <label class="pick">
              <input type="checkbox" name="delivery" value={d.id} aria-label="Select {d.id}" bind:group={picked} onchange={() => (status = '')} />
              <span class="pick__id"><span class="mono t-ink">{d.id}</span><span class="mono tiny t-3">{d.eventType}</span></span>
              <span class="pick__host mono tiny">{d.host}</span>
              <Morph class="pick__answer {queued[d.id] ? 't-2' : 't-fail'}" text={queued[d.id] ? 'Queued again' : d.answer} />
              <span class="pick__when t-3">{d.when}</span>
            </label>
          </li>
        {:else}
          <li class="row t-3">No failed deliveries are waiting for replay.</li>
        {/each}
      </ul>
      <p class="caption t-3 replay-status" id="replay-status" bind:this={statusEl}>{status}</p>
    </form>
  </section>
</main>

<style>
  .head-text {
    flex: 1 1 480px;
    max-width: 800px;
  }
  .split {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-5);
    align-items: flex-start;
  }
  .split > :first-child {
    flex: 999 1 560px;
    min-width: 0;
  }
  .split > :last-child {
    flex: 1 1 340px;
    min-width: 0;
  }

  .vrows > :not([hidden]) ~ :not([hidden]) {
    border-top: 1px solid var(--line);
  }
  .sub {
    gap: var(--s-2) var(--s-5);
  }
  .sub__id {
    flex: 1 1 220px;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .sub__state {
    flex: 1 1 200px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    align-items: flex-start;
  }
  .sub__rate {
    flex: 0 0 104px;
    text-align: end;
  }
  .sub__act {
    flex: 0 0 88px;
    display: flex;
    justify-content: flex-end;
  }
  @media (max-width: 48rem) {
    .sub__state {
      flex-basis: 100%;
    }
    .sub__rate {
      flex: 1 1 auto;
      text-align: start;
    }
    .sub__act {
      flex: 0 0 auto;
    }
    .sub__act:empty {
      display: none;
    }
    .pick__when {
      flex: 1 0 auto;
    }
  }

  .refused > * {
    padding-block: var(--s-3);
  }
  .refused > :first-child {
    padding-top: 0;
  }
  .refused > :focus {
    outline: none;
  }
  .refused > :focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 4px;
    border-radius: var(--r-tag);
  }

  .pick {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) var(--s-5);
    padding: var(--s-3) var(--s-5);
    cursor: pointer;
  }
  .pick:has(input:checked) {
    background: var(--raised);
  }
  .pick input {
    width: 18px;
    height: 18px;
    margin: 0;
    flex: none;
    accent-color: var(--act);
  }
  .pick__id {
    flex: 1 1 200px;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .pick__host {
    flex: 1 1 180px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .pick :global(.pick__answer) {
    flex: 1 1 160px;
  }
  .pick__when {
    flex: 0 0 104px;
    text-align: end;
  }
  .replay-status {
    min-height: 20px;
    padding-inline: var(--s-1);
  }

  @media (prefers-reduced-motion: no-preference) {
    .pick {
      transition: background-color var(--dur-fast) ease-out;
    }
    .pick :global(.pick__answer),
    .sub__rate {
      transition: color var(--dur) var(--ease-out);
    }
    .refused > :global(.is-flash) {
      animation: flash 1200ms var(--ease-out);
    }
    @keyframes flash {
      from {
        background-color: var(--act-soft);
      }
    }
  }
</style>
